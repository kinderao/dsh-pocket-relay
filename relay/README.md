# dsh-pocket-relay（Go 版）

自建中继服务器。**一个静态二进制**，拷到服务器上 `nohup` 跑起来即可：

```
手机 ──HTTPS──▶ 你的服务器（relay，自己终结 TLS） ◀──出站长连接── 电脑上的 dsh web
```

- 电脑**不需要任何入站端口**，两个方向都是主动出站；
- 不依赖 Cloudflare，不装 cloudflared，地址固定；
- **TLS 由本程序自己终结，不占用 443**（用 8443/8444/8445 这类高位端口即可）；
- 内置 ACME（DNS-01），**申请证书不需要开放 80/443**，自动续期并热加载；
- 带 Web 管理端（状态 / 证书续期 / 白名单 / 日志）。

认证不会被削弱：relay 只搬字节，手机仍要在电脑侧完成**设备认证**
（见 [../README.md](../README.md) 与 [PROTOCOL.md](./PROTOCOL.md)）。

---

## 一、五分钟跑起来

### 1. 交叉编译（在你自己的电脑上）

```sh
npm run build:relay          # 当前平台 → relay/dist/
npm run build:relay:all      # linux/amd64 + linux/arm64 + 当前平台
```

产出在 `relay/dist/`。**静态链接（CGO_ENABLED=0）**，所以不挑发行版、不挑 libc。

手动编译等价于：

```sh
cd relay
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o dsh-pocket-relay .
```

> 需要 **Go 1.25+**（lego 依赖）。首次构建要拉依赖，国内建议
> `go env -w GOPROXY=https://goproxy.cn,direct`，首次数分钟，之后有缓存约半分钟。

### 2. 传到服务器

```sh
scp relay/dist/dsh-pocket-relay-linux-amd64 root@<服务器>:/opt/dsh-pocket-relay/dsh-pocket-relay
ssh root@<服务器>
cd /opt/dsh-pocket-relay
chmod +x dsh-pocket-relay
```

### 3. 生成 token 与配置

```sh
./dsh-pocket-relay gen-token          # 记下输出，PC 端要填同一串
cp config.example.json config.json    # 从仓库里拷一份
vi config.json
```

最小可用配置（先用**现有证书文件**把链路跑通，别一上来就 ACME）：

```jsonc
{
  "token": "<gen-token 的输出>",
  "agent":   { "host": "0.0.0.0", "port": 8444, "tls": true },
  "visitor": { "host": "0.0.0.0", "port": 8443, "tls": true },
  "admin":   { "enabled": true, "host": "0.0.0.0", "port": 8445, "tls": true, "stateFile": "./data/admin.json" },
  "cert": {
    "mode": "files",
    "certFile": "./certs/fullchain.pem",
    "keyFile":  "./certs/privkey.pem"
  }
}
```

校验（**不起服务**，只查配置）：

```sh
./dsh-pocket-relay check --config config.json
```

### 4. nohup 启动

```sh
mkdir -p data certs
nohup ./dsh-pocket-relay --config config.json > relay.log 2>&1 &
echo $! > relay.pid
sleep 1 && tail -20 relay.log
```

日志里会打印三个监听口；**管理端密码如果没在配置里写死，会在这里显示一次**：

```
🚀 dsh-pocket-relay 0.1.0 已启动（协议 v1）
   agent   : tls://0.0.0.0:8444
   visitor : tls://0.0.0.0:8443
   admin   : tls://0.0.0.0:8445
   证书    : www.kinderao.host（剩余 89 天，2026-12-11 到期）
[WARN] admin: 首次启动，已生成管理密码：xxxxxxxxxxxx
```

停止 / 重启：

```sh
kill $(cat relay.pid)                    # 优雅退出（日志会打印「已退出」）
nohup ./dsh-pocket-relay --config config.json >> relay.log 2>&1 & echo $! > relay.pid
```

改了配置需要**重启**才生效（没有配置热重载）。

### 5. 放行端口

```sh
ufw allow 8443/tcp     # 手机（visitor）
ufw allow 8445/tcp     # 管理端
ufw allow 8444/tcp     # 电脑（agent）——能限制来源就限制
```

云厂商安全组同样要放行这三个端口。

### 6. PC 端填上

设置页 → 手机访问 → **中继**：填服务器地址、agent 端口 `8444`、对外访问地址
`https://<域名>:8443`、上面那个 token，打开「agent 通道使用 TLS」。

「本机名称」留空即可（默认取电脑主机名）。要在一台中继上挂**多台电脑**时，
每台的名字必须不同——同名会被当成同一台，后连上来的把先到者顶下线，表现为
两边无限互相重连。详见第八节。

---

## 二、证书

`cert.mode` 两种。

### `mode: "files"` —— 沿用外部签发的证书

配合你现有的 acme.sh / certbot 产物即可。本程序负责**加载 + 监控到期 + 热加载**；
续期仍由外部工具做，续期后到管理端点一次「立即续期」按钮即可重新加载（files 模式下
这个按钮就是「重新读盘」）。

### `mode: "acme"` —— 内置申请与自动续期

```jsonc
"cert": {
  "mode": "acme",
  "domain": "www.kinderao.host",
  "email": "admin@kinderao.host",
  "dir": "./data/certs",
  "renewDays": 30,
  "checkHours": 12,
  "acme": {
    "provider": "tencentcloud",
    "secretId": "<腾讯云 SecretId>",
    "secretKey": "<腾讯云 SecretKey>",
    "keyType": "ec256"
  }
}
```

**为什么必须是 DNS-01**：HTTP-01 要占 80、TLS-ALPN-01 要占 443，而我们的前提就是
「不用 443、服务器上只开自己的业务端口」。只有 DNS-01 一个入站端口都不用开。

它做的事：

1. 启动时若 `dir` 里已有证书且剩余天数 > `renewDays` → 直接复用（不会每次重启都去打扰 CA）；
2. 否则向 Let's Encrypt 申请，证书与账户密钥写在 `dir/`（0600）；
3. 之后每 `checkHours` 小时检查一次，剩余 < `renewDays` 天就自动续期；
4. **续期成功后热加载，不需要重启进程**——证书只存在内存里，所有 TLS 监听口共用同一个回调。

腾讯云密钥：控制台 → 访问管理 → API 密钥管理。建议**单独建一个子账号**，
只授予 DNS 解析权限，别用主账号密钥。

---

## 三、Web 管理端

浏览器打开 `https://<域名>:8445`，用管理密码登录。

| 区块 | 作用 |
| --- | --- |
| 运行状态 | 谁在接流、在途连接数、三个监听口地址、对外入口地址 |
| 电脑（PC 端） | 每台电脑的名字、来源 IP、已连接时长、最后活动、在途连接数；可**设为首选**、**断开**（它会自动重连）、**禁止接入**（会被 `agent-blocked` 拒掉并停止重连，直到你解除） |
| 证书 | 域名、签发者、到期时间、剩余天数、来源（ACME/文件）、上次错误；**立即续期**按钮 |
| Agent Token | 按需查看 / 复制（默认打码，只有点「显示」时才去服务端取） |
| 访客 IP 白名单 | 一行一个 IP。留空 = 不限制。改完即时生效并持久化 |
| 日志 | 最近 120 行，3 秒刷新（省得为了看一行日志去 ssh） |

首选与禁止名单存在管理端状态文件里，重启后仍然有效。

### 密码

- 配置里写 `admin.password` → 以它为准（改密码 = 改配置后重启）；
- 不写 → 首次启动随机生成并**在日志里显示一次**，之后磁盘上只有 bcrypt 哈希
  （`admin.stateFile`，0600）。忘了密码就删掉 stateFile 重启，会重新生成。

安全上做了：登录按来源 IP 限速（连续失败 5 次锁 5 分钟）、会话是无状态签名 cookie
（HMAC + 12 小时过期）、可选 `admin.allowIps` 来源白名单、cookie 带
HttpOnly/SameSite，TLS 开启时带 Secure。

> 管理端是**新的公网入口**。介意的话把它绑到 `127.0.0.1`，用
> `ssh -L 8445:127.0.0.1:8445` 访问；或者干脆 `"enabled": false` 关掉——
> 关了不影响中继功能，只是没法在网页上看状态和续期。

---

## 四、配置字段速查

```jsonc
{
  "token": "…",                 // 必填，≥24 字符。agent 通道唯一凭据
  "agent":   { "host": "0.0.0.0", "port": 8444, "tls": true },
  "visitor": { "host": "0.0.0.0", "port": 8443, "tls": true, "proxyProtocol": false },
  "admin":   { "enabled": true, "host": "0.0.0.0", "port": 8445, "tls": true,
               "password": "", "stateFile": "./data/admin.json", "allowIps": [] },
  "cert":    { "mode": "acme", "domain": "", "email": "", "dir": "./data/certs",
               "certFile": "", "keyFile": "", "renewDays": 30, "checkHours": 12,
               "acme": { "provider": "tencentcloud", "secretId": "", "secretKey": "",
                         "region": "", "keyType": "ec256" } },
  "defaultAgent": "default",    // 首选接流的那台电脑（管理端可改；不在线时自动热备）
  "allowIps": [],               // 访客 IP 白名单，空 = 不限制
  "limits": {
    "openTimeoutMs": 10000,     // 等 agent 建数据连接的最长时间，超时给访客 504
    "maxStreams": 64,           // 全局在途连接上限
    "maxConcurrentPerIp": 32,   // 单 IP 并发上限
    "maxNewPerMinutePerIp": 240,// 单 IP 每分钟新建连接上限
    "agentIdleMs": 90000        // 控制连接多久没消息算「假死」，不再往它送访客
  }
}
```

`host` 填 `0.0.0.0` 表示对外；`port` 填 `0` 表示随机端口（自测用）。
`tls: true` 使用 `cert` 段的证书，`false` 表示该口明文。

> 若前面还要挂一层 nginx 终结 TLS：把 `visitor` 改成
> `{ "host": "127.0.0.1", "tls": false, "proxyProtocol": true }`，
> nginx 侧 `proxy_pass` + `proxy_protocol on;`——这样真实访客 IP 能传下来
> （否则限速只能看到 nginx 一个来源）。

---

## 五、systemd（可选，比 nohup 稳）

nohup 完全够用；想要开机自启与崩溃拉起就换 systemd：

```ini
[Unit]
Description=dsh-pocket-relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=dsh-relay
Group=dsh-relay
WorkingDirectory=/opt/dsh-pocket-relay
ExecStart=/opt/dsh-pocket-relay/dsh-pocket-relay --config /opt/dsh-pocket-relay/config.json
ExecStartPre=/opt/dsh-pocket-relay/dsh-pocket-relay check --config /opt/dsh-pocket-relay/config.json
Restart=always
RestartSec=3
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/opt/dsh-pocket-relay

[Install]
WantedBy=multi-user.target
```

`ProtectSystem=strict` 下只有 `ReadWritePaths` 里的目录可写 —— `cert.dir` 与
`admin.stateFile` 必须落在里面，否则证书写不进去（这是最容易踩的一条）。

---

## 六、多台电脑（多 PC 端）

一台 relay 可以同时挂多台电脑，靠 PC 侧设置里的**「本机名称」**区分：

| 项 | 说明 |
| --- | --- |
| 名字从哪来 | 留空 → 取电脑主机名（推荐）；也可以自己填（字母/数字/`-` `_` `.`，≤32 字符） |
| **名字必须不同** | 同名 = 同一台，后连上来的会把先到的顶下线，两边无限互相重连。这是最容易踩的坑 |
| 谁接流 | 管理端设的**首选**那台；首选掉线或假死（90s 无心跳）时，自动落到注册最早的备机 |
| 备机接管后手机要重新配对吗 | 要。设备凭据存在**每台电脑各自的数据目录**里，换一台电脑对手机来说就是陌生设备 |
| 想固定用某台 | 管理端「设为首选」，或把别的机器「禁止接入」 |
| 一台机器异常重连 | 管理端点「断开」，它自己会重连回来（不会像「禁止接入」那样停在那里） |

> 「禁止接入」是管理便利，不是安全边界：真正能拦住一台机器的是 **token**。
> 要彻底断掉某台电脑，改 relay 的 token 并同步更新其它电脑。

---

## 七、排障

| 现象 | 原因 |
| --- | --- |
| 手机打开是「电脑未连接到中继」503 | PC 端没连上：查 `relay.log` 有没有 `agent "…" online`；再看 token 是否一致、8444 是否放行 |
| 两台电脑互相顶下线（日志里反复 `online` / `offline`） | 两台用了**同一个**「本机名称」。改成不同名字即可（见第八节） |
| 管理端显示「无响应」 | 那台电脑的控制连接超过 `agentIdleMs` 没发过心跳（进程被杀 / 网线掉了），中继已不再往它送流量 |
| 手机打开一直转圈 | PC 在线但上游超时；看日志有没有 `等数据连接超时` |
| 手机报证书错误 | 访问的域名与 `cert.domain` 不一致；证书只对申请时那个域名有效，别用 IP 访问 |
| `token 至少 24 个字符` | 预期行为——短 token 撑不过扫段，直接拒绝启动 |
| 配置报非法 JSON | 用 Windows 记事本存过会带 BOM（程序已兼容 BOM，但仍建议 UTF-8 无 BOM） |
| 证书报 `EACCES` / 写不进去 | systemd 的 `ProtectSystem=strict`；把 `cert.dir` 加进 `ReadWritePaths` |
| 续期了但浏览器还是旧证书 | 看日志有没有 `证书续期成功`；热加载对新连接生效，刷新页面即可 |
| ACME 申请失败 | 看日志里的具体错误。最常见：腾讯云密钥没有 DNS 权限、域名不在该账号下、或域名尚未解析 |
| 改了配置没生效 | 配置没有热重载，重启进程 |

---

## 八、安全清单

- [ ] `token` 用 `gen-token` 生成，不复用别处的密码
- [ ] `agent` 口开 TLS，或只绑 Tailscale/WireGuard 内网地址（更省事也更安全）
- [ ] 腾讯云用**子账号**密钥，只给 DNS 权限
- [ ] 管理端密码改掉默认值；不用管理端就 `enabled: false`
- [ ] 云安全组只放行必要端口与来源
- [ ] `certs/privkey.pem` 与 `data/` 权限 600 / 700
- [ ] 电脑侧访问密码设成自定义强密码；完成设备配对并确认能登录
- [ ] 手机丢了 → 在电脑设置页**撤销那台设备**（不是改密码）
- [ ] 知道怎么一键停：`kill $(cat relay.pid)`

---

## 八、开发

```sh
cd relay
go vet ./...          # 静态检查
go test ./...         # 单元测试（protocol / config / hub / admin）
cd .. && npm test     # 插件全量（含 Go 服务端 ⇄ Node agent 的跨语言端到端）
```

跨语言端到端（`test/relay-go.test.js`）会真实启动这个二进制，让 **Node 侧
`lib/relay.mjs`** 连上去跑完整链路——这是「Go 服务端与 Node agent 线协议兼容」
唯一可信的证据。它需要先构建：`npm run build:relay`，没构建则整组跳过。

多机相关另有两组：`relay/internal/hub/hub_test.go`（路由规则的细节：首选/热备/
假死/同名踢连接）与 `test/relay-multi-agent.test.js`（两台 Node agent 同时挂到
真实 relay 上，验管理端的切首选/断开/禁止接入）。

| 路径 | 作用 |
| --- | --- |
| `main.go` | CLI、三个监听口、PROXY protocol、优雅退出 |
| `internal/protocol/` | 线协议（与 Node 侧 `lib/relay-protocol.mjs` 一一对应） |
| `internal/hub/` | 中继核心：agent 注册、访客流配对、字节搬运、限速 |
| `internal/certs/` | 证书：files/acme 两种来源、续期循环、热加载 |
| `internal/admin/` | Web 管理端（含内嵌单页 UI） |
| `internal/config/` | 配置加载与校验 |
| `internal/logx/` | 日志（带环形缓冲，供管理端展示） |
