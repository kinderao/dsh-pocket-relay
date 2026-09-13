// 管理端的安全属性测试。
//
// 管理端是一个**新的公网入口**，能改访客白名单、能触发证书续期，所以这里守的是
// 「未认证什么都干不了」而不是「页面长得对」：
//   - 未登录访问任何 API → 401，访问页面 → 跳登录页；
//   - 密码错 → 拒绝，且连续失败会锁定来源；
//   - 会话 cookie 被篡改 / 过期 → 失效；
//   - 白名单只接受合法 IP；
//   - 首页模板真的能渲染出来（embed 的 HTML 里出现 {{ 会在请求时才炸）。
package admin

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/kinderao/dsh-pocket-relay/relay/internal/config"
	"github.com/kinderao/dsh-pocket-relay/relay/internal/hub"
	"github.com/kinderao/dsh-pocket-relay/relay/internal/logx"
)

const testPassword = "test-admin-password"

/** 测试用 agent token（与 hub 的 token 保持一致，便于断言回显）。 */
const testAgentToken = "token-long-enough-for-tests"

func newTestServer(t *testing.T, cfg config.AdminConfig) (*Server, *httptest.Server) {
	t.Helper()
	if cfg.StateFile == "" {
		cfg.StateFile = filepath.Join(t.TempDir(), "admin.json")
	}
	if cfg.Password == "" {
		cfg.Password = testPassword
	}
	h := hub.New("token-long-enough-for-tests", "default", nil, hub.Limits{
		OpenTimeout: time.Second, MaxStreams: 8, MaxConcurrentPerIP: 8, MaxNewPerMinutePerIP: 100,
	}, logx.New(10))
	s, err := New(cfg, h, nil, logx.New(10), "test", map[string]string{"agent": "127.0.0.1:1", "visitor": "127.0.0.1:2"}, testAgentToken)
	if err != nil {
		t.Fatalf("New 失败：%v", err)
	}
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return s, ts
}

func noRedirectClient() *http.Client {
	return &http.Client{
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// loginAndCookie 登录并返回会话 cookie。
func loginAndCookie(t *testing.T, ts *httptest.Server) *http.Cookie {
	t.Helper()
	c := noRedirectClient()
	res, err := c.PostForm(ts.URL+"/login", url.Values{"password": {testPassword}})
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusSeeOther {
		t.Fatalf("登录应 303，实际 %d", res.StatusCode)
	}
	for _, ck := range res.Cookies() {
		if ck.Name == sessionCookie {
			return ck
		}
	}
	t.Fatal("登录成功没有下发会话 cookie")
	return nil
}

func TestUnauthenticatedIsLockedOut(t *testing.T) {
	_, ts := newTestServer(t, config.AdminConfig{})
	c := noRedirectClient()

	// API 必须 401，而不是把数据吐出来
	res, err := c.Get(ts.URL + "/api/status")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("未认证访问 /api/status 应 401，实际 %d", res.StatusCode)
	}

	// 页面跳登录
	res2, err := c.Get(ts.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer res2.Body.Close()
	if res2.StatusCode != http.StatusSeeOther || res2.Header.Get("Location") != "/login" {
		t.Fatalf("未认证访问 / 应 303 到 /login，实际 %d %q", res2.StatusCode, res2.Header.Get("Location"))
	}

	// 写操作同样要拦住（不能只保护读）
	for _, ep := range []string{"/api/cert/renew", "/api/allow-ips", "/api/agent/default", "/api/agent/kick", "/api/agent/block"} {
		req, _ := http.NewRequest(http.MethodPost, ts.URL+ep, strings.NewReader(`{"ips":["1.2.3.4"]}`))
		r3, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		r3.Body.Close()
		if r3.StatusCode != http.StatusUnauthorized {
			t.Fatalf("未认证 POST %s 应 401，实际 %d", ep, r3.StatusCode)
		}
	}
}

func TestLoginFlowAndSession(t *testing.T) {
	_, ts := newTestServer(t, config.AdminConfig{})
	c := noRedirectClient()

	// 密码错 → 401
	res, err := c.PostForm(ts.URL+"/login", url.Values{"password": {"wrong"}})
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("密码错应 401，实际 %d", res.StatusCode)
	}

	cookie := loginAndCookie(t, ts)
	if !cookie.HttpOnly {
		t.Error("会话 cookie 必须是 HttpOnly")
	}

	// 带 cookie 访问 API → 200 且能拿到真实数据
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/status", nil)
	req.AddCookie(cookie)
	res3, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res3.Body.Close()
	if res3.StatusCode != http.StatusOK {
		t.Fatalf("已登录访问 /api/status 应 200，实际 %d", res3.StatusCode)
	}
	var body map[string]any
	if err := json.NewDecoder(res3.Body).Decode(&body); err != nil {
		t.Fatalf("响应不是合法 JSON：%v", err)
	}
	if body["version"] != "test" {
		t.Errorf("version 字段不对：%v", body["version"])
	}
}

func TestTamperedAndExpiredSessionsRejected(t *testing.T) {
	s, ts := newTestServer(t, config.AdminConfig{})
	c := noRedirectClient()

	valid := s.sign(time.Now().Add(time.Hour).Unix())
	expired := s.sign(time.Now().Add(-time.Hour).Unix())
	forged := []byte(valid)
	forged[len(forged)-1] ^= 0x01 // 翻转签名最后一位

	cases := map[string]string{
		"有效": valid,
		"过期": expired,
		"篡改": string(forged),
		"乱写": "not-a-token",
		"空":  "",
	}
	for name, tok := range cases {
		req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/status", nil)
		req.AddCookie(&http.Cookie{Name: sessionCookie, Value: tok})
		res, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		want := http.StatusUnauthorized
		if name == "有效" {
			want = http.StatusOK
		}
		if res.StatusCode != want {
			t.Errorf("%s 会话：期望 %d，实际 %d", name, want, res.StatusCode)
		}
	}
}

func TestLoginLockoutAfterRepeatedFailures(t *testing.T) {
	s, ts := newTestServer(t, config.AdminConfig{})
	c := noRedirectClient()

	for i := 0; i < loginMaxFails; i++ {
		res, err := c.PostForm(ts.URL+"/login", url.Values{"password": {"wrong"}})
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
	}
	// 锁定后即使密码正确也要被拒
	res, err := c.PostForm(ts.URL+"/login", url.Values{"password": {testPassword}})
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("连续失败后应 429，实际 %d", res.StatusCode)
	}
	if s.locked("127.0.0.1") <= 0 {
		t.Fatal("应当记录了来源锁定")
	}
}

func TestAllowIPsValidationAndPersistence(t *testing.T) {
	s, ts := newTestServer(t, config.AdminConfig{})
	c := noRedirectClient()
	cookie := loginAndCookie(t, ts)

	post := func(body string) int {
		req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/allow-ips", strings.NewReader(body))
		req.Header.Set("content-type", "application/json")
		req.AddCookie(cookie)
		res, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}

	if code := post(`{"ips":["not-an-ip"]}`); code != http.StatusBadRequest {
		t.Fatalf("非法 IP 应 400，实际 %d", code)
	}
	if code := post(`{"ips":["1.2.3.4","5.6.7.8",""]}`); code != http.StatusOK {
		t.Fatalf("合法 IP 应 200，实际 %d", code)
	}
	got := s.hub.AllowIPs()
	if len(got) != 2 {
		t.Fatalf("白名单应有 2 条（空串被丢掉），实际 %v", got)
	}

	// 重启后白名单应当还在（落在 stateFile 里，而不是只活在内存）
	cfg := config.AdminConfig{StateFile: s.path, Password: testPassword}
	s2, err := New(cfg, s.hub, nil, logx.New(10), "test", nil, testAgentToken)
	if err != nil {
		t.Fatal(err)
	}
	if len(s2.st.AllowIPs) != 2 {
		t.Fatalf("重启后白名单丢了：%v", s2.st.AllowIPs)
	}
}

// 首页是 embed 进来的 HTML，且被当作 Go template 解析 —— 里面的 JS/CSS 只要出现
// 一个 {{ 就会在**请求时**解析失败返回 500（编译期发现不了）。这条守住它。
func TestIndexTemplateActuallyRenders(t *testing.T) {
	_, ts := newTestServer(t, config.AdminConfig{})
	c := noRedirectClient()
	cookie := loginAndCookie(t, ts)

	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/", nil)
	req.AddCookie(cookie)
	res, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("已登录访问首页应 200，实际 %d（模板可能解析失败了）：%s", res.StatusCode, string(body))
	}
	for _, want := range []string{"DSH Pocket Relay", "运行状态", "证书", "Agent Token", "白名单", "日志"} {
		if !strings.Contains(string(body), want) {
			t.Errorf("首页缺少内容：%q", want)
		}
	}
}

// Agent Token 查看：必须和别的接口一样受认证保护，且不能混进 3 秒轮询的 status。
func TestTokenEndpointRequiresAuthAndIsNotInStatusPolling(t *testing.T) {
	_, ts := newTestServer(t, config.AdminConfig{})
	c := noRedirectClient()

	// 未认证：401，且响应体里不能漏出 token
	res, err := c.Get(ts.URL + "/api/token")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("未认证访问 /api/token 应 401，实际 %d", res.StatusCode)
	}
	if strings.Contains(string(body), testAgentToken) {
		t.Fatal("未认证响应里泄露了 token")
	}

	cookie := loginAndCookie(t, ts)

	// 已认证：拿到 token
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/token", nil)
	req.AddCookie(cookie)
	res2, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res2.Body.Close()
	if res2.StatusCode != http.StatusOK {
		t.Fatalf("已认证访问 /api/token 应 200，实际 %d", res2.StatusCode)
	}
	var tok map[string]any
	if err := json.NewDecoder(res2.Body).Decode(&tok); err != nil {
		t.Fatal(err)
	}
	if tok["token"] != testAgentToken || tok["set"] != true {
		t.Fatalf("token 响应不对：%v", tok)
	}

	// 关键：轮询用的 /api/status 里**不能**带 token，否则每 3 秒刷一次凭据
	req3, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/status", nil)
	req3.AddCookie(cookie)
	res3, err := c.Do(req3)
	if err != nil {
		t.Fatal(err)
	}
	defer res3.Body.Close()
	statusBody, _ := io.ReadAll(res3.Body)
	if strings.Contains(string(statusBody), testAgentToken) {
		t.Fatal("/api/status 里出现了 token —— 它是 3 秒轮询的，等于反复外刷凭据")
	}
}

// 多机管理：设首选 / 断开 / 禁止接入。
//
// 这三个动作都会落盘（管理端状态文件），所以除了「当下生效」，还得证明
// 「重启之后还在」——否则用户重启一次 relay，首选和黑名单就悄悄丢了。
func TestAgentManagementEndpoints(t *testing.T) {
	s, ts := newTestServer(t, config.AdminConfig{})
	c := noRedirectClient()
	cookie := loginAndCookie(t, ts)

	post := func(ep, body string) (int, map[string]any) {
		t.Helper()
		req, _ := http.NewRequest(http.MethodPost, ts.URL+ep, strings.NewReader(body))
		req.Header.Set("content-type", "application/json")
		req.AddCookie(cookie)
		res, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(res.Body).Decode(&out)
		return res.StatusCode, out
	}

	// 非法名字必须拦住：写进去以后会永远选不中任何机器，很难排查
	for _, ep := range []string{"/api/agent/default", "/api/agent/kick", "/api/agent/block"} {
		if code, body := post(ep, `{"id":"bad name!"}`); code != http.StatusBadRequest {
			t.Errorf("%s 收到非法 agent 名应 400，实际 %d (%v)", ep, code, body)
		}
	}

	// 设首选 → 200 且 hub 立刻生效
	if code, body := post("/api/agent/default", `{"id":"pc-a"}`); code != http.StatusOK {
		t.Fatalf("设首选应 200，实际 %d (%v)", code, body)
	}
	if got := s.hub.DefaultAgent(); got != "pc-a" {
		t.Fatalf("首选没生效：%q", got)
	}

	// 断开一台不在线的机器：404（界面要能给出明确提示，而不是假装成功）
	if code, _ := post("/api/agent/kick", `{"id":"pc-a"}`); code != http.StatusNotFound {
		t.Fatalf("断开不在线的机器应 404，实际 %d", code)
	}

	// 禁止接入
	if code, body := post("/api/agent/block", `{"id":"pc-b","blocked":true}`); code != http.StatusOK {
		t.Fatalf("禁止接入应 200，实际 %d (%v)", code, body)
	}
	if got := s.hub.Snapshot().BlockedAgents; len(got) != 1 || got[0] != "pc-b" {
		t.Fatalf("禁止名单不对：%v", got)
	}

	// 只允许 POST
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/agent/default", nil)
	req.AddCookie(cookie)
	res, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("GET /api/agent/default 应 405，实际 %d", res.StatusCode)
	}

	// 重启（同一份 stateFile）后首选与禁止名单都要还在
	h2 := hub.New("token-long-enough-for-tests", "default", nil, hub.Limits{
		OpenTimeout: time.Second, MaxStreams: 8, MaxConcurrentPerIP: 8, MaxNewPerMinutePerIP: 100,
	}, logx.New(10))
	s2, err := New(config.AdminConfig{StateFile: s.path, Password: testPassword}, h2, nil, logx.New(10), "test", nil, testAgentToken)
	if err != nil {
		t.Fatal(err)
	}
	if got := s2.hub.DefaultAgent(); got != "pc-a" {
		t.Fatalf("重启后首选丢了：%q", got)
	}
	if got := s2.hub.Snapshot().BlockedAgents; len(got) != 1 || got[0] != "pc-b" {
		t.Fatalf("重启后禁止名单丢了：%v", got)
	}

	// 解除禁止
	if code, body := post("/api/agent/block", `{"id":"pc-b","blocked":false}`); code != http.StatusOK {
		t.Fatalf("解除禁止应 200，实际 %d (%v)", code, body)
	}
	if got := s.hub.Snapshot().BlockedAgents; len(got) != 0 {
		t.Fatalf("解除禁止后名单应当为空：%v", got)
	}
}

func TestGeneratedPasswordIsHashedNotStoredPlaintext(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "admin.json")
	h := hub.New("token-long-enough-for-tests", "default", nil, hub.Limits{
		OpenTimeout: time.Second, MaxStreams: 8, MaxConcurrentPerIP: 8, MaxNewPerMinutePerIP: 100,
	}, logx.New(10))
	s, err := New(config.AdminConfig{StateFile: path}, h, nil, logx.New(10), "test", nil, testAgentToken)
	if err != nil {
		t.Fatal(err)
	}
	if s.InitialPassword == "" {
		t.Fatal("未提供密码时应当生成一个初始密码")
	}
	if len(s.InitialPassword) < 12 {
		t.Errorf("初始密码太短：%q", s.InitialPassword)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), s.InitialPassword) {
		t.Fatal("初始密码明文被写进了状态文件")
	}
	if !strings.Contains(string(raw), "$2") { // bcrypt 前缀
		t.Fatal("状态文件里应当只有 bcrypt 哈希")
	}
	if bcrypt.CompareHashAndPassword([]byte(s.st.PasswordHash), []byte(s.InitialPassword)) != nil {
		t.Fatal("哈希与生成的密码对不上")
	}
}
