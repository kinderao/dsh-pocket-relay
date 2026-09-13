// Package certs 负责证书的获取、持有与续期。
//
// 两种来源：
//   - mode=files：沿用外部（如 acme.sh）签发好的证书文件，本程序只加载 + 监控到期。
//   - mode=acme ：内置 ACME，走 **DNS-01** 用腾讯云 DNSPod 申请与自动续期。
//
// 为什么坚持 DNS-01：用户明确要求「不占用 443」。HTTP-01 需要 80、
// TLS-ALPN-01 需要 443，只有 DNS-01 一个入站端口都不用开 —— 这正是自建 relay
// 的卖点（服务器上只开自己的业务端口）。
//
// 热加载：证书只存在内存里，所有 TLS 监听口共用 GetCertificate 回调，
// 续期成功后原子替换。于是**不需要重启进程**，也不会出现「换了证书但某个
// 监听口还在用旧的」。
package certs

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/go-acme/lego/v4/certcrypto"
	"github.com/go-acme/lego/v4/certificate"
	"github.com/go-acme/lego/v4/lego"
	"github.com/go-acme/lego/v4/registration"

	"github.com/kinderao/dsh-pocket-relay/relay/internal/config"
)

// Logger 最小日志接口。
type Logger interface {
	Infof(format string, args ...any)
	Warnf(format string, args ...any)
}

// Status 证书状态快照（管理端展示用）。
type Status struct {
	Mode      string    `json:"mode"`
	Domain    string    `json:"domain"`
	Subject   string    `json:"subject"`
	Issuer    string    `json:"issuer"`
	NotBefore time.Time `json:"notBefore"`
	NotAfter  time.Time `json:"notAfter"`
	DaysLeft  int       `json:"daysLeft"`
	Ready     bool      `json:"ready"`
	LastError string    `json:"lastError"`
	LastCheck time.Time `json:"lastCheck"`
	NextCheck time.Time `json:"nextCheck"`
}

// Manager 证书管理器。
type Manager struct {
	cfg  config.CertConfig
	log  Logger
	mu   sync.RWMutex
	cert *tls.Certificate
	leaf *x509.Certificate

	lastErr   string
	lastCheck time.Time

	stopOnce sync.Once
	stopCh   chan struct{}
}

// New 创建管理器并立即准备好证书（读取文件或走 ACME）。
func New(cfg config.CertConfig, log Logger) (*Manager, error) {
	m := &Manager{cfg: cfg, log: log, stopCh: make(chan struct{})}
	if err := m.ensure(); err != nil {
		return nil, err
	}
	return m, nil
}

// ensure 保证内存里有一张可用证书：优先用磁盘缓存，缺失或临近到期才去申请。
func (m *Manager) ensure() error {
	m.mu.Lock()
	m.lastCheck = time.Now()
	m.mu.Unlock()

	var err error
	switch m.cfg.Mode {
	case "files":
		err = m.loadFromFiles()
	case "acme":
		err = m.loadOrIssue()
	default:
		err = fmt.Errorf("未知 cert.mode：%q", m.cfg.Mode)
	}
	if err != nil {
		m.mu.Lock()
		m.lastErr = err.Error()
		m.mu.Unlock()
		return err
	}
	m.mu.Lock()
	m.lastErr = ""
	m.mu.Unlock()
	return nil
}

// ---------- mode=files ----------

func (m *Manager) loadFromFiles() error {
	certPEM, err := os.ReadFile(m.cfg.CertFile)
	if err != nil {
		return fmt.Errorf("读取证书失败 %s：%w", m.cfg.CertFile, err)
	}
	keyPEM, err := os.ReadFile(m.cfg.KeyFile)
	if err != nil {
		return fmt.Errorf("读取私钥失败 %s：%w", m.cfg.KeyFile, err)
	}
	return m.install(certPEM, keyPEM, "files")
}

// ---------- mode=acme ----------

func (m *Manager) certDir() string {
	return filepath.Join(m.cfg.Dir, "certificates")
}

func (m *Manager) accountDir() string { return filepath.Join(m.cfg.Dir, "account") }

func (m *Manager) loadOrIssue() error {
	certPath := filepath.Join(m.certDir(), "cert.pem")
	keyPath := filepath.Join(m.certDir(), "key.pem")

	if certPEM, err := os.ReadFile(certPath); err == nil {
		if keyPEM, err2 := os.ReadFile(keyPath); err2 == nil {
			if err3 := m.install(certPEM, keyPEM, "acme"); err3 == nil {
				days := m.DaysLeft()
				if days > m.cfg.RenewDays {
					m.log.Infof("relay: 复用磁盘上的证书（%s，剩余 %d 天）", m.cfg.Domain, days)
					return nil
				}
				m.log.Infof("relay: 磁盘证书仅剩 %d 天（阈值 %d），立即续期", days, m.cfg.RenewDays)
			} else {
				m.log.Warnf("relay: 磁盘证书不可用（%v），重新申请", err3)
			}
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("读取证书缓存失败：%w", err)
	}
	return m.issue()
}

// issue 走一次完整的 ACME DNS-01 申请。
func (m *Manager) issue() error {
	client, err := m.newACMEClient()
	if err != nil {
		return err
	}
	m.log.Infof("relay: 通过 %s 申请证书（DNS-01，域名 %s）…", m.cfg.ACME.Provider, m.cfg.Domain)

	req := certificate.ObtainRequest{
		Domains: []string{m.cfg.Domain},
		Bundle:  true,
	}
	res, err := client.Certificate.Obtain(req)
	if err != nil {
		return fmt.Errorf("ACME 申请失败：%w", err)
	}
	if err := os.MkdirAll(m.certDir(), 0o700); err != nil {
		return fmt.Errorf("创建证书目录失败：%w", err)
	}
	if err := writeFile600(filepath.Join(m.certDir(), "cert.pem"), res.Certificate); err != nil {
		return err
	}
	if err := writeFile600(filepath.Join(m.certDir(), "key.pem"), res.PrivateKey); err != nil {
		return err
	}
	if err := m.install(res.Certificate, res.PrivateKey, "acme"); err != nil {
		return err
	}
	m.log.Infof("relay: 证书申请成功（%s，有效期至 %s）", m.cfg.Domain, m.NotAfter().Format("2006-01-02"))
	return nil
}

// acmeUser 实现 lego 的 registration.User。
type acmeUser struct {
	Email string
	Reg   *registration.Resource
	key   crypto.Signer
}

func (u *acmeUser) GetEmail() string                        { return u.Email }
func (u *acmeUser) GetRegistration() *registration.Resource { return u.Reg }
func (u *acmeUser) GetPrivateKey() crypto.PrivateKey        { return u.key }

// newACMEClient 组装 lego 客户端：账户密钥持久化到磁盘，DNS-01 用腾讯云。
//
// 账户密钥必须落盘：每次启动重新注册会让 Let's Encrypt 侧堆一堆无用的账户，
// 而且很容易撞上账户数限制。
func (m *Manager) newACMEClient() (*lego.Client, error) {
	if err := os.MkdirAll(m.accountDir(), 0o700); err != nil {
		return nil, fmt.Errorf("创建 ACME 账户目录失败：%w", err)
	}
	keyPath := filepath.Join(m.accountDir(), "account.key")

	var key crypto.Signer
	if raw, err := os.ReadFile(keyPath); err == nil {
		key, err = parseAccountKey(raw)
		if err != nil {
			return nil, err
		}
	} else {
		// 账户密钥用标准库生成/编码（PKCS#8），不依赖 lego 的编码 API ——
		// 既少一处版本耦合，也保证任何密钥类型都能正确落盘。
		ec, gerr := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if gerr != nil {
			return nil, fmt.Errorf("生成 ACME 账户密钥失败：%w", gerr)
		}
		key = ec
		if err := writeFile600(keyPath, marshalAccountKey(ec)); err != nil {
			return nil, err
		}
	}

	user := &acmeUser{Email: m.cfg.Email, key: key}
	lc := lego.NewConfig(user)
	lc.Certificate.KeyType = keyType(m.cfg.ACME.KeyType)

	client, err := lego.NewClient(lc)
	if err != nil {
		return nil, fmt.Errorf("创建 ACME 客户端失败：%w", err)
	}

	provider, err := newTencentProvider(m.cfg.ACME)
	if err != nil {
		return nil, err
	}
	if err := client.Challenge.SetDNS01Provider(provider); err != nil {
		return nil, fmt.Errorf("设置 DNS-01 提供方失败：%w", err)
	}

	// 已注册过就直接复用账户（注册信息随账户密钥一起持久化在 lego 内部缓存里）。
	reg, err := client.Registration.Register(registration.RegisterOptions{TermsOfServiceAgreed: true})
	if err != nil {
		return nil, fmt.Errorf("ACME 账户注册失败：%w", err)
	}
	user.Reg = reg
	return client, nil
}

// asSigner lego 的几个密钥 API 声明返回 crypto.PrivateKey（即 any），
// 而 ACME 签名必须拿到 crypto.Signer —— 统一在这里断言，失败要报出来而不是静默降级。
func asSigner(k crypto.PrivateKey) (crypto.Signer, error) {
	s, ok := k.(crypto.Signer)
	if !ok {
		return nil, fmt.Errorf("ACME 密钥类型不支持签名：%T", k)
	}
	return s, nil
}

// marshalAccountKey 把账户私钥编码成 PKCS#8 PEM。
func marshalAccountKey(key crypto.Signer) []byte {
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		// 账户密钥一定是标准库能编码的类型，这里失败属于编程错误
		panic(fmt.Sprintf("marshal account key: %v", err))
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
}

// parseAccountKey 解析 PKCS#8 PEM 账户私钥。
func parseAccountKey(raw []byte) (crypto.Signer, error) {
	block, _ := pem.Decode(raw)
	if block == nil {
		return nil, fmt.Errorf("ACME 账户密钥不是合法 PEM")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("解析 ACME 账户密钥失败：%w", err)
	}
	return asSigner(parsed)
}

func keyType(name string) certcrypto.KeyType {
	switch name {
	case "ec384":
		return certcrypto.EC384
	case "rsa2048":
		return certcrypto.RSA2048
	case "rsa4096":
		return certcrypto.RSA4096
	default:
		return certcrypto.EC256
	}
}

// ---------- 安装与读取 ----------

func (m *Manager) install(certPEM, keyPEM []byte, mode string) error {
	pair, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return fmt.Errorf("证书与私钥不匹配或格式错误：%w", err)
	}
	leaf, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil {
		return fmt.Errorf("解析证书失败：%w", err)
	}
	pair.Leaf = leaf

	m.mu.Lock()
	m.cert = &pair
	m.leaf = leaf
	m.mu.Unlock()
	return nil
}

// GetCertificate 供所有 TLS 监听口使用；证书续期后无需重启即可生效。
func (m *Manager) GetCertificate(*tls.ClientHelloInfo) (*tls.Certificate, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.cert == nil {
		return nil, errors.New("证书尚未就绪")
	}
	return m.cert, nil
}

// TLSConfig 返回一个使用本管理器证书的 tls.Config。
func (m *Manager) TLSConfig() *tls.Config {
	return &tls.Config{
		GetCertificate: m.GetCertificate,
		MinVersion:     tls.VersionTLS12,
	}
}

// NotAfter 当前证书到期时间。
func (m *Manager) NotAfter() time.Time {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.leaf == nil {
		return time.Time{}
	}
	return m.leaf.NotAfter
}

// DaysLeft 剩余天数（负数表示已过期）。
func (m *Manager) DaysLeft() int {
	na := m.NotAfter()
	if na.IsZero() {
		return 0
	}
	return int(time.Until(na).Hours() / 24)
}

// Status 返回状态快照。
func (m *Manager) Status() Status {
	m.mu.RLock()
	defer m.mu.RUnlock()
	st := Status{
		Mode:      m.cfg.Mode,
		Domain:    m.cfg.Domain,
		Ready:     m.cert != nil,
		LastError: m.lastErr,
		LastCheck: m.lastCheck,
		NextCheck: m.lastCheck.Add(time.Duration(m.cfg.CheckHours) * time.Hour),
	}
	if m.leaf != nil {
		st.Subject = m.leaf.Subject.CommonName
		st.Issuer = m.leaf.Issuer.CommonName
		st.NotBefore = m.leaf.NotBefore
		st.NotAfter = m.leaf.NotAfter
		st.DaysLeft = int(time.Until(m.leaf.NotAfter).Hours() / 24)
	}
	return st
}

// ---------- 后台续期 ----------

// Start 启动后台检查循环（阻塞，应在 goroutine 里跑）。
func (m *Manager) Start() {
	go func() {
		interval := time.Duration(m.cfg.CheckHours) * time.Hour
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		m.log.Infof("relay: 证书检查已启动（每 %v 一次，剩余 < %d 天时续期）", interval, m.cfg.RenewDays)
		for {
			select {
			case <-m.stopCh:
				return
			case <-ticker.C:
				m.checkAndRenew()
			}
		}
	}()
}

// Stop 停止后台循环。
func (m *Manager) Stop() {
	m.stopOnce.Do(func() { close(m.stopCh) })
}

func (m *Manager) checkAndRenew() {
	m.mu.Lock()
	m.lastCheck = time.Now()
	m.mu.Unlock()

	if m.cfg.Mode != "acme" {
		// mode=files 由外部（acme.sh 等）负责续期，这里只报告到期情况
		if d := m.DaysLeft(); d < m.cfg.RenewDays {
			m.log.Warnf("relay: 证书仅剩 %d 天到期（mode=files，请在外部完成续期后重启或触发重载）", d)
		}
		return
	}
	if m.DaysLeft() >= m.cfg.RenewDays {
		return
	}
	m.log.Infof("relay: 证书剩余 %d 天，开始续期…", m.DaysLeft())
	if err := m.issue(); err != nil {
		m.mu.Lock()
		m.lastErr = err.Error()
		m.mu.Unlock()
		m.log.Warnf("relay: 证书续期失败（下个周期重试）：%v", err)
		return
	}
	m.log.Infof("relay: 证书续期成功，新到期时间 %s（已热加载，无需重启）", m.NotAfter().Format("2006-01-02"))
}

// RenewNow 立即续期（管理端按钮）。
func (m *Manager) RenewNow() error {
	m.mu.Lock()
	m.lastCheck = time.Now()
	m.mu.Unlock()
	switch m.cfg.Mode {
	case "acme":
		if err := m.issue(); err != nil {
			m.mu.Lock()
			m.lastErr = err.Error()
			m.mu.Unlock()
			return err
		}
		return nil
	case "files":
		if err := m.loadFromFiles(); err != nil {
			m.mu.Lock()
			m.lastErr = err.Error()
			m.mu.Unlock()
			return err
		}
		return nil
	default:
		return fmt.Errorf("未知 cert.mode：%q", m.cfg.Mode)
	}
}

func writeFile600(path string, data []byte) error {
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return fmt.Errorf("写入 %s 失败：%w", path, err)
	}
	_ = os.Chmod(path, 0o600)
	return nil
}
