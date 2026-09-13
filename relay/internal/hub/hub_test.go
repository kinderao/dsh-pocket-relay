// 多机共存与热备的测试。
//
// 这里守的是三件很容易写错、且错了以后**表现很迷惑**的事：
//  1. 两台电脑各报一个名字 → 都能在线（同名才会互相踢）；
//  2. 首选电脑掉线/假死 → 访客自动落到另一台，且新机器上线不抢流量（不抖动）；
//  3. 管理端的断开 / 禁止接入真的生效，且禁止状态能被管理端读回来。
//
// 第 2 条尤其重要：如果选「最新注册的机器」，两台机器各自重连时会互相抢流量，
// 现象是「手机刷新一下换一台电脑」，排查起来毫无头绪。
package hub

import (
	"bufio"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/kinderao/dsh-pocket-relay/relay/internal/protocol"
)

const testToken = "0123456789abcdefghijklmnopqrstuvwxyz"

type testLogger struct{}

func (testLogger) Infof(string, ...any) {}
func (testLogger) Warnf(string, ...any) {}

func newTestHub(defaultAgent string, idle time.Duration) *Hub {
	return New(testToken, defaultAgent, nil, Limits{
		OpenTimeout:          2 * time.Second,
		MaxStreams:           64,
		MaxConcurrentPerIP:   32,
		MaxNewPerMinutePerIP: 240,
		AgentIdle:            idle,
	}, testLogger{})
}

// agentPeer 是一个假的 PC 侧 agent 控制连接（用 net.Pipe 顶掉真 socket）。
type agentPeer struct {
	t    *testing.T
	id   string
	conn net.Conn
	rd   *bufio.Reader
}

// dialAgent 建立一条控制连接并完成 hello/welcome 握手。
func dialAgent(t *testing.T, h *Hub, id string) *agentPeer {
	t.Helper()
	client, server := net.Pipe()
	go h.HandleAgent(server)
	p := &agentPeer{t: t, id: id, conn: client, rd: bufio.NewReader(client)}
	p.send(map[string]any{"t": protocol.THello, "role": "agent", "agent": id, "token": testToken, "v": protocol.Version})
	frame := p.read()
	if protocol.FrameString(frame, "t") != protocol.TWelcome {
		t.Fatalf("期望 welcome，实际 %v", frame)
	}
	return p
}

func (p *agentPeer) send(frame map[string]any) {
	p.t.Helper()
	if _, err := p.conn.Write(protocol.EncodeControl(frame)); err != nil {
		p.t.Fatalf("写控制帧失败：%v", err)
	}
}

func (p *agentPeer) read() map[string]any {
	p.t.Helper()
	line, err := p.rd.ReadBytes('\n')
	if err != nil {
		p.t.Fatalf("读控制帧失败：%v", err)
	}
	frame := protocol.ParseControl(line)
	if frame == nil {
		p.t.Fatalf("控制帧不是合法 JSON：%q", line)
	}
	return frame
}

// ping 发一次心跳并等回 pong。net.Pipe 是同步的，读到 pong 就说明服务端
// 已经把 touchAgent 做完了——后续断言「谁新鲜」才是有意义的。
func (p *agentPeer) ping() {
	p.t.Helper()
	p.send(map[string]any{"t": protocol.TPing, "at": 1})
	if f := p.read(); protocol.FrameString(f, "t") != protocol.TPong {
		p.t.Fatalf("期望 pong，实际 %v", f)
	}
}

func (p *agentPeer) close() { _ = p.conn.Close() }

func agentByID(t *testing.T, st Status, id string) AgentInfo {
	t.Helper()
	for _, a := range st.Agents {
		if a.ID == id {
			return a
		}
	}
	t.Fatalf("快照里没有 agent %q：%+v", id, st.Agents)
	return AgentInfo{}
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("等待超时：%s", what)
}

// 两台电脑各报一个名字 → 都在线，首选那台接流。
func TestMultiAgentCoexistAndPickDefault(t *testing.T) {
	h := newTestHub("pc-a", 5*time.Second)
	a := dialAgent(t, h, "pc-a")
	defer a.close()
	b := dialAgent(t, h, "pc-b")
	defer b.close()

	st := h.Snapshot()
	if len(st.Agents) != 2 {
		t.Fatalf("应当有两台在线，实际 %d：%+v", len(st.Agents), st.Agents)
	}
	// 关键回归：后来的 pc-b **不能**把 pc-a 踢掉（只有同名才会踢）
	if st.Serving != "pc-a" {
		t.Fatalf("首选是 pc-a，应当由它接流，实际 %q", st.Serving)
	}
	if st.DefaultAgent != "pc-a" {
		t.Fatalf("DefaultAgent 应为 pc-a，实际 %q", st.DefaultAgent)
	}
	if got := agentByID(t, st, "pc-b"); got.Serving || got.Default {
		t.Fatalf("pc-b 不该被标成接流/首选：%+v", got)
	}
	if !agentByID(t, st, "pc-a").Serving {
		t.Fatal("pc-a 应当被标成接流中")
	}

	// 顺序稳定：按注册时间排（管理端每 3 秒轮询，顺序跳动会让人点错按钮）
	if st.Agents[0].Since.After(st.Agents[1].Since) {
		t.Fatalf("agents 没有按注册时间排序：%+v", st.Agents)
	}
}

// 首选掉线（或假死）→ 另一台接管；新机器上线不抢流量。
func TestFailoverToOtherAgentAndStablePick(t *testing.T) {
	idle := 150 * time.Millisecond
	h := newTestHub("pc-a", idle)
	a := dialAgent(t, h, "pc-a")
	defer a.close()
	time.Sleep(20 * time.Millisecond) // 让 pc-b 的注册时间明确晚于 pc-a
	b := dialAgent(t, h, "pc-b")
	defer b.close()

	if st := h.Snapshot(); st.Serving != "pc-a" {
		t.Fatalf("首选在线时应当由它接流，实际 %q", st.Serving)
	}

	// 只让 pc-b 保持新鲜：pc-a 不发任何帧，最终被判为陈旧
	time.Sleep(idle + 60*time.Millisecond)
	b.ping()

	st := h.Snapshot()
	if st.Serving != "pc-b" {
		t.Fatalf("首选假死后应当由 pc-b 接管，实际 %q", st.Serving)
	}
	if !agentByID(t, st, "pc-a").Stale {
		t.Fatal("pc-a 超时没被标记为陈旧")
	}
	if agentByID(t, st, "pc-b").Stale {
		t.Fatal("pc-b 刚发过心跳，不该是陈旧的")
	}

	// 再来一台：接流目标必须还是 pc-b（选最新注册的机器会让流量到处跳）
	c := dialAgent(t, h, "pc-c")
	defer c.close()
	if st := h.Snapshot(); st.Serving != "pc-b" {
		t.Fatalf("新上线的机器抢走了流量，实际 %q", st.Serving)
	}
}

// 没有新鲜 agent 时明确「无人接流」，而不是把访客送给一条死连接。
func TestNoServingWhenAllAgentsStale(t *testing.T) {
	h := newTestHub("pc-a", 60*time.Millisecond)
	a := dialAgent(t, h, "pc-a")
	defer a.close()

	time.Sleep(100 * time.Millisecond)
	st := h.Snapshot()
	if st.Serving != "" {
		t.Fatalf("全部陈旧时不该有接流目标，实际 %q", st.Serving)
	}
	if !agentByID(t, st, "pc-a").Stale {
		t.Fatal("应当被标记为陈旧")
	}
}

func TestKickAgentDisconnectsAndUnregisters(t *testing.T) {
	h := newTestHub("pc-a", 5*time.Second)
	a := dialAgent(t, h, "pc-a")
	defer a.close()

	if err := h.KickAgent("pc-a"); err != nil {
		t.Fatalf("断开在线 agent 不该报错：%v", err)
	}
	waitFor(t, "被断开的 agent 应当从列表里消失", func() bool {
		return len(h.Snapshot().Agents) == 0
	})
	if err := h.KickAgent("pc-a"); err == nil {
		t.Fatal("断开一台不在线的机器应当报错（管理端要能提示用户）")
	}
}

func TestBlockedAgentIsRejectedAndUnblockRestores(t *testing.T) {
	h := newTestHub("default", 5*time.Second)
	h.BlockAgent("bad")

	client, server := net.Pipe()
	go h.HandleAgent(server)
	defer client.Close()
	rd := bufio.NewReader(client)
	if _, err := client.Write(protocol.EncodeControl(map[string]any{
		"t": protocol.THello, "role": "agent", "agent": "bad", "token": testToken, "v": protocol.Version,
	})); err != nil {
		t.Fatal(err)
	}
	line, err := rd.ReadBytes('\n')
	if err != nil {
		t.Fatalf("被禁的 agent 应当收到一帧说明原因，而不是被静默断链：%v", err)
	}
	frame := protocol.ParseControl(line)
	if protocol.FrameString(frame, "t") != protocol.TError {
		t.Fatalf("期望 error 帧，实际 %v", frame)
	}
	if !strings.Contains(protocol.FrameString(frame, "error"), "agent-blocked") {
		t.Fatalf("error 帧应当说明是 agent-blocked，实际 %v", frame)
	}
	if n := len(h.Snapshot().Agents); n != 0 {
		t.Fatalf("被禁的机器不该登记进 agents，实际 %d 台", n)
	}

	// 解除禁止后应当能正常握手（否则「解除」按钮就是个摆设）
	h.UnblockAgent("bad")
	ok := dialAgent(t, h, "bad")
	defer ok.close()
	if n := len(h.Snapshot().Agents); n != 1 {
		t.Fatalf("解除禁止后应当能上线，实际 %d 台", n)
	}
}

func TestSetBlockedAgentsAppearsInStatus(t *testing.T) {
	h := newTestHub("default", 5*time.Second)
	h.SetBlockedAgents([]string{"pc-b", "pc-a", ""})
	st := h.Snapshot()
	if len(st.BlockedAgents) != 2 || st.BlockedAgents[0] != "pc-a" || st.BlockedAgents[1] != "pc-b" {
		t.Fatalf("禁止名单应当是去重且排好序的：%v", st.BlockedAgents)
	}
}

// 同名的旧连接必须被踢掉：PC 网络抖动时会出现「新连接已建立、旧连接还没断」，
// 两条控制连接都收 open 会导致访客流量被随机分到两条上。
func TestSameAgentIDKicksPreviousConnection(t *testing.T) {
	h := newTestHub("pc-a", 5*time.Second)
	first := dialAgent(t, h, "pc-a")
	defer first.close()

	second := dialAgent(t, h, "pc-a")
	defer second.close()

	if n := len(h.Snapshot().Agents); n != 1 {
		t.Fatalf("同名只该有一条控制连接，实际 %d", n)
	}
	// 旧连接被服务端关闭 → 客户端读会立刻拿到 EOF/错误
	_ = first.conn.SetReadDeadline(time.Now().Add(time.Second))
	if _, err := first.rd.ReadByte(); err == nil {
		t.Fatal("旧连接应当已被服务端断开")
	}
}
