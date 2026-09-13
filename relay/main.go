// dsh-pocket-relay —— 自建中继服务器（Go 单文件静态二进制）
//
// 用法（拷贝到服务器后直接 nohup 跑）：
//
//	./dsh-pocket-relay gen-token > token.txt    # 生成 agent token
//	./dsh-pocket-relay check --config config.json
//	nohup ./dsh-pocket-relay --config config.json > relay.log 2>&1 &
//
// 三个监听口：
//
//	agent    ← PC 侧 relay 客户端（lib/relay.mjs）出站连进来
//	visitor  ← 手机浏览器
//	admin    ← Web 管理端（密码登录）
//
// 设计要点见 relay/README.md 与 relay/PROTOCOL.md。
package main

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/kinderao/dsh-pocket-relay/relay/internal/admin"
	"github.com/kinderao/dsh-pocket-relay/relay/internal/certs"
	"github.com/kinderao/dsh-pocket-relay/relay/internal/config"
	"github.com/kinderao/dsh-pocket-relay/relay/internal/hub"
	"github.com/kinderao/dsh-pocket-relay/relay/internal/logx"
	"github.com/kinderao/dsh-pocket-relay/relay/internal/protocol"
)

// version 构建时可用 -ldflags "-X main.version=..." 覆盖。
var version = "dev"

func main() {
	args := os.Args[1:]

	// 子命令：gen-token / check / run（默认）
	//
	// 注意 check 必须在这里被**摘掉**：Go 的 flag 包遇到第一个非 flag 参数就
	// 停止解析，留着 "check" 的话后面的 --config 根本不会被读到，程序会退回到
	// 默认的 config.json（表现为「明明指了配置却说读不到 config.json」）。
	checkDefault := false
	if len(args) > 0 {
		switch args[0] {
		case "gen-token":
			fmt.Println(GenerateToken())
			fmt.Fprintln(os.Stderr, "\n把上面这串填进 config.json 的 \"token\"，PC 端设置页填同一串。")
			return
		case "version", "--version", "-v":
			fmt.Printf("dsh-pocket-relay %s (protocol v%d)\n", version, protocol.Version)
			return
		case "help", "--help", "-h":
			usage()
			return
		case "check":
			args = args[1:]
			checkDefault = true
		case "run":
			args = args[1:]
		}
	}

	fs := flag.NewFlagSet("dsh-pocket-relay", flag.ExitOnError)
	configPath := fs.String("config", "config.json", "配置文件路径")
	checkOnly := fs.Bool("check", checkDefault, "只校验配置并打印监听计划，不起服务")
	fs.Usage = usage
	_ = fs.Parse(args)

	cfg, err := config.Load(*configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ %v\n", err)
		os.Exit(1)
	}

	if *checkOnly {
		printPlan(cfg)
		fmt.Println("\n✅ 配置合法")
		return
	}

	if err := run(cfg); err != nil {
		fmt.Fprintf(os.Stderr, "❌ %v\n", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `dsh-pocket-relay — 自建中继服务器

用法：
  dsh-pocket-relay gen-token                 生成 agent token
  dsh-pocket-relay check --config <path>     只校验配置
  dsh-pocket-relay --config <path>           启动中继
  dsh-pocket-relay version

配置字段见 config.example.json，部署说明见 README.md。
`)
}

// GenerateToken 生成 32 字节 base64url token（约 43 字符）。
func GenerateToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func printPlan(cfg *config.Config) {
	scheme := func(t bool) string {
		if t {
			return "tls"
		}
		return "tcp"
	}
	fmt.Printf("agent   : %s://%s\n", scheme(cfg.Agent.TLS), config.ListenerAddr(cfg.Agent))
	fmt.Printf("visitor : %s://%s", scheme(cfg.Visitor.TLS), config.ListenerAddr(cfg.Visitor))
	if cfg.Visitor.ProxyProtocol {
		fmt.Print("（PROXY protocol 开）")
	}
	fmt.Println()
	if cfg.Admin.Enabled {
		fmt.Printf("admin   : %s://%s:%d\n", scheme(cfg.Admin.TLS), cfg.Admin.Host, cfg.Admin.Port)
	} else {
		fmt.Println("admin   : 已禁用")
	}
	fmt.Printf("证书    : mode=%s", cfg.Cert.Mode)
	if cfg.Cert.Mode == "acme" {
		fmt.Printf(" domain=%s provider=%s", cfg.Cert.Domain, cfg.Cert.ACME.Provider)
	}
	fmt.Printf("\ntoken   : %d 字符\n", len(cfg.Token))
	if len(cfg.AllowIPs) > 0 {
		fmt.Printf("白名单  : %s\n", strings.Join(cfg.AllowIPs, ", "))
	} else {
		fmt.Println("白名单  : （未限制）")
	}
}

func run(cfg *config.Config) error {
	log := logx.New(logx.DefaultRingSize)

	// ---------- 证书 ----------
	var certMgr *certs.Manager
	if cfg.NeedsTLS() {
		var err error
		certMgr, err = certs.New(cfg.Cert, log)
		if err != nil {
			return fmt.Errorf("证书准备失败：%w", err)
		}
		certMgr.Start()
		defer certMgr.Stop()
	}

	// ---------- 中继核心 ----------
	h := hub.New(cfg.Token, cfg.DefaultAgent, cfg.AllowIPs, hub.Limits{
		OpenTimeout:          time.Duration(cfg.Limits.OpenTimeoutMs) * time.Millisecond,
		MaxStreams:           cfg.Limits.MaxStreams,
		MaxConcurrentPerIP:   cfg.Limits.MaxConcurrentPerIP,
		MaxNewPerMinutePerIP: cfg.Limits.MaxNewPerMinutePerIP,
		AgentIdle:            time.Duration(cfg.Limits.AgentIdleMs) * time.Millisecond,
	}, log)

	// ---------- 监听 ----------
	agentLn, err := listen(cfg.Agent, certMgr)
	if err != nil {
		return fmt.Errorf("agent 口监听失败：%w", err)
	}
	defer agentLn.Close()

	visitorLn, err := listen(cfg.Visitor, certMgr)
	if err != nil {
		return fmt.Errorf("visitor 口监听失败：%w", err)
	}
	defer visitorLn.Close()

	// ---------- Web 管理端 ----------
	addrs := map[string]string{
		"agent":   agentLn.Addr().String(),
		"visitor": visitorLn.Addr().String(),
	}
	var adminLn net.Listener
	var adminSrv *http.Server
	if cfg.Admin.Enabled {
		as, aerr := admin.New(cfg.Admin, h, certMgr, log, version, addrs, cfg.Token)
		if aerr != nil {
			return fmt.Errorf("管理端初始化失败：%w", aerr)
		}
		adminLn, err = listen(config.Listener{
			Host: cfg.Admin.Host, Port: cfg.Admin.Port, TLS: cfg.Admin.TLS,
		}, certMgr)
		if err != nil {
			return fmt.Errorf("管理端口监听失败：%w", err)
		}
		defer adminLn.Close()
		addrs["admin"] = adminLn.Addr().String()
		if as.InitialPassword != "" {
			// 只显示这一次：之后磁盘上只有 bcrypt 哈希。用户没记下就要删 stateFile 重来。
			log.Warnf("admin: 首次启动，已生成管理密码：%s", as.InitialPassword)
			log.Warnf("admin: 请立即记录；也可在配置里显式设置 admin.password 覆盖它")
		}
		adminSrv = &http.Server{Handler: as.Handler(), ReadHeaderTimeout: 10 * time.Second}
		go func() {
			if serr := adminSrv.Serve(adminLn); serr != nil && serr != http.ErrServerClosed {
				log.Warnf("admin: 服务退出：%v", serr)
			}
		}()
	}

	// 给测试/脚本用的一行机器可读输出，紧跟在人工可读摘要之后。
	adminPart := ""
	if adminLn != nil {
		adminPart = " admin=" + adminLn.Addr().String()
	}
	fmt.Printf("relay-listen agent=%s visitor=%s%s\n", agentLn.Addr().String(), visitorLn.Addr().String(), adminPart)

	log.Infof("🚀 dsh-pocket-relay %s 已启动（协议 v%d）", version, protocol.Version)
	log.Infof("   agent   : %s://%s", scheme(cfg.Agent.TLS), agentLn.Addr())
	log.Infof("   visitor : %s://%s", scheme(cfg.Visitor.TLS), visitorLn.Addr())
	if adminLn != nil {
		log.Infof("   admin   : %s://%s", scheme(cfg.Admin.TLS), adminLn.Addr())
	}
	if certMgr != nil {
		st := certMgr.Status()
		log.Infof("   证书    : %s（剩余 %d 天，%s 到期）", st.Domain, st.DaysLeft, st.NotAfter.Format("2006-01-02"))
	}
	log.Infof("等待 PC 侧 relay 客户端接入…")

	var wg sync.WaitGroup
	wg.Add(2)

	// agent 口：控制连接与数据连接靠首帧区分（hello vs data）
	go func() {
		defer wg.Done()
		for {
			conn, err := agentLn.Accept()
			if err != nil {
				return // 监听已关闭
			}
			go dispatchAgent(h, conn)
		}
	}()

	// visitor 口：relay 拿到的是明文连接（TLS 已由 certMgr 终结）
	go func() {
		defer wg.Done()
		for {
			conn, err := visitorLn.Accept()
			if err != nil {
				return
			}
			go serveVisitor(h, conn, cfg.Visitor.ProxyProtocol)
		}
	}()

	// ---------- 优雅退出 ----------
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	log.Infof("收到 %s，正在退出…", sig)

	_ = agentLn.Close()
	_ = visitorLn.Close()
	if adminSrv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_ = adminSrv.Shutdown(ctx)
		cancel()
	}
	h.Close()
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
	}
	log.Infof("👋 dsh-pocket-relay 已退出 | bye")
	return nil
}

func scheme(t bool) string {
	if t {
		return "tls"
	}
	return "tcp"
}

// listen 按配置创建监听器（明文或 TLS）。
func listen(l config.Listener, certMgr *certs.Manager) (net.Listener, error) {
	addr := config.ListenerAddr(l)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, err
	}
	if !l.TLS {
		return ln, nil
	}
	if certMgr == nil {
		_ = ln.Close()
		return nil, fmt.Errorf("配置要求 TLS 但没有可用的证书管理器")
	}
	// 用 tls.NewListener 而不是手写握手循环：证书由 certMgr 动态提供，
	// 续期后新连接立刻用新证书，无需重启。
	return tls.NewListener(ln, certMgr.TLSConfig()), nil
}

// dispatchAgent 读出 agent 口连接的首帧来区分控制连接与数据连接。
//
// 用 bufio.Reader 窥探而不是直接读走：两个处理器都期望「从头」拿到这条流，
// 所以窥探必须无损（把读到的字节再拼回去）。这是唯一的无依赖做法。
func dispatchAgent(h *hub.Hub, conn net.Conn) {
	defer func() {
		if r := recover(); r != nil {
			_ = conn.Close()
		}
	}()

	probe := newProbeConn(conn)
	line, err := probe.PeekLine(64 * 1024)
	if err != nil {
		_ = conn.Close()
		return
	}
	frame := protocol.ParseControl(line)
	if protocol.FrameString(frame, "t") == protocol.TData {
		h.HandleData(probe)
		return
	}
	h.HandleAgent(probe)
}

// serveVisitor 处理一条访客连接，必要时先解析 PROXY protocol 头拿真实 IP。
func serveVisitor(h *hub.Hub, conn net.Conn, proxyProto bool) {
	defer func() {
		if r := recover(); r != nil {
			_ = conn.Close()
		}
	}()

	peer := conn.RemoteAddr().String()
	host, _, err := net.SplitHostPort(peer)
	if err != nil {
		host = peer
	}

	target := conn
	if proxyProto {
		if realIP, wrapped := parseProxyProtocol(conn); realIP != "" {
			host = realIP
			target = wrapped
		} else if wrapped != nil {
			// 不是 PROXY 头：字节已原样还回，照常处理
			target = wrapped
		}
	}
	h.HandleVisitor(target, host)
}

// parseProxyProtocol 读取 PROXY protocol v1 头，返回真实客户端 IP 与「已把字节还回去」的连接。
//
// 与 Node 版同样的取舍：**无损**。不是 PROXY 头时把读到的字节原样拼回，
// 于是直连 relay 的明文请求也照常工作，不会被误伤。
func parseProxyProtocol(conn net.Conn) (string, net.Conn) {
	pc := newProbeConn(conn)
	line, err := pc.PeekLine(107) // PROXY v1 头最长 107 字节
	if err != nil {
		return "", pc
	}
	s := strings.TrimRight(string(line), "\r\n")
	if !strings.HasPrefix(s, "PROXY ") {
		return "", pc
	}
	fields := strings.Fields(s)
	// PROXY TCP4 <src> <dst> <sport> <dport>
	if len(fields) >= 3 && (fields[1] == "TCP4" || fields[1] == "TCP6") {
		pc.Consume(len(line)) // 头本身不往下游传
		return fields[2], pc
	}
	pc.Consume(len(line)) // PROXY UNKNOWN：吃掉即可
	return "", pc
}

// probeConn 支持「窥探一行再决定怎么处理」的连接包装：
// PeekLine 只读不消费，Consume 才真正丢弃；未 Consume 的字节会在后续 Read 时原样吐出。
type probeConn struct {
	net.Conn
	buf []byte // 已从底层读出但尚未交给调用方的字节
}

func newProbeConn(c net.Conn) *probeConn { return &probeConn{Conn: c} }

// PeekLine 读取直到 '\n'（含）或达到 maxBytes，返回读到的字节但不消费。
func (c *probeConn) PeekLine(maxBytes int) ([]byte, error) {
	one := make([]byte, 1)
	for len(c.buf) < maxBytes {
		n, err := c.Conn.Read(one)
		if n > 0 {
			c.buf = append(c.buf, one[0])
			if one[0] == '\n' {
				return c.buf, nil
			}
		}
		if err != nil {
			if len(c.buf) > 0 {
				return c.buf, nil
			}
			return nil, err
		}
	}
	return c.buf, nil
}

// Consume 丢弃前 n 个已窥探的字节。
func (c *probeConn) Consume(n int) {
	if n >= len(c.buf) {
		c.buf = nil
		return
	}
	c.buf = c.buf[n:]
}

// Read 先吐出窥探缓冲，再读底层连接。
func (c *probeConn) Read(p []byte) (int, error) {
	if len(c.buf) > 0 {
		n := copy(p, c.buf)
		c.buf = c.buf[n:]
		return n, nil
	}
	return c.Conn.Read(p)
}
