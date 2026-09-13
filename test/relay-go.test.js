// 跨语言端到端：**Go 版 relay 服务端** ⇄ **Node 版 PC agent**
//
// 这是整次 Go 重写的验收测试。任何单侧单测都只能证明自己那一半；协议一旦漂移
// （最典型的是「握手行之后的同分片字节被丢掉」），只有这里会红。
//
// 二进制不在测试里构建（go build 首次几十秒，会被 --test-timeout 掐掉）。
// 先跑 `npm run build:relay`，没有二进制时本文件整体跳过并给出提示。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { relayBinary, startGoRelay, SKIP_HINT } from './helpers/go-relay.mjs';
import { createRelayAgent } from '../lib/relay.mjs';

const TOKEN = 'go-relay-test-token-0123456789abc';
const HAS_BINARY = relayBinary() !== null;

const TLS_FIXTURE = {
  cert: fileURLToPath(new URL('./fixtures/tls/localhost-cert.pem', import.meta.url)),
  key: fileURLToPath(new URL('./fixtures/tls/localhost-key.pem', import.meta.url)),
};

async function startUpstream() {
  const server = http.createServer((req, res) => {
    if (req.url === '/big') {
      const body = Buffer.alloc(512 * 1024, 0x62);
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(body.length) });
      res.end(body);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ url: req.url, host: req.headers.host ?? null }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

async function startEcho() {
  const server = net.createServer((s) => { s.pipe(s); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

function silentLog() {
  return { info() {}, warn() {}, error() {}, log() {} };
}

async function waitFor(pred, timeoutMs, msg) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitFor 超时：${msg}`);
}

function httpGet(port, path = '/', { tls = false } = {}) {
  const mod = tls ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      { host: '127.0.0.1', port, path, method: 'GET', ...(tls ? { rejectUnauthorized: false } : {}) },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** 起一整套：Go relay + Node agent（+ 可选上游）。 */
async function startStack({ upstreamPort, relayOpts = {}, agentOpts = {} } = {}) {
  const relay = await startGoRelay({ token: TOKEN, ...relayOpts });
  const agent = createRelayAgent({
    host: '127.0.0.1',
    port: relay.agentPort,
    tls: relayOpts.certFile ? true : false,
    rejectUnauthorized: false,
    token: TOKEN,
    getTargetPort: () => upstreamPort,
    backoff: { minMs: 50, maxMs: 300 },
    heartbeat: { intervalMs: 300, timeoutMs: 5000 },
    log: silentLog(),
    ...agentOpts,
  });
  agent.start();
  await waitFor(() => agent.status().phase === 'online', 8000, 'Node agent 未能连上 Go relay');
  return { relay, agent, async close() { agent.stop(); await relay.close(); } };
}

test('Go relay ⇄ Node agent：HTTP 请求端到端可达', { skip: HAS_BINARY ? false : SKIP_HINT }, async () => {
  const upstream = await startUpstream();
  const stack = await startStack({ upstreamPort: upstream.port });
  try {
    const res = await httpGet(stack.relay.visitorPort, '/api/hello');
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body.toString('utf8'));
    assert.equal(body.url, '/api/hello');
    // relay 不改 Host（改头是 PC 上 3081 代理的活），所以上游看到的就是访客写的那个
    assert.equal(body.host, `127.0.0.1:${stack.relay.visitorPort}`);
  } finally {
    await stack.close();
    await upstream.close();
  }
});

test('Go relay ⇄ Node agent：512KB 大响应不分片丢字节', { skip: HAS_BINARY ? false : SKIP_HINT }, async () => {
  const upstream = await startUpstream();
  const stack = await startStack({ upstreamPort: upstream.port });
  try {
    const res = await httpGet(stack.relay.visitorPort, '/big');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 512 * 1024);
    assert.ok(res.body.every((b) => b === 0x62), '响应内容被破坏');
  } finally {
    await stack.close();
    await upstream.close();
  }
});

test('Go relay ⇄ Node agent：裸字节双向透传（握手窗口内的字节一条不丢）', { skip: HAS_BINARY ? false : SKIP_HINT }, async () => {
  const echo = await startEcho();
  const stack = await startStack({ upstreamPort: echo.port });
  let client;
  try {
    client = net.connect({ host: '127.0.0.1', port: stack.relay.visitorPort });
    await once(client, 'connect');
    // 连上就猛写：这些字节会在 relay「等 agent 数据连接」的窗口里到达，
    // 正是最容易丢数据的时机 —— Go 版靠「配对前不 Read」保住它们。
    const payload = randomBytes(256 * 1024);
    client.write(payload);

    const got = [];
    client.on('data', (c) => {
      got.push(c);
      if (got.reduce((n, b) => n + b.length, 0) >= payload.length) client.end();
    });
    await once(client, 'close');
    const back = Buffer.concat(got);
    assert.equal(back.length, payload.length, '回声长度不符');
    assert.ok(back.equals(payload), '回声内容与发送不一致');
  } finally {
    client?.destroy();
    await stack.close();
    await echo.close();
  }
});

test('Go relay：没有 agent 在线时给访客明确的 503', { skip: HAS_BINARY ? false : SKIP_HINT }, async () => {
  const relay = await startGoRelay({ token: TOKEN });
  try {
    const res = await httpGet(relay.visitorPort, '/');
    assert.equal(res.status, 503);
    assert.match(res.body.toString('utf8'), /not connected/i);
  } finally {
    await relay.close();
  }
});

test('Go relay：agent 用错 token 会被拒绝，不会注册成功', { skip: HAS_BINARY ? false : SKIP_HINT }, async () => {
  const relay = await startGoRelay({ token: TOKEN });
  let socket;
  try {
    socket = net.connect({ host: '127.0.0.1', port: relay.agentPort });
    await once(socket, 'connect');
    const chunks = [];
    socket.on('data', (c) => chunks.push(c));
    socket.write(`${JSON.stringify({ t: 'hello', role: 'agent', agent: 'evil', token: 'wrong-token-but-long-enough' })}\n`);
    await once(socket, 'close');
    assert.match(Buffer.concat(chunks).toString('utf8'), /bad-token/);
    // 错误 token 之后，访客仍然拿不到 agent
    const res = await httpGet(relay.visitorPort, '/');
    assert.equal(res.status, 503);
  } finally {
    socket?.destroy();
    await relay.close();
  }
});

test('Go relay：Node agent 断线后自动重连并恢复服务', { skip: HAS_BINARY ? false : SKIP_HINT }, async () => {
  const upstream = await startUpstream();
  const first = await startGoRelay({ token: TOKEN });
  const agent = createRelayAgent({
    host: '127.0.0.1',
    port: first.agentPort,
    token: TOKEN,
    getTargetPort: () => upstream.port,
    backoff: { minMs: 50, maxMs: 400 },
    heartbeat: { intervalMs: 300, timeoutMs: 5000 },
    log: silentLog(),
  });
  agent.start();
  try {
    await waitFor(() => agent.status().phase === 'online', 8000, '首次未连上');
    assert.equal((await httpGet(first.visitorPort, '/')).status, 200);

    await first.close();
    await waitFor(() => agent.status().phase !== 'online', 5000, 'agent 未察觉断开');

    // 服务器换端口重启（Go 版用 0 端口，重启后端口会变，所以直接重建 agent 目标）
    const second = await startGoRelay({ token: TOKEN });
    try {
      const agent2 = createRelayAgent({
        host: '127.0.0.1', port: second.agentPort, token: TOKEN,
        getTargetPort: () => upstream.port,
        backoff: { minMs: 50, maxMs: 400 }, log: silentLog(),
      });
      agent2.start();
      await waitFor(() => agent2.status().phase === 'online', 8000, '重连未成功');
      assert.equal((await httpGet(second.visitorPort, '/')).status, 200, '重连后应恢复服务');
      agent2.stop();
    } finally {
      await second.close();
    }
  } finally {
    agent.stop();
    await upstream.close();
  }
});

test('Go relay：Web 管理端起得来，且未认证时被拦住', { skip: HAS_BINARY ? false : SKIP_HINT }, async () => {
  const relay = await startGoRelay({ token: TOKEN, admin: true, adminPassword: 'admin-pw-for-test' });
  try {
    assert.ok(relay.adminPort, '配置开了管理端，就应当有 admin 监听');

    const base = `http://127.0.0.1:${relay.adminPort}`;
    // 未认证：API 401、页面跳登录
    const api = await fetch(`${base}/api/status`);
    assert.equal(api.status, 401, '未认证访问管理 API 应当 401');

    const page = await fetch(`${base}/`, { redirect: 'manual' });
    assert.equal(page.status, 303);
    assert.equal(page.headers.get('location'), '/login');

    // 登录页可访问
    const login = await fetch(`${base}/login`);
    assert.equal(login.status, 200);
    assert.match(await login.text(), /DSH Pocket Relay/);

    // 登录成功后能拿到状态
    const form = new URLSearchParams({ password: 'admin-pw-for-test' });
    const authed = await fetch(`${base}/login`, { method: 'POST', body: form, redirect: 'manual' });
    assert.equal(authed.status, 303);
    const cookie = String(authed.headers.get('set-cookie') ?? '').split(';')[0];
    assert.ok(cookie.includes('dshp_admin='), `应当下发会话 cookie，实际：${cookie}`);

    const st = await fetch(`${base}/api/status`, { headers: { cookie } });
    assert.equal(st.status, 200);
    const body = await st.json();
    // 只断言「版本号被注入进来了」，不写死具体值：写死的话每次改 build.mjs 的
    // 默认版本（或 CI 传 DSHP_RELAY_VERSION）都会红，而这条测试关心的是
    // 管理端能不能起来 + version 字段有没有漏——不是版本号本身的数值。
    assert.match(body.version, /^\d+\.\d+\.\d+$/, `version 应当是语义化版本号，实际：${body.version}`);
    assert.equal(body.hub.streams, 0);
  } finally {
    await relay.close();
  }
});

test('Go relay：TLS 双形态（服务器自己终结 TLS）与 Node agent 互通', { skip: HAS_BINARY ? false : SKIP_HINT }, async () => {
  const upstream = await startUpstream();
  const stack = await startStack({
    upstreamPort: upstream.port,
    relayOpts: { certFile: TLS_FIXTURE.cert, keyFile: TLS_FIXTURE.key },
  });
  try {
    const res = await httpGet(stack.relay.visitorPort, '/over-tls', { tls: true });
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body.toString('utf8')).url, '/over-tls');
  } finally {
    await stack.close();
    await upstream.close();
  }
});
