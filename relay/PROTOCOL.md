# dsh-pocket-relay 线协议

版本：**1**

| 角色 | 实现 |
| --- | --- |
| 服务端（relay） | **Go**：`relay/internal/protocol/protocol.go` |
| 客户端（PC agent） | **Node**：`lib/relay-protocol.mjs` |

两端各自持有一份实现（Go 与 Node 之间不存在共享模块，硬凑共享只会多一层构建步骤）。
协议本身很小——3 类帧 + 一行 NDJSON + 常量时间比较——复制一份的维护成本远低于引入
代码生成的复杂度。

**改协议必须同时改这两处，并把本文档当作唯一权威描述。**

> 历史：服务端曾是 Node（`relay/lib/protocol.mjs` + `relay/relay.mjs`），已整体替换为
> Go 单二进制。Node 侧那份协议文件保留在 `lib/relay-protocol.mjs`（PC agent 用）。

## 连接拓扑

```
                 ┌──────────── 控制连接（NDJSON，长连接，token 认证） ────────────┐
                 │                                                                │
   PC agent ─────┤                                                                ├──── relay
                 │                                                                │
                 └──── 数据连接 ×N（首行 NDJSON 握手，其后纯裸字节） ─────────────┘

   手机浏览器 ──── 裸 TCP（relay 不解析，纯字节搬运） ────▶ relay ────▶ 某条数据连接
```

relay 的 agent 监听口上跑着**两种**连接，靠首帧的 `t` 区分：

| 首帧 `t` | 含义 |
| --- | --- |
| `hello` | 控制连接 |
| `data` | 数据连接（对应某条访客流） |

## 帧格式

### 控制连接

NDJSON：一行一条 JSON，以 `\n` 结束。

| 方向 | 帧 | 字段 | 说明 |
| --- | --- | --- | --- |
| agent → relay | `hello` | `role:"agent"`, `agent`, `token`, `v` | 首帧。token 错 → relay 回 `error` 并断开；同名会踢掉旧连接 |
| relay → agent | `welcome` | `v`, `agent` | 握手通过。`v` 不匹配时 agent **停止重连**并报错 |
| relay → agent | `open` | `id` | 请为该流新建一条数据连接 |
| 双向 | `close` | `id`, `reason?` | 关闭该流 |
| agent → relay | `ping` | `at` | 心跳 |
| relay → agent | `pong` | `at` | 心跳应答 |
| relay → agent | `error` | `error` | 致命错误，随后断开 |

### 数据连接

首行是一条 NDJSON `data` 帧，**其后是纯裸字节，不再有任何封装**：

```
{"t":"data","id":"<streamId>","agent":"default","token":"<token>"}\n
<裸字节…>
```

**关键实现约束**：解析握手行时，同一 TCP 分片里跟在**第一个** `\n` 后面的字节必须
原样保留并交给对端，不能丢。

这里有个真实踩过的坑（Go 重写时被抓出来，Node 版同样存在但从未触发）：**不能**用
「切出所有行、再取剩余」的写法。裸流里必然含 `\n`（HTTP 请求就是一堆 CRLF），
那样「剩余」会是**最后一个** `\n` 之后的内容，中间那些「行」会被当帧丢掉：

```
HANDSHAKE\nGET / HTTP/1.1\r\nHost: x\r\n\r\n
         └──────── 这些会被当帧丢掉 ────────┘
```

表现为随机丢请求头，且只在握手行与正文落进同一个 TCP 读时才复现（平时握手单独
读回来，所以很容易蒙混过关）。正确做法是「**只切到第一个 `\n`**」：

- Go：`LineSplitter.TakeLine()` 之后立刻 `TakeRest()`
- Node：`makeLineSplitter().push()` 之后只取 `lines[0]`，再 `takeRest()`

守护测试：`relay/internal/protocol/protocol_test.go` 的 `TestTakeLineStopsAtFirstNewline`。

## 一条流的一生

1. 访客连上 relay 的 visitor 口。
2. relay 选一个在线 agent（见下节「多台电脑」），分配流 `id`，在控制连接上发 `open`。
3. relay **暂时不读访客连接**——握手期间到达的访客字节留在内核缓冲区里。
4. agent 收到 `open`：连本机代理（默认 `127.0.0.1:3081`）→ 建数据连接 → 写 `data` 握手 →
   把两端对接（上游先暂停，等握手写完再开始转发，否则响应头会跑到握手行前面）。
5. relay 收到数据连接：校验 token 与 `id` → 把访客连接与数据连接对接，开始双向搬运。
6. 任一端断开 → 关掉另一端，并在控制连接上发 `close`。

> **为什么第 3 步不能读**：访客（浏览器）连上就发请求，而 relay 还要等 agent 建数据连接。
> 这几毫秒内如果读走了字节就无处安放，表现为随机丢请求头。
> Go 里靠「配对前不调用 Read」天然实现（内核缓冲兜着），Node 版靠 `pause()`/`resume()`。
> 守护测试：`test/relay-go.test.js`「裸字节双向透传」。

## 多台电脑（多 agent）

一台 relay 上可以同时挂多台电脑：`hello.agent` 就是区分它们的名字（PC 侧设置里的
「本机名称」，留空则取主机名）。relay 按名字把控制连接登记在 `agents` 表里。

| 规则 | 说明 |
| --- | --- |
| 同名 = 同一台 | 同名的新控制连接会**踢掉**旧连接（网络抖动时会出现「新连接已建好、旧连接还没断」，两条都收 `open` 会让访客流量随机分到两条上） |
| 谁接流 | 首选（`defaultAgent` / 管理端设置）优先；首选不在线或假死时，落到**注册时间最早**的那台 |
| 为什么不选「最新」 | 用最新的话，两台机器各自重连时会互相抢流量，现象是「手机刷新一次换一台电脑」 |
| 假死判定 | 控制连接超过 `limits.agentIdleMs`（默认 90s）没有任何帧 → 视为已死，不再往它送访客，快照里标 `stale` |
| 没有可用 agent | 访客拿到 503（PC 未连接），**不会**被送进一条死连接 |

数据连接上的 `agent` 字段会与流所属的 agent 校验：不属于该流的数据连接一律拒绝。

管理端可以切首选、断开某台（它自动重连）、禁止某台接入（`error: agent-blocked`，
PC 侧会停止重连并把原因显示在界面上）。这些是**路由与排障**手段，不是安全边界：
真正的凭据始终是 token，拿到 token 的人可以改个名字连上来。

## 为什么不做流多路复用

浏览器对单个源本来就只开 6 条左右长连接并复用，所以「一连接一流」实际只产生个位数条
数据连接，对个人远控完全够用。而自研多路复用要正确处理窗口/流控/队头阻塞，属于纯风险。
隧道越薄，越不容易出玄学问题。

## 认证与信任边界

| 位置 | 凭据 | 说明 |
| --- | --- | --- |
| agent → relay | `token`（≥24 字符） | 控制连接与数据连接都校验；常量时间比较 |
| 访客 → PC | 不变：dsh-pocket 的访问密码 | **由 `lib/proxy.mjs` 在 3081 上执行**，relay 不参与 |

relay **不解析 HTTP、不改头、不做认证**——这是刻意的：认证、Host/Origin 改写、限速、
压缩全部留在 PC 上原有的 `lib/proxy.mjs` 里，中继通道因此天然继承那套安全语义
（relay 来的访客 Host 是公网域名，`classifyHost` 判为 `public` → 自动强制公网密码）。

relay 只做两件自己的事：

1. **agent token 校验**——没有它，任何人都能注册成 agent 接走你的访客。
2. **访客侧限速**（按真实 IP 的并发数与新建速率、可选白名单）——因为经 relay 进入
   PC 的流量源地址是 loopback，`lib/proxy.mjs` 的 `clientIp()` 只能看到同一个身份，
   单 IP 锁定会变成「一个人输错就把你锁在门外」。守护测试：
   `test/relay-go.test.js` 的 503 / token 拒绝用例。

> 另有一处与协议无关但同源的坑：relay 给访客写错误页（503/429/504）或给 agent 写
> `error` 帧后**不能直接 `Close()`**——接收缓冲里还有未读数据时内核发的是 RST，
> 会把刚写出去的响应丢掉（Node 侧表现为 `ECONNRESET`，浏览器侧表现为错误页刷不出来）。
> 由于访客必然已经发过一整个 HTTP 请求，这条路径上**总是**有未读数据，所以要先排空再关。
> 见 `relay/internal/hub/hub.go` 的 `drainThenClose`。

## 版本兼容

`welcome.v` 与对端版本不一致时，agent **不重连**，直接把「版本不匹配」摆到界面上。
宁可给用户一句人话，也不要无限重试刷日志——这条与 `lib/proxy.mjs` 处理 Safari 握手
死循环的思路一致。

relay 侧同样会拒绝版本不符的 `hello`（握手即回 `error`），避免两端半懂不懂地跑。
