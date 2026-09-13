// Package config 负责 relay 配置的加载与校验。
//
// 校验原则与 Node 版一致：**配置错了必须起不来**，而不是带着半截配置跑起来
// 让人以为在保护着什么。尤其 token —— 它等价于你电脑的远程访问权。
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// MinTokenLength agent token 最小长度。
const MinTokenLength = 24

// MaxAgentIDLength agent 名长度上限。
const MaxAgentIDLength = 32

// ValidAgentID 校验 agent 名（多机共存时用来区分每台电脑）。
//
// 限定字符集不是洁癖：agent 名会进日志、管理端页面和 hub 的路由表，允许空格、
// 引号、换行只会让日志和表格没法看。PC 侧 lib/settings.mjs 用的是同一条规则
// （字母/数字/-/_/.，最长 32），两边必须一起改。
func ValidAgentID(id string) error {
	if id == "" {
		return fmt.Errorf("agent 名不能为空")
	}
	if len(id) > MaxAgentIDLength {
		return fmt.Errorf("agent 名最长 %d 个字符（当前 %d）", MaxAgentIDLength, len(id))
	}
	for i, r := range id {
		ok := r == '-' || r == '_' || r == '.' ||
			(r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')
		if !ok {
			return fmt.Errorf("agent 名只能包含字母、数字、- _ .（第 %d 个字符是 %q）", i+1, r)
		}
	}
	return nil
}

// Listener 一个监听口的配置。
type Listener struct {
	Host string `json:"host"`
	Port int    `json:"port"`
	// TLS 为 true 时使用证书管理器提供的证书终结 TLS；false 为明文。
	//
	// 刻意用布尔而不是证书路径：证书由 cert 段统一管理（可自动续期、热加载），
	// 监听口重复写路径只会让「换了证书但某个口没换」这种问题有机会发生。
	TLS bool `json:"tls"`
	// ProxyProtocol 仅 visitor 口有意义：前置 nginx 用 proxy_protocol on 传真实访客 IP。
	ProxyProtocol bool `json:"proxyProtocol"`
}

// ACMEConfig 内置 ACME（DNS-01）配置。
type ACMEConfig struct {
	// Provider 目前实现 tencentcloud（腾讯云 DNSPod）。
	Provider  string `json:"provider"`
	SecretID  string `json:"secretId"`
	SecretKey string `json:"secretKey"`
	Region    string `json:"region"`
	// KeyType: ec256（默认，与既有 acme.sh 一致）| ec384 | rsa2048 | rsa4096
	KeyType string `json:"keyType"`
}

// CertConfig 证书来源与管理。
type CertConfig struct {
	// Mode: "acme"（内置申请与自动续期）| "files"（沿用外部签发好的证书文件）
	Mode   string `json:"mode"`
	Domain string `json:"domain"`
	Email  string `json:"email"`
	// Dir ACME 账户、证书与私钥的存放目录（mode=acme 时必填）
	Dir string `json:"dir"`
	// Files mode=files 时的证书文件
	CertFile string `json:"certFile"`
	KeyFile  string `json:"keyFile"`
	// RenewDays 剩余天数低于它就续期（默认 30）
	RenewDays int `json:"renewDays"`
	// CheckHours 检查周期（小时，默认 12）
	CheckHours int        `json:"checkHours"`
	ACME       ACMEConfig `json:"acme"`
}

// AdminConfig Web 管理端。
type AdminConfig struct {
	Enabled bool   `json:"enabled"`
	Host    string `json:"host"`
	Port    int    `json:"port"`
	TLS     bool   `json:"tls"`
	// Password 登录密码。留空时首次启动会随机生成并打印到日志，
	// 并把哈希写进 stateFile，之后配置文件里不再需要明文。
	Password string `json:"password"`
	// StateFile 管理端状态（密码哈希、会话密钥）落盘位置。
	StateFile string `json:"stateFile"`
	// AllowIPs 管理端来源白名单（空 = 不限制）。
	AllowIPs []string `json:"allowIps"`
}

// Limits 限流与超时。
type Limits struct {
	OpenTimeoutMs        int `json:"openTimeoutMs"`
	MaxStreams           int `json:"maxStreams"`
	MaxConcurrentPerIP   int `json:"maxConcurrentPerIp"`
	MaxNewPerMinutePerIP int `json:"maxNewPerMinutePerIp"`
	AgentIdleMs          int `json:"agentIdleMs"`
}

// Config relay 全部配置。
type Config struct {
	Token        string      `json:"token"`
	Agent        Listener    `json:"agent"`
	Visitor      Listener    `json:"visitor"`
	Admin        AdminConfig `json:"admin"`
	Cert         CertConfig  `json:"cert"`
	DefaultAgent string      `json:"defaultAgent"`
	AllowIPs     []string    `json:"allowIps"`
	Limits       Limits      `json:"limits"`

	// path 记住来源，便于管理端回显与 reload
	path string
}

// Default 返回带默认值的配置（未指定端口等）。
func Default() Config {
	return Config{
		Agent:        Listener{Host: "0.0.0.0", Port: 8444},
		Visitor:      Listener{Host: "0.0.0.0", Port: 8443},
		Admin:        AdminConfig{Enabled: true, Host: "0.0.0.0", Port: 8445},
		Cert:         CertConfig{Mode: "acme", RenewDays: 30, CheckHours: 12},
		DefaultAgent: "default",
		Limits: Limits{
			OpenTimeoutMs:        10000,
			MaxStreams:           64,
			MaxConcurrentPerIP:   32,
			MaxNewPerMinutePerIP: 240,
			AgentIdleMs:          90000,
		},
	}
}

// Path 配置文件路径（Load 时记录）。
func (c *Config) Path() string { return c.path }

// Load 读取并校验配置。
func Load(path string) (*Config, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取配置失败 %s：%w", path, err)
	}
	// 去掉 UTF-8 BOM：Windows 记事本/PowerShell 默认会写 BOM，而 json 解析
	// 见到 BOM 直接报错，对用户来说完全看不懂（配置明明是对的）。
	raw = bytesTrimBOM(raw)

	cfg := Default()
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("配置不是合法 JSON %s：%w", path, err)
	}
	cfg.path = path
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func bytesTrimBOM(b []byte) []byte {
	return []byte(strings.TrimPrefix(string(b), "\uFEFF"))
}

// Validate 校验配置；任何一项不合法都返回错误（宁可起不来）。
func (c *Config) Validate() error {
	if len(c.Token) < MinTokenLength {
		return fmt.Errorf(
			"token 至少 %d 个字符（当前 %d）——它是 agent 通道的唯一凭据，短了等于把电脑钥匙挂在公网上；"+
				"用 `dsh-pocket-relay gen-token` 生成",
			MinTokenLength, len(c.Token))
	}
	if c.DefaultAgent == "" {
		c.DefaultAgent = "default"
	} else if err := ValidAgentID(c.DefaultAgent); err != nil {
		return fmt.Errorf("defaultAgent 非法：%w", err)
	}

	for _, l := range []struct {
		name string
		l    *Listener
	}{{"agent", &c.Agent}, {"visitor", &c.Visitor}} {
		if l.l.Port < 0 || l.l.Port > 65535 {
			return fmt.Errorf("%s.port 非法：%d", l.name, l.l.Port)
		}
		if l.l.Host == "" {
			l.l.Host = "0.0.0.0"
		}
	}
	if c.Admin.Enabled {
		if c.Admin.Port < 0 || c.Admin.Port > 65535 {
			return fmt.Errorf("admin.port 非法：%d", c.Admin.Port)
		}
		if c.Admin.Host == "" {
			c.Admin.Host = "0.0.0.0"
		}
	}
	// 监听口不能撞车（同 host:port）
	seen := map[string]string{}
	for _, l := range []struct {
		name string
		host string
		port int
	}{{"agent", c.Agent.Host, c.Agent.Port}, {"visitor", c.Visitor.Host, c.Visitor.Port}} {
		if l.port == 0 {
			continue // 0 = 随机端口（测试用）
		}
		key := fmt.Sprintf("%s:%d", l.host, l.port)
		if prev, ok := seen[key]; ok {
			return fmt.Errorf("%s 与 %s 监听了同一个地址 %s", l.name, prev, key)
		}
		seen[key] = l.name
	}
	if c.Admin.Enabled {
		key := fmt.Sprintf("%s:%d", c.Admin.Host, c.Admin.Port)
		if prev, ok := seen[key]; ok {
			return fmt.Errorf("admin 与 %s 监听了同一个地址 %s", prev, key)
		}
	}

	// 只要有任一口要 TLS，就必须能把证书弄出来
	if c.NeedsTLS() {
		switch c.Cert.Mode {
		case "acme":
			if c.Cert.Domain == "" {
				return fmt.Errorf("cert.mode=acme 需要填 cert.domain")
			}
			if c.Cert.Dir == "" {
				return fmt.Errorf("cert.mode=acme 需要填 cert.dir（ACME 账户与证书存放目录）")
			}
			if c.Cert.ACME.Provider == "" {
				c.Cert.ACME.Provider = "tencentcloud"
			}
			if c.Cert.ACME.Provider != "tencentcloud" {
				return fmt.Errorf("cert.acme.provider 目前只支持 tencentcloud（当前 %q）", c.Cert.ACME.Provider)
			}
			if c.Cert.ACME.SecretID == "" || c.Cert.ACME.SecretKey == "" {
				return fmt.Errorf("cert.acme 需要 tencentcloud 的 secretId / secretKey（DNS-01 用，不需要开 80/443）")
			}
		case "files":
			if c.Cert.CertFile == "" || c.Cert.KeyFile == "" {
				return fmt.Errorf("cert.mode=files 需要填 cert.certFile 与 cert.keyFile")
			}
		default:
			return fmt.Errorf("cert.mode 必须是 acme 或 files（当前 %q）", c.Cert.Mode)
		}
	}
	if c.Cert.RenewDays <= 0 {
		c.Cert.RenewDays = 30
	}
	if c.Cert.CheckHours <= 0 {
		c.Cert.CheckHours = 12
	}
	if c.Cert.ACME.KeyType == "" {
		c.Cert.ACME.KeyType = "ec256"
	}
	if c.Limits.OpenTimeoutMs <= 0 {
		c.Limits.OpenTimeoutMs = 10000
	}
	if c.Limits.MaxStreams <= 0 {
		c.Limits.MaxStreams = 64
	}
	if c.Limits.MaxConcurrentPerIP <= 0 {
		c.Limits.MaxConcurrentPerIP = 32
	}
	if c.Limits.MaxNewPerMinutePerIP <= 0 {
		c.Limits.MaxNewPerMinutePerIP = 240
	}
	if c.Limits.AgentIdleMs <= 0 {
		c.Limits.AgentIdleMs = 90000
	}
	return nil
}

// NeedsTLS 是否有任一听众需要 TLS。
func (c *Config) NeedsTLS() bool {
	return c.Agent.TLS || c.Visitor.TLS || (c.Admin.Enabled && c.Admin.TLS)
}

// ListenerAddr 拼 host:port。
func ListenerAddr(l Listener) string {
	return fmt.Sprintf("%s:%d", l.Host, l.Port)
}
