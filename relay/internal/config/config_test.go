package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func write(t *testing.T, content string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

const goodToken = "a-token-that-is-long-enough-123456"

// 配置错了必须起不来：短 token 等于把电脑钥匙挂在公网上。
func TestRejectsShortToken(t *testing.T) {
	p := write(t, `{"token":"short"}`)
	_, err := Load(p)
	if err == nil {
		t.Fatal("短 token 应当被拒绝")
	}
	if !strings.Contains(err.Error(), "至少") {
		t.Fatalf("错误信息应当说清原因，实际：%v", err)
	}
}

// Windows 编辑器默认写 BOM，JSON 解析见到它会报看不懂的错。
func TestToleratesUTF8BOM(t *testing.T) {
	p := write(t, "\uFEFF"+`{"token":"`+goodToken+`","agent":{"port":8444},"visitor":{"port":8443}}`)
	cfg, err := Load(p)
	if err != nil {
		t.Fatalf("带 BOM 的配置应当能加载，实际：%v", err)
	}
	if cfg.Agent.Port != 8444 {
		t.Fatalf("agent.port 解析错误：%d", cfg.Agent.Port)
	}
}

func TestRejectsInvalidJSON(t *testing.T) {
	if _, err := Load(write(t, `{not json`)); err == nil {
		t.Fatal("非法 JSON 应当被拒绝")
	}
}

func TestRejectsDuplicateListeners(t *testing.T) {
	p := write(t, `{"token":"`+goodToken+`","agent":{"host":"0.0.0.0","port":9000},"visitor":{"host":"0.0.0.0","port":9000}}`)
	if _, err := Load(p); err == nil {
		t.Fatal("agent 与 visitor 撞端口应当被拒绝")
	}
}

// 要 TLS 就必须能把证书弄出来 —— acme 缺 key、files 缺路径都要报错。
func TestCertValidation(t *testing.T) {
	base := `"agent":{"port":1,"tls":true},"visitor":{"port":2},"token":"` + goodToken + `"`

	cases := map[string]string{
		"acme 缺 domain":  `{` + base + `,"cert":{"mode":"acme","dir":"/tmp/x"}}`,
		"acme 缺 dir":     `{` + base + `,"cert":{"mode":"acme","domain":"a.example.com"}}`,
		"acme 缺密钥":       `{` + base + `,"cert":{"mode":"acme","domain":"a.example.com","dir":"/tmp/x"}}`,
		"files 缺路径":      `{` + base + `,"cert":{"mode":"files"}}`,
		"未知 mode":        `{` + base + `,"cert":{"mode":"whatever"}}`,
		"非 tencentcloud": `{` + base + `,"cert":{"mode":"acme","domain":"a.example.com","dir":"/tmp/x","acme":{"provider":"cloudflare"}}}`,
	}
	for name, body := range cases {
		if _, err := Load(write(t, body)); err == nil {
			t.Errorf("%s：应当被拒绝", name)
		}
	}

	// 合法的 acme 配置要能过
	ok := `{` + base + `,"cert":{"mode":"acme","domain":"a.example.com","dir":"/tmp/x","acme":{"secretId":"id","secretKey":"key"}}}`
	cfg, err := Load(write(t, ok))
	if err != nil {
		t.Fatalf("合法 acme 配置不该被拒：%v", err)
	}
	if cfg.Cert.ACME.Provider != "tencentcloud" {
		t.Errorf("provider 应当默认成 tencentcloud，实际 %q", cfg.Cert.ACME.Provider)
	}
	if cfg.Cert.RenewDays != 30 || cfg.Cert.ACME.KeyType != "ec256" {
		t.Errorf("默认值没填上：renewDays=%d keyType=%q", cfg.Cert.RenewDays, cfg.Cert.ACME.KeyType)
	}
}

// 全部明文且不开管理端时，不应当强制要求证书配置。
func TestNoTLSMeansNoCertRequired(t *testing.T) {
	p := write(t, `{"token":"`+goodToken+`","agent":{"port":1},"visitor":{"port":2},"admin":{"enabled":false}}`)
	if _, err := Load(p); err != nil {
		t.Fatalf("全明文配置不该因证书被拒：%v", err)
	}
}

func TestDefaults(t *testing.T) {
	cfg, err := Load(write(t, `{"token":"`+goodToken+`","agent":{"port":1},"visitor":{"port":2},"admin":{"enabled":false}}`))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Limits.OpenTimeoutMs != 10000 || cfg.Limits.MaxStreams != 64 {
		t.Errorf("限流默认值不对：%+v", cfg.Limits)
	}
	if cfg.DefaultAgent != "default" {
		t.Errorf("defaultAgent 默认值不对：%q", cfg.DefaultAgent)
	}
}

// agent 名（多机共存时区分每台电脑）的字符集必须和 PC 侧 lib/settings.mjs 一致，
// 否则会出现「PC 侧存得下、服务端配置起不来」这种两边不一致的坑。
func TestValidAgentID(t *testing.T) {
	for _, ok := range []string{"pc-a", "PC_B", "desktop.1", "a", strings.Repeat("x", MaxAgentIDLength)} {
		if err := ValidAgentID(ok); err != nil {
			t.Errorf("%q 应当合法，却报错：%v", ok, err)
		}
	}
	for _, bad := range []string{"", "有中文", "a b", "a/b", "a\nb", "a:b", strings.Repeat("x", MaxAgentIDLength+1)} {
		if err := ValidAgentID(bad); err == nil {
			t.Errorf("%q 应当被拒绝", bad)
		}
	}
}

func TestRejectsInvalidDefaultAgent(t *testing.T) {
	p := write(t, `{"token":"`+goodToken+`","agent":{"port":1},"visitor":{"port":2},`+
		`"admin":{"enabled":false},"defaultAgent":"bad name"}`)
	_, err := Load(p)
	if err == nil {
		t.Fatal("非法 defaultAgent 应当让配置加载失败（否则会静默选不中任何机器）")
	}
	if !strings.Contains(err.Error(), "defaultAgent") {
		t.Fatalf("错误信息应当点明是 defaultAgent 的问题，实际：%v", err)
	}
}
