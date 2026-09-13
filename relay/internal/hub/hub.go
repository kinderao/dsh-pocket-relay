// Package hub 实现 relay 核心：agent 注册 + 访客流配对 + 字节搬运。
//
// 角色与流程（详见 relay/PROTOCOL.md）：
//
//  1. PC 侧 agent 建立**控制连接**（长连接）→ hello(token) → welcome。
//  2. 访客（手机浏览器）连上 visitor 监听口 → hub 在控制连接上发 open(id)
//     → agent 立刻新建一条**数据连接**（data 握手）→ hub 把访客 conn 与
//     数据连接对接，之后纯字节透传。
//  3. 任一端断开 → 关掉另一端，并在控制连接上发 close(id)。
//
// 这个包不碰 HTTP：访客说什么协议（HTTP / WebSocket / 其它）完全不关心，
// 只负责把字节搬过去。认证、改头、压缩全部留给 PC 上原有的 lib/proxy.mjs。
package hub

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"sort"
	"sync"
	"time"

	"github.com/kinderao/dsh-pocket-relay/relay/internal/protocol"
)

// Limits 限流与超时（由 config 填充）。
type Limits struct {
	OpenTimeout          time.Duration
	MaxStreams           int
	MaxConcurrentPerIP   int
	MaxNewPerMinutePerIP int
	AgentIdle            time.Duration
}

// Logger 最小日志接口（stdout 或管理端环形缓冲都实现它）。
type Logger interface {
	Infof(format string, args ...any)
	Warnf(format string, args ...any)
}

// AgentInfo 一个在线 agent 的快照。
//
// 多机共存（同一台 relay 上挂多台电脑）就靠 id 区分：每台电脑在 hello 里报上
// 自己的 agent 名（PC 侧设置里的「本机名称」，默认取主机名），relay 把它们
// 分别登记在 agents 表里；访客流量按 pickAgentLocked 的规则送到其中一台。
type AgentInfo struct {
	ID       string    `json:"id"`
	Remote   string    `json:"remote"`
	Since    time.Time `json:"since"`
	LastSeen time.Time `json:"lastSeen"`
	// Streams 当前挂在这台 agent 上的访客连接数。
	Streams int `json:"streams"`
	// Default 是配置/管理端指定的首选 agent；Serving 是「下一个访客会去哪台」。
	Default bool `json:"default"`
	Serving bool `json:"serving"`
	// Stale 表示这条控制连接已超过 agentIdle 没发过任何帧——几乎可以肯定它
	// 已经死了（只剩下内核里的半开连接），因此不再往它上面送访客。
	Stale bool `json:"stale"`
}

type agentConn struct {
	id       string
	conn     net.Conn
	remote   string
	since    time.Time
	lastSeen time.Time
}

type stream struct {
	id        string
	agentID   string
	peerIP    string
	visitor   net.Conn
	data      net.Conn
	timer     *time.Timer
	createdAt time.Time
}

type ipState struct {
	concurrent  int
	newCount    int
	windowStart time.Time
}

// Hub 中继核心。
type Hub struct {
	token string
	// defaultAgent 首选接流的那台。语义是「默认用谁」，不是「只允许谁」：
	// 它不在线时访客会落到其它在线机器上（热备），见 pickAgentLocked。
	defaultAgent string
	allow        map[string]struct{}
	limits       Limits
	log          Logger

	mu      sync.Mutex
	agents  map[string]*agentConn
	streams map[string]*stream
	ips     map[string]*ipState
	// blocked 被管理端拒绝接入的 agent 名。注意它是**管理便利**而不是安全边界：
	// 拿着 token 的人可以改个名字连上来。真正的凭据始终是 token。
	blocked map[string]struct{}

	startedAt time.Time

	// done 在 Close 时关闭，用于打断等待中的重试
	closed bool
}

// New 创建 Hub。
func New(token, defaultAgent string, allowIPs []string, limits Limits, log Logger) *Hub {
	allow := make(map[string]struct{}, len(allowIPs))
	for _, ip := range allowIPs {
		if ip != "" {
			allow[ip] = struct{}{}
		}
	}
	return &Hub{
		token:        token,
		defaultAgent: defaultAgent,
		allow:        allow,
		limits:       limits,
		log:          log,
		agents:       map[string]*agentConn{},
		streams:      map[string]*stream{},
		ips:          map[string]*ipState{},
		blocked:      map[string]struct{}{},
		startedAt:    time.Now(),
	}
}

// agentIdle 判定「陈旧 agent」的阈值。
//
// 0 会被当成 90 秒而不是「不检查」：直接用 0 的话 time.Since 永远大于 0，
// 所有 agent 一上线就被判定为陈旧，路由会全线失败。
func (h *Hub) agentIdle() time.Duration {
	if h.limits.AgentIdle <= 0 {
		return 90 * time.Second
	}
	return h.limits.AgentIdle
}

func (h *Hub) staleLocked(a *agentConn) bool {
	return time.Since(a.lastSeen) > h.agentIdle()
}

func newID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ---------- agent 控制连接 ----------

// HandleAgent 处理一条来自 agent 的连接；首帧必须是 hello。
func (h *Hub) HandleAgent(conn net.Conn) {
	sp := protocol.NewLineSplitter(0)
	var agentID string
	remote := conn.RemoteAddr().String()

	reject := func(why string) {
		_, _ = conn.Write(protocol.EncodeControl(map[string]any{"t": protocol.TError, "error": why}))
		// 排空再关：直接 Close 会因未读数据发 RST，把上面这个 error 帧丢掉，
		// 对端就只看到「连接被重置」而不知道是 token 不对（实测 Node 侧报 ECONNRESET）。
		drainThenClose(conn, 300*time.Millisecond)
	}

	buf := make([]byte, 32*1024)
	for {
		n, err := conn.Read(buf)
		if n > 0 {
			if perr := sp.Push(buf[:n]); perr != nil {
				reject(perr.Error())
				break
			}
			// 控制连接是**纯 NDJSON**：把所有整行都处理掉
			for {
				line, ok := sp.TakeLine()
				if !ok {
					break
				}
				frame := protocol.ParseControl(line)
				if frame == nil {
					reject("bad-json")
					goto done
				}
				if agentID == "" {
					if protocol.FrameString(frame, "t") != protocol.THello {
						reject("expected-hello")
						goto done
					}
					if !protocol.TokenEquals(protocol.FrameString(frame, "token"), h.token) {
						h.log.Warnf("relay: agent auth failed from %s | agent 认证失败", remote)
						reject("bad-token")
						goto done
					}
					id := protocol.FrameString(frame, "agent")
					if id == "" {
						id = "default"
					}
					// 管理端拉黑的机器在**认证之后**才判：先判会泄露「这个名字被禁了」，
					// 而这属于管理信息，不该给未通过 token 校验的连接看。
					if h.isBlocked(id) {
						h.log.Warnf("relay: agent %q rejected (blocked by admin) | agent 被管理端禁止接入", id)
						reject("agent-blocked：该电脑已被中继管理员禁止接入 | blocked by relay admin")
						goto done
					}
					agentID = id
					h.registerAgent(agentID, conn, remote)
					_, _ = conn.Write(protocol.EncodeControl(map[string]any{
						"t": protocol.TWelcome, "v": protocol.Version, "agent": agentID,
					}))
					h.log.Infof("relay: agent %q online (%s) | agent 已上线", agentID, remote)
					continue
				}
				h.touchAgent(agentID)
				switch protocol.FrameString(frame, "t") {
				case protocol.TPing:
					h.sendToAgent(agentID, map[string]any{"t": protocol.TPong, "at": frame["at"]})
				case protocol.TClose:
					h.CloseStream(protocol.FrameString(frame, "id"), false, "agent-close")
				}
			}
		}
		if err != nil {
			break
		}
	}
done:
	h.unregisterAgent(agentID, conn)
}

func (h *Hub) registerAgent(id string, conn net.Conn, remote string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	// 同名 agent 重连：旧连接可能还没断（网络抖动），先踢掉避免两条控制连接
	if prev, ok := h.agents[id]; ok && prev.conn != conn {
		_ = prev.conn.Close()
	}
	now := time.Now()
	h.agents[id] = &agentConn{id: id, conn: conn, remote: remote, since: now, lastSeen: now}
}

func (h *Hub) touchAgent(id string) {
	h.mu.Lock()
	if a, ok := h.agents[id]; ok {
		a.lastSeen = time.Now()
	}
	h.mu.Unlock()
}

func (h *Hub) unregisterAgent(id string, conn net.Conn) {
	if id == "" {
		return
	}
	h.mu.Lock()
	if a, ok := h.agents[id]; ok && a.conn == conn {
		delete(h.agents, id)
		h.mu.Unlock()
		h.dropAgentStreams(id)
		h.log.Warnf("relay: agent %q offline | agent 已离线", id)
		return
	}
	h.mu.Unlock()
}

func (h *Hub) sendToAgent(id string, frame map[string]any) bool {
	h.mu.Lock()
	a, ok := h.agents[id]
	h.mu.Unlock()
	if !ok {
		return false
	}
	_, err := a.conn.Write(protocol.EncodeControl(frame))
	return err == nil
}

// ---------- 数据连接 ----------

// HandleData 处理一条 agent 数据连接；首帧必须是 data 握手，其后是裸字节。
func (h *Hub) HandleData(conn net.Conn) {
	sp := protocol.NewLineSplitter(0)
	buf := make([]byte, 32*1024)
	for {
		n, err := conn.Read(buf)
		if n > 0 {
			if perr := sp.Push(buf[:n]); perr != nil {
				_ = conn.Close()
				return
			}
			// 数据连接：**只取第一行**作为握手，其后全是裸流。
			// 这里必须用 TakeLine（切到第一个 '\n' 为止）而不是「切出所有行」——
			// 裸流是 HTTP 请求，里面全是 CRLF，多切一刀就会把正文当帧丢掉。
			line, ok := sp.TakeLine()
			if !ok {
				if err != nil {
					_ = conn.Close()
					return
				}
				continue
			}
			frame := protocol.ParseControl(line)
			if frame == nil || protocol.FrameString(frame, "t") != protocol.TData {
				_ = conn.Close()
				return
			}
			// 同一分片里握手行之后的字节 = 裸流开头，必须原样带走
			leftover := sp.TakeRest()
			h.pairData(conn, frame, leftover)
			return
		}
		if err != nil {
			_ = conn.Close()
			return
		}
	}
}

func (h *Hub) pairData(data net.Conn, frame map[string]any, leftover []byte) {
	// 判定顺序刻意「先校验 token，再看流是否存在」：避免未认证者靠探测
	// 流 id 是否存在来判断有没有访客在线。
	if !protocol.TokenEquals(protocol.FrameString(frame, "token"), h.token) {
		_ = data.Close()
		return
	}
	id := protocol.FrameString(frame, "id")

	h.mu.Lock()
	st, ok := h.streams[id]
	if !ok {
		h.mu.Unlock()
		_ = data.Close()
		return
	}
	if agentID := protocol.FrameString(frame, "agent"); agentID != "" && st.agentID != agentID {
		h.mu.Unlock()
		_ = data.Close()
		return
	}
	if st.data != nil { // 同一条流开了两条数据连接：拒绝后来者
		h.mu.Unlock()
		_ = data.Close()
		return
	}
	st.data = data
	if st.timer != nil {
		st.timer.Stop()
		st.timer = nil
	}
	visitor := st.visitor
	h.mu.Unlock()

	// 访客侧一直没被读过（见 HandleVisitor 的说明），内核缓冲区里攒着的字节
	// 会随下面的 io.Copy 一起流出去，一条不丢。
	if len(leftover) > 0 {
		_, _ = visitor.Write(leftover)
	}

	var once sync.Once
	teardown := func() { once.Do(func() { h.CloseStream(id, true, "closed") }) }

	go func() { _, _ = io.Copy(data, visitor); teardown() }()
	go func() { _, _ = io.Copy(visitor, data); teardown() }()
}

// ---------- 访客连接 ----------

// beginVisitor 原子地完成「白名单 + 并发 + 新建速率校验 → 选 agent → 占位」。
//
// 刻意做成一次加锁：拆成「先校验再占位」两次加锁的话，中间可能被 pruneIPs
// 把 ipState 删掉，于是并发计数加在一个已废弃的对象上，限流就此失效。
func (h *Hub) beginVisitor(ip string) (agentID string, why string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.allow) > 0 {
		if _, found := h.allow[ip]; !found {
			return "", "ip-not-allowed"
		}
	}
	now := time.Now()
	st, found := h.ips[ip]
	if !found {
		st = &ipState{windowStart: now}
		h.ips[ip] = st
	} else if now.Sub(st.windowStart) > time.Minute {
		st.newCount = 0
		st.windowStart = now
	}
	if st.concurrent >= h.limits.MaxConcurrentPerIP {
		return "", "too-many-concurrent"
	}
	if st.newCount >= h.limits.MaxNewPerMinutePerIP {
		return "", "too-many-new-connections"
	}
	agentID = h.pickAgentLocked()
	if agentID == "" {
		return "", "no-agent"
	}
	if len(h.streams) >= h.limits.MaxStreams {
		return "", "streams-full"
	}
	st.concurrent++
	st.newCount++
	return agentID, ""
}

// ReleaseVisitor 访客连接结束，归还并发计数。
func (h *Hub) ReleaseVisitor(ip string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if st, ok := h.ips[ip]; ok {
		st.concurrent--
		if st.concurrent < 0 {
			st.concurrent = 0
		}
	}
	h.pruneIPsLocked()
}

func (h *Hub) pruneIPsLocked() {
	if len(h.ips) < 2000 {
		return
	}
	now := time.Now()
	for ip, st := range h.ips {
		if st.concurrent == 0 && now.Sub(st.windowStart) > 2*time.Minute {
			delete(h.ips, ip)
		}
	}
}

// HandleVisitor 处理一条**明文**访客连接（TLS 由调用方终结）。
func (h *Hub) HandleVisitor(conn net.Conn, ip string) {
	agentID, why := h.beginVisitor(ip)
	switch why {
	case "ip-not-allowed", "too-many-concurrent", "too-many-new-connections":
		h.log.Warnf("relay: visitor from %s rejected (%s) | 访客被拒", ip, why)
		WriteHTTPError(conn, 429, "Too Many Requests",
			"访问过于频繁，请稍后再试。<br>Too many connections from this address — try again shortly.")
		return
	case "no-agent":
		WriteHTTPError(conn, 503, "Service Unavailable",
			"电脑上的 DSH 当前未连接到中继服务器。<br>请确认电脑上的 dsh web 正在运行。<br><br>"+
				"The PC is not connected to this relay right now."+
				"<br>Make sure <code>dsh web</code> is running on the computer.")
		return
	case "streams-full":
		WriteHTTPError(conn, 503, "Service Unavailable",
			"中继连接数已达上限，请稍后再试。<br>Too many concurrent streams on this relay.")
		return
	}

	id := newID()
	st := &stream{id: id, agentID: agentID, peerIP: ip, visitor: conn, createdAt: time.Now()}

	h.mu.Lock()
	h.streams[id] = st
	// 关键：不在这里读 conn。Go 的 net.Conn 只有调用 Read 才会消费数据，
	// 所以在配对前到达的访客字节会安全地留在内核缓冲区里，等 pairData 起
	// io.Copy 时原样流出（Node 版靠 pause()/resume() 达到同一效果）。
	st.timer = time.AfterFunc(h.limits.OpenTimeout, func() {
		h.mu.Lock()
		cur, ok := h.streams[id]
		pending := ok && cur.data == nil
		h.mu.Unlock()
		if !pending {
			return
		}
		h.log.Warnf("relay: stream %s timed out waiting for agent data connection | 等数据连接超时", id)
		WriteHTTPError(conn, 504, "Gateway Timeout",
			"电脑没有及时响应中继请求。<br>The PC did not answer the relayed request in time.")
		h.CloseStream(id, true, "open-timeout")
	})
	h.mu.Unlock()

	if !h.sendToAgent(agentID, map[string]any{"t": protocol.TOpen, "id": id}) {
		h.CloseStream(id, false, "agent-unreachable")
		WriteHTTPError(conn, 503, "Service Unavailable",
			"电脑上的 DSH 当前未连接到中继服务器。<br>The PC is not connected to this relay right now.")
		return
	}
	// 并发计数的归还统一由 CloseStream 负责 —— 这里**不能**再起一个
	// io.Copy(io.Discard, conn) 之类的读循环来「等连接结束」：数据连接配对后
	// 已经有 io.Copy(visitor, data) 在读同一条 conn，两个读者会互相抢字节，
	// 访客请求会被随机切碎（这是 Go 版重写时最容易踩的一个坑）。
}

// pickAgentLocked 选一台 agent 接流。
//
// 规则（多机共存 + 热备）：
//  1. defaultAgent 在线且不陈旧 → 用它（用户/配置指定的首选）；
//  2. 否则按注册时间**最早**的一台 —— 刻意不是「最新」：用最新的话，一台机器
//     每次重连都会把流量从当前机器抢走，两台互相重连时访客会在两边来回跳。
//     选最早的是稳定的：只要它还在，接流目标就不变。
//  3. 都没有 → 空字符串，调用方回 503（PC 未连接）。
func (h *Hub) pickAgentLocked() string {
	if h.defaultAgent != "" {
		if a, ok := h.agents[h.defaultAgent]; ok && !h.staleLocked(a) {
			return h.defaultAgent
		}
	}
	var best string
	var bestAt time.Time
	for id, a := range h.agents {
		if h.staleLocked(a) {
			continue
		}
		if best == "" || a.since.Before(bestAt) {
			best, bestAt = id, a.since
		}
	}
	return best
}

// CloseStream 关闭一条流；notify 时通知 agent。
func (h *Hub) CloseStream(id string, notify bool, reason string) {
	h.mu.Lock()
	st, ok := h.streams[id]
	if !ok {
		h.mu.Unlock()
		return
	}
	delete(h.streams, id)
	if st.timer != nil {
		st.timer.Stop()
	}
	h.mu.Unlock()

	if st.data != nil {
		_ = st.data.Close()
	}
	if st.visitor != nil {
		_ = st.visitor.Close()
	}
	// 并发计数在这里归还：HandleVisitor 不能自己起读循环去等连接结束
	// （会和已配对的 io.Copy(visitor, data) 抢同一批字节）。
	h.ReleaseVisitor(st.peerIP)
	if notify {
		h.sendToAgent(st.agentID, map[string]any{"t": protocol.TClose, "id": id, "reason": reason})
	}
}

func (h *Hub) dropAgentStreams(agentID string) {
	h.mu.Lock()
	ids := make([]string, 0, len(h.streams))
	for id, st := range h.streams {
		if st.agentID == agentID {
			ids = append(ids, id)
		}
	}
	h.mu.Unlock()
	for _, id := range ids {
		h.CloseStream(id, false, "agent-gone")
	}
}

// Close 关闭 hub：断开所有 agent 与流。
func (h *Hub) Close() {
	h.mu.Lock()
	h.closed = true
	agents := make([]*agentConn, 0, len(h.agents))
	for _, a := range h.agents {
		agents = append(agents, a)
	}
	ids := make([]string, 0, len(h.streams))
	for id := range h.streams {
		ids = append(ids, id)
	}
	h.mu.Unlock()

	for _, id := range ids {
		h.CloseStream(id, false, "shutdown")
	}
	for _, a := range agents {
		_ = a.conn.Close()
	}
}

// ---------- 状态 ----------

// Status hub 状态快照（管理端用）。
type Status struct {
	Agents    []AgentInfo `json:"agents"`
	Streams   int         `json:"streams"`
	TrackedIP int         `json:"trackedIps"`
	UptimeSec int64       `json:"uptimeSec"`
	// DefaultAgent 当前首选接流的 agent 名（可能改名后已不在线）。
	DefaultAgent string `json:"defaultAgent"`
	// Serving 下一个访客会被送到哪台；为空表示当前没有任何可用 agent。
	Serving string `json:"serving"`
	// BlockedAgents 被管理端禁止接入的 agent 名。
	BlockedAgents []string `json:"blockedAgents"`
}

// Snapshot 返回状态快照。
func (h *Hub) Snapshot() Status {
	h.mu.Lock()
	defer h.mu.Unlock()
	serving := h.pickAgentLocked()
	perAgent := make(map[string]int, len(h.streams))
	for _, st := range h.streams {
		perAgent[st.agentID]++
	}
	agents := make([]AgentInfo, 0, len(h.agents))
	for _, a := range h.agents {
		agents = append(agents, AgentInfo{
			ID:       a.id,
			Remote:   a.remote,
			Since:    a.since,
			LastSeen: a.lastSeen,
			Streams:  perAgent[a.id],
			Default:  h.defaultAgent == a.id,
			Serving:  serving != "" && serving == a.id,
			Stale:    h.staleLocked(a),
		})
	}
	// 固定顺序（按注册时间）：管理端每 3 秒轮询一次，map 的随机顺序会让
	// 表格里的行每次刷新都换位置，点「禁止接入」很容易点到隔壁那台。
	sort.Slice(agents, func(i, j int) bool {
		if agents[i].Since.Equal(agents[j].Since) {
			return agents[i].ID < agents[j].ID
		}
		return agents[i].Since.Before(agents[j].Since)
	})
	blocked := make([]string, 0, len(h.blocked))
	for id := range h.blocked {
		blocked = append(blocked, id)
	}
	sort.Strings(blocked)
	return Status{
		Agents:        agents,
		Streams:       len(h.streams),
		TrackedIP:     len(h.ips),
		UptimeSec:     int64(time.Since(h.startedAt).Seconds()),
		DefaultAgent:  h.defaultAgent,
		Serving:       serving,
		BlockedAgents: blocked,
	}
}

// ---------- 管理动作（Web 管理端用） ----------

func (h *Hub) isBlocked(id string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	_, ok := h.blocked[id]
	return ok
}

// SetDefaultAgent 设置首选接流的那台（空字符串 = 清除，回到「最早注册」规则）。
func (h *Hub) SetDefaultAgent(id string) {
	h.mu.Lock()
	h.defaultAgent = id
	h.mu.Unlock()
	if id == "" {
		h.log.Infof("relay: default agent cleared | 已清除首选电脑")
		return
	}
	h.log.Infof("relay: default agent set to %q | 首选电脑已切换", id)
}

// DefaultAgent 当前首选 agent 名。
func (h *Hub) DefaultAgent() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.defaultAgent
}

// KickAgent 断开某台 agent 的控制连接。
//
// 刻意**不发** error 帧：PC 侧把 error 当致命错误处理（不再重连），那对这个
// 用户按一下就要手工重启 dsh web 才恢复，太狠。直接断连即可——PC 会按退避
// 重连，语义正好是「把它踹下线，让它重新握手」。
func (h *Hub) KickAgent(id string) error {
	h.mu.Lock()
	a, ok := h.agents[id]
	h.mu.Unlock()
	if !ok {
		return fmt.Errorf("agent %q 不在线", id)
	}
	_ = a.conn.Close()
	h.log.Warnf("relay: agent %q kicked by admin | 已被管理端断开", id)
	return nil
}

// BlockAgent 禁止某台 agent 接入（在线的话立即断开）。
func (h *Hub) BlockAgent(id string) {
	if id == "" {
		return
	}
	h.mu.Lock()
	h.blocked[id] = struct{}{}
	a := h.agents[id]
	h.mu.Unlock()
	if a != nil {
		// 断开即可：它重连时会在 hello 阶段被 agent-blocked 拒掉。
		_ = a.conn.Close()
	}
	h.log.Warnf("relay: agent %q blocked by admin | 已被管理端禁止接入", id)
}

// UnblockAgent 解除禁止接入。
func (h *Hub) UnblockAgent(id string) {
	h.mu.Lock()
	delete(h.blocked, id)
	h.mu.Unlock()
	h.log.Infof("relay: agent %q unblocked by admin | 已解除禁止接入", id)
}

// SetBlockedAgents 用一份完整列表覆盖禁止接入名单（管理端状态加载用）。
func (h *Hub) SetBlockedAgents(list []string) {
	h.mu.Lock()
	h.blocked = make(map[string]struct{}, len(list))
	for _, id := range list {
		if id != "" {
			h.blocked[id] = struct{}{}
		}
	}
	h.mu.Unlock()
}

// SetAllowIPs 更新访客白名单（管理端用）。
func (h *Hub) SetAllowIPs(list []string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.allow = make(map[string]struct{}, len(list))
	for _, ip := range list {
		if ip != "" {
			h.allow[ip] = struct{}{}
		}
	}
}

// AllowIPs 当前白名单。
func (h *Hub) AllowIPs() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]string, 0, len(h.allow))
	for ip := range h.allow {
		out = append(out, ip)
	}
	return out
}

// drainThenClose 写完后先排空对端已发来的数据，再关闭连接。
//
// 为什么不能直接 Close：当**接收缓冲里还有未读数据**时，内核发的是 RST 而不是 FIN，
// 于是我们刚写出去的响应可能被对端直接丢弃（Node 侧表现为 ECONNRESET、
// 浏览器侧表现为「错误页刷不出来」）。
//
// 这不是理论风险：访客一定已经发过一整个 HTTP 请求（我们一个字都没读），
// 所以每条错误响应路径上都**必然**有未读数据。
func drainThenClose(conn net.Conn, wait time.Duration) {
	_ = conn.SetReadDeadline(time.Now().Add(wait))
	buf := make([]byte, 1024)
	for i := 0; i < 64; i++ {
		if _, err := conn.Read(buf); err != nil {
			break
		}
	}
	_ = conn.Close()
}

// WriteHTTPError 往一个**明文**连接写最小 HTTP 响应并关闭。
//
// relay 拿到的访客连接已经过 TLS 终结（自己终结或前置 nginx），所以这里是明文。
func WriteHTTPError(conn net.Conn, status int, title, detail string) {
	body := fmt.Sprintf(`<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH Pocket · %s</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px 24px;max-width:380px;width:calc(100%% - 48px);text-align:center}
h1{font-size:16px;margin:0 0 8px;color:#111827}
p{font-size:13px;color:#6b7280;margin:0;line-height:1.7}
code{background:#f3f4f6;padding:2px 6px;border-radius:6px;font-size:12px;color:#374151}
</style></head><body><div class="card">
<h1>🔌 DSH Pocket</h1>
<p>%s</p>
</div></body></html>`, title, detail)

	resp := fmt.Sprintf("HTTP/1.1 %d %s\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: %d\r\ncache-control: no-store\r\nconnection: close\r\n\r\n%s",
		status, title, len(body), body)
	_, _ = conn.Write([]byte(resp))
	drainThenClose(conn, 300*time.Millisecond)
}
