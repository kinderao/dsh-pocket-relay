// dsh-pocket relay 客户端（PC 侧 agent）
//
// 跑在 dsh web 进程内，出站长连接到自建 relay 服务器；收到 relay 的 open 后，
// 为那条访客连接**新建一条数据连接**并把它接到本机 dsh-pocket 代理（默认 3081）。
//
//   relay(服务器) ──控制连接(长连接)──▶ agent(本模块)
//                 ◀──open(id)────────
//   relay          ◀──数据连接(每流一条)── agent ──TCP──▶ 127.0.0.1:3081
//
// 关键取舍：**只搬字节，不动 HTTP**。认证、Host/Origin 改写、压缩、WS 心跳全部
// 由原有的 lib/proxy.mjs 负责，所以中继通道天然继承那套安全语义——relay 来的
// 访客 Host 是公网域名，classifyHost 判为 public，自动强制公网密码。
//
// 常开（无人监听）由上层保证：lib/index.js 在插件 apply 时直接 start()，不等用户点。

import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { encodeControl, makeLineSplitter, parseControl, T, PROTOCOL_VERSION } from './relay-protocol.mjs';

/** 默认重连退避（指数 + 抖动，避免服务器重启时全部客户端同时打过来）。 */
export const DEFAULT_BACKOFF = { minMs: 1_000, maxMs: 30_000, factor: 2, jitter: 0.2 };

/** 默认心跳：25s 一次 ping；90s 收不到任何帧判定链路已死。 */
export const DEFAULT_HEARTBEAT = { intervalMs: 25_000, timeoutMs: 90_000 };

/** agent 名字符集（与 relay 侧 relay/internal/config 的 ValidAgentID 必须一致）。 */
const AGENT_ID_RE = /^[A-Za-z0-9._-]{1,32}$/;

/**
 * 本机默认 agent 名：主机名的安全化形式。
 *
 * 为什么不再用固定的 "default"：relay 按名字登记机器，**同名会被当成同一台**
 * （后来者把先到者踢掉）。多台电脑都叫 default 就会互相踢下线、无限重连——
 * 这正是不填名字时看到的现象。主机名天然每台不同，所以拿它当默认值，
 * 用户什么都不用配就能多机共存；想改名就在设置里填「本机名称」。
 */
export function localAgentId() {
  let host = '';
  try {
    host = hostname() || '';
  } catch {
    // 极少数环境取不到主机名；不能因此让整个 relay 起不来
  }
  const clean = host
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 32);
  if (clean) return clean;
  // 主机名是非 ASCII（中文机器名很常见），整个被替换掉了。用哈希保证
  // 「非空 + 每台不同」；退化成固定值就又会互相踢，那等于没修。
  const h = createHash('sha256').update(host || `pid-${process.pid}`).digest('hex').slice(0, 8);
  return `pc-${h}`;
}

/** 校验 agent 名（设置页保存前先拦，避免写到服务端才被拒）。 */
export function isValidAgentId(id) {
  return AGENT_ID_RE.test(String(id ?? ''));
}

/**
 * 创建一个 relay agent（不自动连接；调用 start() 才开始）。
 *
 * @param {object} opts
 * @param {string} opts.host                relay 服务器地址
 * @param {number} opts.port                relay 的 agent 监听端口
 * @param {boolean} [opts.tls]              agent 通道是否走 TLS（**强烈建议 true**）
 * @param {string} [opts.servername]        TLS SNI / 证书校验用主机名（默认取 host）
 * @param {boolean} [opts.rejectUnauthorized] 自签证书场景可设 false（有中间人风险）
 * @param {string} opts.token               与 relay 配置里一致的共享密钥
 * @param {string} [opts.agentId]           agent 名（relay 多机路由用；默认取主机名）
 * @param {() => number} opts.getTargetPort 实时取本机代理端口（代理会自动顺延端口）
 * @param {string} [opts.targetHost]        本机代理地址（默认 127.0.0.1）
 * @param {object} [opts.backoff]           覆盖 DEFAULT_BACKOFF
 * @param {object} [opts.heartbeat]         覆盖 DEFAULT_HEARTBEAT
 * @param {object} [opts.log]               日志（info/warn/error）
 */
export function createRelayAgent({
  host,
  port,
  tls = false,
  servername,
  rejectUnauthorized = true,
  token = '',
  agentId = localAgentId(),
  getTargetPort,
  targetHost = '127.0.0.1',
  backoff = {},
  heartbeat = {},
  log = console,
} = {}) {
  const bo = { ...DEFAULT_BACKOFF, ...backoff };
  const hb = { ...DEFAULT_HEARTBEAT, ...heartbeat };
  const logInfo = (...a) => (log.info ?? log.log).call(log, ...a);
  const logWarn = (...a) => (log.warn ?? log.log).call(log, ...a);

  /** @type {import('node:net').Socket|null} */
  let control = null;
  /** streamId -> { id, upstream, data } */
  const active = new Map();
  /** 控制连接的 NDJSON 行切分器；每次重连都换新实例（避免上一轮的半截行污染）。 */
  let splitter = makeLineSplitter();
  let running = false;
  let reconnectTimer = null;
  let pingTimer = null;
  let attempt = 0;
  let fatal = null;
  let lastRxAt = 0;
  let status = { phase: 'idle', detail: '', since: null, reconnects: 0, streams: 0, error: '' };

  function setStatus(phase, detail = '') {
    status = {
      ...status,
      phase,
      detail,
      streams: active.size,
      error: phase === 'error' ? detail : '',
      since: Date.now(),
    };
  }

  function relaySocketOptions() {
    const base = { host, port };
    if (!tls) return base;
    return {
      ...base,
      servername: servername || host,
      rejectUnauthorized,
    };
  }

  /** 建一条到 relay 的 socket（控制连接与数据连接共用）。 */
  function dialRelay() {
    return tls ? tlsConnect(relaySocketOptions()) : netConnect(relaySocketOptions());
  }

  /** 把一条流上下两端都关掉；notify 时顺带告诉 relay（对方主动关就不用回通知）。 */
  function closeStream(id, { notify = true } = {}) {
    const entry = active.get(id);
    if (!entry) return;
    active.delete(id);
    for (const s of [entry.upstream, entry.data]) {
      if (s && !s.destroyed) {
        try { s.destroy(); } catch { /* 已销毁 */ }
      }
    }
    if (notify && control && !control.destroyed) {
      try { control.write(encodeControl({ t: T.close, id })); } catch { /* 忽略 */ }
    }
    status = { ...status, streams: active.size };
  }

  function closeAllStreams() {
    for (const id of [...active.keys()]) closeStream(id, { notify: false });
  }

  /**
   * relay 要求为某条访客连接开流：连本机代理 + 建数据连接 + 对接。
   *
   * 顺序很讲究：上游先 pause，等数据连接握手写完再 pipe + resume——
   * 否则上游在这几十毫秒里吐出的响应头会被写进数据连接的**握手行之前**，
   * relay 那边就会把它当成握手 JSON 解析然后断链。
   */
  function openStream(id) {
    if (active.has(id)) return;
    const targetPort = Number(getTargetPort?.() ?? 0);
    if (!Number.isInteger(targetPort) || targetPort <= 0) {
      logWarn('relay-agent: no local proxy port, refusing stream | 本机代理端口未知，拒绝开流');
      if (control && !control.destroyed) {
        try { control.write(encodeControl({ t: T.close, id, reason: 'no-target' })); } catch { /* 忽略 */ }
      }
      return;
    }

    const upstream = netConnect({ host: targetHost, port: targetPort });
    const entry = { id, upstream, data: null };
    active.set(id, entry);
    status = { ...status, streams: active.size };

    upstream.on('error', () => closeStream(id, { notify: true }));
    upstream.once('connect', () => {
      upstream.pause();
      const data = dialRelay();
      entry.data = data;
      data.on('error', () => closeStream(id, { notify: false }));

      const onReady = () => {
        try {
          data.write(encodeControl({ t: T.data, id, agent: agentId, token }));
        } catch {
          closeStream(id, { notify: true });
          return;
        }
        upstream.pipe(data);
        data.pipe(upstream);
        upstream.resume();
      };
      if (tls) data.once('secureConnect', onReady);
      else data.once('connect', onReady);
    });
  }

  // ---------- 控制连接 ----------
  function handleControlData(chunk) {
    lastRxAt = Date.now();
    let lines;
    try {
      lines = splitter.push(chunk);
    } catch (err) {
      fatal = `relay 控制帧异常：${err?.message ?? err} | protocol error`;
      try { control?.destroy(); } catch { /* 忽略 */ }
      return;
    }
    for (const line of lines) {
      const msg = parseControl(line);
      if (!msg) continue;
      if (msg.t === T.welcome) {
        if (msg.v !== PROTOCOL_VERSION) {
          // 版本不一致是**致命**的：重连一万次也不会好，直接停并说清原因
          fatal = `relay 协议版本不匹配（服务器 ${msg.v}，本机 ${PROTOCOL_VERSION}）— 请把 relay/ 与插件一起升级 | protocol version mismatch`;
          try { control?.destroy(); } catch { /* 忽略 */ }
          return;
        }
        attempt = 0;
        setStatus('online', `已连接 ${host}:${port}`);
        logInfo(`dsh-pocket-relay: relay connected to ${host}:${port} | 中继已连接`);
        continue;
      }
      if (msg.t === T.open) { openStream(String(msg.id ?? '')); continue; }
      if (msg.t === T.close) { closeStream(String(msg.id ?? ''), { notify: false }); continue; }
      if (msg.t === T.pong) continue;
      if (msg.t === T.error) {
        fatal = `relay 拒绝：${msg.error ?? 'unknown'} | relay rejected`;
        try { control?.destroy(); } catch { /* 忽略 */ }
        return;
      }
    }
  }

  function scheduleReconnect() {
    if (!running || reconnectTimer !== null) return;
    const base = Math.min(bo.maxMs, bo.minMs * bo.factor ** attempt);
    const jitter = base * bo.jitter * (Math.random() * 2 - 1);
    const delay = Math.max(bo.minMs, Math.round(base + jitter));
    attempt += 1;
    setStatus('connecting', `${Math.round(delay / 1000)} 秒后重连…`);
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
    reconnectTimer.unref?.();
  }

  function stopHeartbeat() {
    if (pingTimer !== null) { clearInterval(pingTimer); pingTimer = null; }
  }

  function startHeartbeat() {
    stopHeartbeat();
    pingTimer = setInterval(() => {
      if (!control || control.destroyed) return;
      if (Date.now() - lastRxAt > hb.timeoutMs) {
        // 静默断链（NAT 超时 / 链路被丢）：没有 FIN，只能靠心跳发现，主动断开重连
        logWarn('dsh-pocket-relay: relay link silent, reconnecting | 中继链路静默，主动重连');
        try { control.destroy(); } catch { /* 忽略 */ }
        return;
      }
      try { control.write(encodeControl({ t: T.ping, at: Date.now() })); } catch { /* 忽略 */ }
    }, hb.intervalMs);
    pingTimer.unref?.();
  }

  function connect() {
    if (!running) return;
    if (!host || !Number(port) || !token) {
      setStatus('error', '中继未配置完整（地址 / 端口 / Token） | relay is not configured');
      return;
    }
    setStatus('connecting', `正在连接 ${host}:${port}…`);
    fatal = null;
    splitter = makeLineSplitter();
    lastRxAt = Date.now();

    const socket = dialRelay();
    control = socket;
    let welcomed = false;

    socket.on('error', (err) => {
      if (!welcomed && running) {
        status = { ...status, error: err?.message ?? String(err) };
      }
    });
    socket.on('data', (chunk) => {
      // welcome 到达即视为「连接可用」，重连计数归零由 handleControlData 处理
      if (!welcomed) {
        welcomed = true;
        startHeartbeat();
      }
      handleControlData(chunk);
    });
    const onUp = () => {
      try {
        socket.write(encodeControl({ t: T.hello, role: 'agent', agent: agentId, token, v: PROTOCOL_VERSION }));
      } catch {
        try { socket.destroy(); } catch { /* 忽略 */ }
      }
    };
    if (tls) socket.once('secureConnect', onUp);
    else socket.once('connect', onUp);

    const onGone = () => {
      stopHeartbeat();
      if (control === socket) control = null;
      closeAllStreams();
      if (!running) return;
      if (fatal) {
        // 致命错误（协议不匹配 / token 被拒）：不再重连，把原因摆到界面上
        setStatus('error', fatal);
        running = false;
        return;
      }
      status = { ...status, reconnects: status.reconnects + 1 };
      scheduleReconnect();
    };
    socket.on('close', onGone);
    socket.on('error', () => { /* 收尾统一走 close */ });
  }

  return {
    /** 开始连接（幂等）。 */
    start() {
      if (running) return;
      running = true;
      attempt = 0;
      status = { ...status, reconnects: 0 };
      connect();
    },
    /** 停止并断开一切；再次 start() 可恢复。 */
    stop() {
      running = false;
      fatal = null;
      if (reconnectTimer !== null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      stopHeartbeat();
      closeAllStreams();
      const c = control;
      control = null;
      if (c && !c.destroyed) {
        try { c.destroy(); } catch { /* 忽略 */ }
      }
      setStatus('stopped', '已停止 | stopped');
    },
    /** 状态快照（设置页展示 / RPC 返回）。 */
    status() {
      return { ...status, streams: active.size, host, port, tls, agentId, running };
    },
  };
}
