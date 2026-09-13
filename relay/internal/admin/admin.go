// Package admin 提供 relay 的 Web 管理端。
//
// 它是一个**新的公网入口**，所以安全上刻意做窄：
//   - 密码登录，密码只存 bcrypt 哈希（stateFile，0600）；
//   - 会话是无状态签名 cookie（HMAC + 过期时间），不需要服务端会话表；
//   - 登录按来源 IP 限速（连续失败锁定），与 PC 侧 PIN 的处理思路一致；
//   - 可选来源白名单。
//
// 首次启动若配置里没写 password，会随机生成一个并打印到日志 —— 不写死默认密码，
// 也不允许空密码登录（那等于把一个能改白名单、能触发续期的口子敞开）。
package admin

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html/template"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/kinderao/dsh-pocket-relay/relay/internal/certs"
	"github.com/kinderao/dsh-pocket-relay/relay/internal/config"
	"github.com/kinderao/dsh-pocket-relay/relay/internal/hub"
	"github.com/kinderao/dsh-pocket-relay/relay/internal/logx"
)

//go:embed index.html
var indexHTML string

const (
	sessionCookie = "dshp_admin"
	sessionTTL    = 12 * time.Hour

	// 登录限速：同一来源连续失败 5 次锁 5 分钟
	loginMaxFails = 5
	loginLockFor  = 5 * time.Minute
)

// state 管理端持久化状态（独立于 config，免得管理端改点东西就要重写用户配置）。
type state struct {
	PasswordHash string   `json:"passwordHash"`
	SessionKey   string   `json:"sessionKey"`
	AllowIPs     []string `json:"allowIps"`
	// DefaultAgent 管理端改过的「首选电脑」。空 = 用配置里的 defaultAgent。
	// 放在 state 而不是 config，是为了避免管理端点个按钮就重写整份配置（那会
	// 顺带把用户手写的注释、字段顺序、以及 token 明文重新排版一遍）。
	DefaultAgent string `json:"defaultAgent,omitempty"`
	// BlockedAgents 被禁止接入的电脑名。
	BlockedAgents []string `json:"blockedAgents,omitempty"`
}

// Server 管理端。
type Server struct {
	cfg     config.AdminConfig
	hub     *hub.Hub
	certs   *certs.Manager
	log     *logx.Logger
	version string
	addrs   map[string]string
	// agentToken 是 agent 通道的凭据。只在管理端**按需**返回（GET /api/token），
	// 刻意不放进 /api/status 的轮询负载——那个每 3 秒一次，塞进去等于把凭据
	// 反复刷到网络上和日志里。
	agentToken string

	mu    sync.Mutex
	st    state
	path  string
	fails map[string]*loginFails
	// InitialPassword 首次自动生成的明文密码（只在启动日志里用一次，不落盘）。
	InitialPassword string
}

type loginFails struct {
	count int
	until time.Time
	// last 上一次失败时间。用它判断「要不要重新计数」，**不能**用 until：
	// until 在未锁定时时零值，time.Since(零值) 是几十年，会把计数每次清零，
	// 于是锁定永远不触发（这个 bug 是被 TestLoginLockoutAfterRepeatedFailures 抓出来的）。
	last time.Time
}

// New 创建管理端；必要时生成初始密码。
//
// agentToken 只用于「按需查看」接口，不参与任何判定——判定仍在 hub 里做。
func New(cfg config.AdminConfig, h *hub.Hub, cm *certs.Manager, lg *logx.Logger, version string, addrs map[string]string, agentToken string) (*Server, error) {
	s := &Server{
		cfg: cfg, hub: h, certs: cm, log: lg, version: version, addrs: addrs,
		agentToken: agentToken,
		path:       cfg.StateFile,
		fails:      map[string]*loginFails{},
	}
	if s.path == "" {
		s.path = "admin-state.json"
	}
	if err := s.loadState(); err != nil {
		return nil, err
	}
	if cfg.Password != "" {
		// 配置里写了明文密码：以它为准（改密码就改配置文件后重启）
		hash, err := bcrypt.GenerateFromPassword([]byte(cfg.Password), bcrypt.DefaultCost)
		if err != nil {
			return nil, fmt.Errorf("生成密码哈希失败：%w", err)
		}
		s.st.PasswordHash = string(hash)
		if err := s.saveState(); err != nil {
			return nil, err
		}
	} else if s.st.PasswordHash == "" {
		pw := randomToken(12)
		hash, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
		if err != nil {
			return nil, fmt.Errorf("生成密码哈希失败：%w", err)
		}
		s.st.PasswordHash = string(hash)
		s.InitialPassword = pw
		if err := s.saveState(); err != nil {
			return nil, err
		}
	}
	if s.st.SessionKey == "" {
		s.st.SessionKey = randomToken(32)
		if err := s.saveState(); err != nil {
			return nil, err
		}
	}
	// 白名单以 state 为准（管理端改过就在 state 里）
	if len(s.st.AllowIPs) > 0 {
		h.SetAllowIPs(s.st.AllowIPs)
	}
	// 多机管理：管理端改过的首选电脑与禁止名单优先于配置文件
	if s.st.DefaultAgent != "" {
		h.SetDefaultAgent(s.st.DefaultAgent)
	}
	if len(s.st.BlockedAgents) > 0 {
		h.SetBlockedAgents(s.st.BlockedAgents)
	}
	return s, nil
}

func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func (s *Server) loadState() error {
	raw, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("读取管理端状态失败 %s：%w", s.path, err)
	}
	if err := json.Unmarshal(raw, &s.st); err != nil {
		return fmt.Errorf("管理端状态不是合法 JSON %s：%w", s.path, err)
	}
	return nil
}

func (s *Server) saveState() error {
	raw, err := json.MarshalIndent(s.st, "", "  ")
	if err != nil {
		return err
	}
	if dir := filepath.Dir(s.path); dir != "" && dir != "." {
		_ = os.MkdirAll(dir, 0o700)
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return fmt.Errorf("写入管理端状态失败：%w", err)
	}
	_ = os.Chmod(tmp, 0o600)
	return os.Rename(tmp, s.path)
}

// ---------- 认证 ----------

func (s *Server) sign(expiry int64) string {
	mac := hmac.New(sha256.New, []byte(s.st.SessionKey))
	fmt.Fprintf(mac, "%d", expiry)
	return fmt.Sprintf("%d.%s", expiry, hex.EncodeToString(mac.Sum(nil)))
}

func (s *Server) verify(tok string) bool {
	dot := strings.IndexByte(tok, '.')
	if dot <= 0 {
		return false
	}
	var expiry int64
	if _, err := fmt.Sscanf(tok[:dot], "%d", &expiry); err != nil {
		return false
	}
	if time.Now().Unix() > expiry {
		return false
	}
	mac := hmac.New(sha256.New, []byte(s.st.SessionKey))
	fmt.Fprintf(mac, "%d", expiry)
	want := hex.EncodeToString(mac.Sum(nil))
	return subtle.ConstantTimeCompare([]byte(tok[dot+1:]), []byte(want)) == 1
}

func (s *Server) authed(r *http.Request) bool {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return false
	}
	return s.verify(c.Value)
}

func (s *Server) setCookie(w http.ResponseWriter, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    value,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.cfg.TLS,
		MaxAge:   maxAge,
	})
}

// clientIP 取真实来源 IP（前面可能有 nginx）。
func clientIP(r *http.Request) string {
	if v := r.Header.Get("X-Real-IP"); v != "" {
		return v
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (s *Server) locked(ip string) time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()
	f := s.fails[ip]
	if f == nil {
		return 0
	}
	if time.Now().Before(f.until) {
		return time.Until(f.until)
	}
	return 0
}

func (s *Server) recordFail(ip string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f := s.fails[ip]
	if f == nil || time.Since(f.last) > loginLockFor {
		f = &loginFails{}
		s.fails[ip] = f
	}
	f.last = time.Now()
	f.count++
	if f.count >= loginMaxFails {
		f.until = time.Now().Add(loginLockFor)
		f.count = 0
	}
}

func (s *Server) clearFail(ip string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.fails, ip)
}

func (s *Server) allowed(ip string) bool {
	list := s.cfg.AllowIPs
	s.mu.Lock()
	if len(s.st.AllowIPs) > 0 {
		list = s.st.AllowIPs
	}
	s.mu.Unlock()
	if len(list) == 0 {
		return true
	}
	for _, a := range list {
		if a == ip {
			return true
		}
	}
	return false
}

// ---------- 路由 ----------

// Handler 返回管理端的 http.Handler。
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleIndex)
	mux.HandleFunc("/login", s.handleLogin)
	mux.HandleFunc("/logout", s.handleLogout)
	mux.HandleFunc("/api/status", s.handleStatus)
	mux.HandleFunc("/api/token", s.handleToken)
	mux.HandleFunc("/api/cert/renew", s.handleCertRenew)
	mux.HandleFunc("/api/allow-ips", s.handleAllowIPs)
	mux.HandleFunc("/api/agent/default", s.handleAgentDefault)
	mux.HandleFunc("/api/agent/kick", s.handleAgentKick)
	mux.HandleFunc("/api/agent/block", s.handleAgentBlock)
	return s.guard(mux)
}

// guard 统一做来源白名单 + 认证。
func (s *Server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.allowed(clientIP(r)) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		// 登录页与登录接口不需要会话
		if r.URL.Path == "/login" {
			next.ServeHTTP(w, r)
			return
		}
		if !s.authed(r) {
			if strings.HasPrefix(r.URL.Path, "/api/") {
				w.Header().Set("content-type", "application/json; charset=utf-8")
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":"unauthorized"}`))
				return
			}
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if d := s.locked(ip); d > 0 {
		w.Header().Set("content-type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusTooManyRequests)
		fmt.Fprintf(w, loginPage, fmt.Sprintf("尝试次数过多，请 %d 秒后再试", int(d.Seconds())))
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("content-type", "text/html; charset=utf-8")
		fmt.Fprintf(w, loginPage, "")
		return
	}
	_ = r.ParseForm()
	pw := r.PostFormValue("password")
	if bcrypt.CompareHashAndPassword([]byte(s.st.PasswordHash), []byte(pw)) != nil {
		s.recordFail(ip)
		s.log.Warnf("admin: 登录失败（来源 %s）", ip)
		w.Header().Set("content-type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprintf(w, loginPage, "密码错误")
		return
	}
	s.clearFail(ip)
	s.setCookie(w, s.sign(time.Now().Add(sessionTTL).Unix()), int(sessionTTL.Seconds()))
	s.log.Infof("admin: 登录成功（来源 %s）", ip)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	s.setCookie(w, "", -1)
	http.Redirect(w, r, "/login", http.StatusSeeOther)
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("content-type", "text/html; charset=utf-8")
	w.Header().Set("cache-control", "no-store")
	page, err := template.New("index").Parse(indexHTML)
	if err != nil {
		http.Error(w, "template error", http.StatusInternalServerError)
		return
	}
	_ = page.Execute(w, map[string]string{
		"version": s.version,
		"public":  s.publicURL(),
	})
}

// publicURL 访客入口地址（给用户抄/做二维码用）。
func (s *Server) publicURL() string {
	host, ok := s.addrs["visitor"]
	if !ok {
		return ""
	}
	scheme := "http"
	if s.cfg.TLS {
		scheme = "https"
	}
	// 监听是 0.0.0.0，展示时换成证书域名更可读
	if s.certs != nil {
		if st := s.certs.Status(); st.Domain != "" {
			_, port, err := net.SplitHostPort(host)
			if err == nil {
				return fmt.Sprintf("%s://%s:%s", scheme, st.Domain, port)
			}
		}
	}
	return fmt.Sprintf("%s://%s", scheme, host)
}

// ---------- API ----------

type statusResp struct {
	Version   string            `json:"version"`
	UptimeSec int64             `json:"uptimeSec"`
	Now       time.Time         `json:"now"`
	Listeners map[string]string `json:"listeners"`
	PublicURL string            `json:"publicUrl"`
	Hub       hub.Status        `json:"hub"`
	Cert      *certs.Status     `json:"cert"`
	AllowIPs  []string          `json:"allowIps"`
	StatePath string            `json:"statePath"`
	Logs      []string          `json:"logs"`
}

func (s *Server) writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.Header().Set("cache-control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	resp := statusResp{
		Version:   s.version,
		Now:       time.Now(),
		Listeners: s.addrs,
		PublicURL: s.publicURL(),
		Hub:       s.hub.Snapshot(),
		AllowIPs:  s.hub.AllowIPs(),
		StatePath: s.path,
		Logs:      s.log.Tail(120),
	}
	resp.UptimeSec = resp.Hub.UptimeSec
	if s.certs != nil {
		st := s.certs.Status()
		resp.Cert = &st
	}
	s.writeJSON(w, http.StatusOK, resp)
}

// handleToken 按需返回 agent token。
//
// 单独一个端点而不是塞进 /api/status：status 是 3 秒轮询的，把凭据放进去等于
// 每 3 秒就把它在网络上和日志里刷一遍。这里只有用户点「显示 / 复制」时才会被请求。
//
// 安全性说明：它和「改白名单」「触发续期」同级——都需要管理端密码。能拿到 token
// 的人本来就能改这台 relay 的配置，所以不算提权；但正因为如此，页面上默认打码，
// 不用时不取。
func (s *Server) handleToken(w http.ResponseWriter, r *http.Request) {
	s.writeJSON(w, http.StatusOK, map[string]any{
		"token": s.agentToken,
		"set":   s.agentToken != "",
	})
}

func (s *Server) handleCertRenew(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		s.writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST only"})
		return
	}
	if s.certs == nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "本实例未启用 TLS，无证书可续期"})
		return
	}
	s.log.Infof("admin: 手动触发证书续期")
	if err := s.certs.RenewNow(); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"ok": true, "cert": s.certs.Status()})
}

func (s *Server) handleAllowIPs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		s.writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST only"})
		return
	}
	var body struct {
		IPs []string `json:"ips"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "body must be JSON"})
		return
	}
	clean := make([]string, 0, len(body.IPs))
	for _, ip := range body.IPs {
		ip = strings.TrimSpace(ip)
		if ip == "" {
			continue
		}
		if net.ParseIP(ip) == nil {
			s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("不是合法 IP：%s", ip)})
			return
		}
		clean = append(clean, ip)
	}

	s.mu.Lock()
	s.st.AllowIPs = clean
	s.mu.Unlock()
	s.hub.SetAllowIPs(clean)
	if err := s.saveState(); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.log.Infof("admin: 访客白名单已更新（%d 条）", len(clean))
	s.writeJSON(w, http.StatusOK, map[string]any{"ok": true, "allowIps": clean})
}

// ---------- 多机管理（首选 / 断开 / 禁止接入） ----------
//
// 这三个动作都只影响「谁接流」，不碰凭据：真正的凭据始终是 agent token。
// 换句话说，能连上来的机器一定是 token 正确的机器，这里做的是**排序**和
// **管理便利**（比如某台机器异常重连、先把它踹下线），不是安全边界。

// decodeAgentBody 解析 {"id": "...", ...} 形式的小请求体。
func (s *Server) decodeAgentBody(w http.ResponseWriter, r *http.Request, body any) bool {
	if r.Method != http.MethodPost {
		s.writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST only"})
		return false
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	if err := dec.Decode(body); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "body must be JSON"})
		return false
	}
	return true
}

// handleAgentDefault 设置首选接流的电脑（id 为空 = 清除，回到「最早注册」规则）。
func (s *Server) handleAgentDefault(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	if !s.decodeAgentBody(w, r, &body) {
		return
	}
	id := strings.TrimSpace(body.ID)
	if id != "" {
		if err := config.ValidAgentID(id); err != nil {
			s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
	}
	s.hub.SetDefaultAgent(id)
	s.mu.Lock()
	s.st.DefaultAgent = id
	s.mu.Unlock()
	if err := s.saveState(); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"ok": true, "hub": s.hub.Snapshot()})
}

// handleAgentKick 断开某台电脑的控制连接（它会自动重连）。
func (s *Server) handleAgentKick(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	if !s.decodeAgentBody(w, r, &body) {
		return
	}
	id := strings.TrimSpace(body.ID)
	if err := config.ValidAgentID(id); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := s.hub.KickAgent(id); err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"ok": true, "hub": s.hub.Snapshot()})
}

// handleAgentBlock 禁止 / 解除禁止某台电脑接入（持久化在管理端状态里）。
func (s *Server) handleAgentBlock(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID      string `json:"id"`
		Blocked bool   `json:"blocked"`
	}
	if !s.decodeAgentBody(w, r, &body) {
		return
	}
	id := strings.TrimSpace(body.ID)
	if err := config.ValidAgentID(id); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if body.Blocked {
		s.hub.BlockAgent(id)
	} else {
		s.hub.UnblockAgent(id)
	}

	// 名单以 hub 为准回写 state：BlockAgent/UnblockAgent 各自只改一项，
	// 让 hub 当唯一事实来源，省得两边各维护一份开始漂移。
	s.mu.Lock()
	s.st.BlockedAgents = s.hub.Snapshot().BlockedAgents
	s.mu.Unlock()
	if err := s.saveState(); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"ok": true, "hub": s.hub.Snapshot()})
}

// 登录页（简单内联，避免为一个表单再加一个 embed 文件）
const loginPage = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH Pocket Relay · 登录</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f1115;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.card{background:#171a21;border:1px solid #262b36;border-radius:14px;padding:30px 26px;max-width:340px;width:calc(100%% - 48px);text-align:center;color:#e6e9ef}
h1{font-size:16px;margin:0 0 4px}
p{font-size:13px;color:#8b93a1;margin:0 0 16px}
input{width:100%%;box-sizing:border-box;padding:11px 13px;font-size:15px;border:1px solid #2f3543;border-radius:9px;outline:none;background:#0f1115;color:#e6e9ef;margin-bottom:12px}
input:focus{border-color:#4f6ef7}
button{width:100%%;padding:11px;font-size:15px;background:#4f6ef7;color:#fff;border:none;border-radius:9px;cursor:pointer}
.err{color:#f87171;font-size:12px;margin-bottom:10px;min-height:16px}
</style></head><body><div class="card">
<h1>🛰 DSH Pocket Relay</h1><p>请输入管理密码</p>
<div class="err">%s</div>
<form method="post" action="/login">
<input name="password" type="password" autocomplete="current-password" autofocus required placeholder="管理密码">
<button type="submit">登录</button>
</form></div></body></html>`
