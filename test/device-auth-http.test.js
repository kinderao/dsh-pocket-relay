// 设备认证闸门的 HTTP 集成测试
//
// 核心要守住的是一条：**设备通道上未认证的请求绝对不出站**（不打到上游 dsh web）。
// 只拦首页是不够的——真实域名下的 /api/*、WebSocket、/dsh-pocket/* 都必须一起拦住，
// 否则设备认证就只是一块门帘。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDeviceAuth } from '../lib/device-auth.mjs';
import { createDeviceAuthGateway, DEVICE_COOKIE, SESSION_COOKIE } from '../lib/device-auth-http.mjs';
import { createPocketProxy } from '../lib/proxy.mjs';

const DEVICE_HOST = 'pocket.test';
const PASSWORD = 'device-password-1';
const FAST = { N: 1 << 12, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

/** 起一套：上游 + 代理（挂设备网关）。 */
async function startStack({ sessionIdleMs = 10 * 60 * 1000 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dshp-dah-'));
  const auth = createDeviceAuth({ path: join(dir, 'devices.json'), scryptParams: FAST, sessionIdleMs });

  const state = { upstreamHits: 0 };
  const upstream = http.createServer((req, res) => {
    state.upstreamHits += 1;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head></head><body>UPSTREAM_OK</body></html>');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');

  const gateway = createDeviceAuthGateway({
    auth,
    isDeviceHost: (h) => String(h).split(':')[0] === DEVICE_HOST,
    publicUrl: `https://${DEVICE_HOST}`,
  });

  const proxy = await createPocketProxy({
    port: 0,
    upstream: { host: '127.0.0.1', port: upstream.address().port },
    deviceAuth: gateway,
  });

  return {
    auth,
    gateway,
    proxy,
    state,
    async close() {
      await proxy.close();
      await new Promise((r) => upstream.close(r));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** 原始 HTTP 请求（自己管 cookie，方便断言 set-cookie）。 */
function call(port, { method = 'GET', path = '/', host = DEVICE_HOST, headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { host, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        setCookie: res.headers['set-cookie'] ?? [],
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

function cookieValue(setCookie, name) {
  for (const c of setCookie) {
    const m = new RegExp(`^${name}=([^;]*)`).exec(c);
    if (m) return m[1];
  }
  return null;
}

/** 配对 + 批准，返回可直接登录的凭据。 */
async function paired(stack, { name = '测试手机' } = {}) {
  const pairing = stack.auth.createPairing({ name });
  const claimed = await stack.auth.claimPairing(pairing.code, { name, password: PASSWORD });
  stack.auth.approve(claimed.device.id);
  return { token: claimed.token, deviceId: claimed.device.id };
}

// ---------- 未认证：一律不出站 ----------

test('设备通道：未认证的浏览器导航给登录页，且**不打到上游**', async () => {
  const stack = await startStack();
  try {
    const res = await call(stack.proxy.port, { path: '/', headers: { accept: 'text/html' } });
    assert.equal(res.status, 200);
    assert.match(res.body, /此设备尚未配对|设备/);
    assert.equal(stack.state.upstreamHits, 0, '未认证请求不该被转发到上游');
  } finally {
    await stack.close();
  }
});

test('设备通道：未认证的 API 请求给 401 JSON（不是登录页）', async () => {
  const stack = await startStack();
  try {
    const res = await call(stack.proxy.port, {
      path: '/api/sessions',
      headers: { accept: 'application/json' },
    });
    assert.equal(res.status, 401);
    assert.equal(JSON.parse(res.body).error, 'device-auth-required');
    assert.equal(stack.state.upstreamHits, 0);
  } finally {
    await stack.close();
  }
});

test('设备通道：未认证时 /dsh-pocket/* 也被拦住（不能靠改名绕开）', async () => {
  const stack = await startStack();
  try {
    const res = await call(stack.proxy.port, {
      method: 'POST',
      path: '/dsh-pocket/pocket.status',
      headers: { accept: 'application/json', 'content-type': 'application/json', host: DEVICE_HOST },
      body: '{"rpcId":"1","method":"pocket.status"}',
    });
    assert.equal(res.status, 401);
    assert.equal(stack.state.upstreamHits, 0);
  } finally {
    await stack.close();
  }
});

test('设备通道：未认证的 WebSocket 握手被 401 拒绝', async () => {
  const stack = await startStack();
  let socket;
  try {
    socket = net.connect({ host: '127.0.0.1', port: stack.proxy.port });
    await once(socket, 'connect');
    const chunks = [];
    socket.on('data', (c) => chunks.push(c));
    socket.write(
      `GET /api/events.mux HTTP/1.1\r\nHost: ${DEVICE_HOST}\r\nUpgrade: websocket\r\n`
      + 'Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
    );
    await new Promise((r) => setTimeout(r, 300));
    const out = Buffer.concat(chunks).toString('utf8');
    assert.match(out, /^HTTP\/1\.1 401/, `WS 握手应当被拒，实际：${out.slice(0, 60)}`);
  } finally {
    socket?.destroy();
    await stack.close();
  }
});

// ---------- 配对 ----------

test('配对：GET /pocket-pair?code=… 给出设密码的表单', async () => {
  const stack = await startStack();
  try {
    const pairing = stack.auth.createPairing({ name: '手机 A' });
    const res = await call(stack.proxy.port, { path: `/pocket-pair?code=${pairing.code}` });
    assert.equal(res.status, 200);
    assert.match(res.body, /配对这台设备/);
    assert.match(res.body, /设备密码/);
    assert.equal(stack.state.upstreamHits, 0);
  } finally {
    await stack.close();
  }
});

test('配对：提交后下发长期凭据 cookie，并显示「等待批准」', async () => {
  const stack = await startStack();
  try {
    const pairing = stack.auth.createPairing({ name: '手机 A' });
    const res = await call(stack.proxy.port, {
      method: 'POST',
      path: '/pocket-pair',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: pairing.code, name: '手机 A', password: PASSWORD, confirm: PASSWORD }).toString(),
    });
    assert.equal(res.status, 200);
    assert.match(res.body, /等待电脑批准/);
    const token = cookieValue(res.setCookie, DEVICE_COOKIE);
    assert.ok(token, '应当下发设备凭据 cookie');
    assert.match(res.setCookie.join(';'), /HttpOnly/);
    assert.match(res.setCookie.join(';'), /Secure/, 'HTTPS 通道的 cookie 应当带 Secure');
  } finally {
    await stack.close();
  }
});

test('配对：两次密码不一致会被拒，且不建记录', async () => {
  const stack = await startStack();
  try {
    const pairing = stack.auth.createPairing({ name: '手机 A' });
    const res = await call(stack.proxy.port, {
      method: 'POST',
      path: '/pocket-pair',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: pairing.code, password: PASSWORD, confirm: 'different-pw' }).toString(),
    });
    assert.equal(res.status, 400);
    assert.match(res.body, /不一致/);
    assert.equal(stack.auth.list().length, 0);
  } finally {
    await stack.close();
  }
});

// ---------- 登录 ----------

test('登录：凭据 + 密码正确 → 303 并同时下发轮换后的凭据与新会话', async () => {
  const stack = await startStack();
  try {
    const { token } = await paired(stack);

    const denied = await call(stack.proxy.port, {
      method: 'POST',
      path: '/pocket-auth/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `password=${encodeURIComponent(PASSWORD)}`,
    });
    // 没有凭据 cookie → 认不出是哪台设备 → 拒
    assert.equal(denied.status, 200);
    assert.match(denied.body, /尚未配对/);

    const res = await call(stack.proxy.port, {
      method: 'POST',
      path: '/pocket-auth/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `${DEVICE_COOKIE}=${token}` },
      body: `password=${encodeURIComponent(PASSWORD)}`,
    });
    assert.equal(res.status, 303);
    const newToken = cookieValue(res.setCookie, DEVICE_COOKIE);
    const sid = cookieValue(res.setCookie, SESSION_COOKIE);
    assert.ok(newToken && newToken !== token, '登录应当轮换设备凭据');
    assert.ok(sid, '应当下发会话 cookie');
  } finally {
    await stack.close();
  }
});

test('登录：密码错误 → 停在登录页，不下发会话', async () => {
  const stack = await startStack();
  try {
    const { token } = await paired(stack);
    const res = await call(stack.proxy.port, {
      method: 'POST',
      path: '/pocket-auth/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `${DEVICE_COOKIE}=${token}` },
      body: 'password=wrong-password',
    });
    assert.equal(res.status, 200);
    assert.match(res.body, /密码错误/);
    assert.equal(cookieValue(res.setCookie, SESSION_COOKIE), null, '失败不该下发会话');
    assert.equal(stack.state.upstreamHits, 0);
  } finally {
    await stack.close();
  }
});

// ---------- 已认证：放行 ----------

test('已认证：带会话 cookie 的请求被放行到上游', async () => {
  const stack = await startStack();
  try {
    const { token } = await paired(stack);
    const login = await call(stack.proxy.port, {
      method: 'POST',
      path: '/pocket-auth/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `${DEVICE_COOKIE}=${token}` },
      body: `password=${encodeURIComponent(PASSWORD)}`,
    });
    const sid = cookieValue(login.setCookie, SESSION_COOKIE);

    const res = await call(stack.proxy.port, {
      path: '/',
      headers: { accept: 'text/html', cookie: `${SESSION_COOKIE}=${sid}` },
    });
    assert.equal(res.status, 200);
    assert.match(res.body, /UPSTREAM_OK/, '已认证请求应当被转发到上游');
    assert.equal(stack.state.upstreamHits, 1);
  } finally {
    await stack.close();
  }
});

test('已认证：WebSocket 握手放行（不再是 401）', async () => {
  const stack = await startStack();
  let socket;
  try {
    const { token } = await paired(stack);
    const login = await call(stack.proxy.port, {
      method: 'POST',
      path: '/pocket-auth/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `${DEVICE_COOKIE}=${token}` },
      body: `password=${encodeURIComponent(PASSWORD)}`,
    });
    const sid = cookieValue(login.setCookie, SESSION_COOKIE);

    socket = net.connect({ host: '127.0.0.1', port: stack.proxy.port });
    await once(socket, 'connect');
    const chunks = [];
    socket.on('data', (c) => chunks.push(c));
    socket.write(
      `GET /api/events.mux HTTP/1.1\r\nHost: ${DEVICE_HOST}\r\nUpgrade: websocket\r\n`
      + `Connection: Upgrade\r\nCookie: ${SESSION_COOKIE}=${sid}\r\n`
      + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
    );
    await new Promise((r) => setTimeout(r, 300));
    const out = Buffer.concat(chunks).toString('utf8');
    // 上游不是 WS 服务，但**关键是没有被 401 挡在代理这一层**
    assert.doesNotMatch(out, /401 Unauthorized/, '已认证的 WS 不该被代理拒绝');
  } finally {
    socket?.destroy();
    await stack.close();
  }
});

// ---------- 会话续期 / 登出 ----------

test('活动上报：有效会话返回 204；无会话返回 401', async () => {
  const stack = await startStack();
  try {
    const { token } = await paired(stack);
    const login = await call(stack.proxy.port, {
      method: 'POST',
      path: '/pocket-auth/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `${DEVICE_COOKIE}=${token}` },
      body: `password=${encodeURIComponent(PASSWORD)}`,
    });
    const sid = cookieValue(login.setCookie, SESSION_COOKIE);

    const ok = await call(stack.proxy.port, {
      method: 'POST', path: '/pocket-auth/activity', headers: { cookie: `${SESSION_COOKIE}=${sid}` },
    });
    assert.equal(ok.status, 204);

    const noSession = await call(stack.proxy.port, { method: 'POST', path: '/pocket-auth/activity' });
    assert.equal(noSession.status, 401);
    assert.equal(stack.state.upstreamHits, 0, '/pocket-auth/* 不该透传到上游');
  } finally {
    await stack.close();
  }
});

test('会话：空闲超时后请求重新落到登录页（不再放行）', async () => {
  const stack = await startStack({ sessionIdleMs: 120 });
  try {
    const { token } = await paired(stack);
    const login = await call(stack.proxy.port, {
      method: 'POST',
      path: '/pocket-auth/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `${DEVICE_COOKIE}=${token}` },
      body: `password=${encodeURIComponent(PASSWORD)}`,
    });
    const sid = cookieValue(login.setCookie, SESSION_COOKIE);

    const before = await call(stack.proxy.port, { path: '/', headers: { accept: 'text/html', cookie: `${SESSION_COOKIE}=${sid}` } });
    assert.match(before.body, /UPSTREAM_OK/);

    await new Promise((r) => setTimeout(r, 200));

    const after = await call(stack.proxy.port, { path: '/', headers: { accept: 'text/html', cookie: `${SESSION_COOKIE}=${sid}` } });
    assert.doesNotMatch(after.body, /UPSTREAM_OK/, '空闲超时后不该再放行');
  } finally {
    await stack.close();
  }
});

test('登出：清空 cookie 并让会话立即失效', async () => {
  const stack = await startStack();
  try {
    const { token } = await paired(stack);
    const login = await call(stack.proxy.port, {
      method: 'POST',
      path: '/pocket-auth/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `${DEVICE_COOKIE}=${token}` },
      body: `password=${encodeURIComponent(PASSWORD)}`,
    });
    const sid = cookieValue(login.setCookie, SESSION_COOKIE);

    const out = await call(stack.proxy.port, {
      method: 'GET', path: '/pocket-auth/logout', headers: { cookie: `${SESSION_COOKIE}=${sid}` },
    });
    assert.equal(out.status, 303);
    assert.match(out.setCookie.join(';'), /dshp_device=;/);
    assert.match(out.setCookie.join(';'), /dshp_session=;/);

    const after = await call(stack.proxy.port, { path: '/', headers: { accept: 'text/html', cookie: `${SESSION_COOKIE}=${sid}` } });
    assert.doesNotMatch(after.body, /UPSTREAM_OK/);
  } finally {
    await stack.close();
  }
});

test('撤销：设备被撤销后，原会话立刻不再放行', async () => {
  const stack = await startStack();
  try {
    const { token, deviceId } = await paired(stack);
    const login = await call(stack.proxy.port, {
      method: 'POST',
      path: '/pocket-auth/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `${DEVICE_COOKIE}=${token}` },
      body: `password=${encodeURIComponent(PASSWORD)}`,
    });
    const sid = cookieValue(login.setCookie, SESSION_COOKIE);
    assert.equal(stack.state.upstreamHits, 0);

    stack.auth.revoke(deviceId);

    const after = await call(stack.proxy.port, { path: '/', headers: { accept: 'text/html', cookie: `${SESSION_COOKIE}=${sid}` } });
    assert.doesNotMatch(after.body, /UPSTREAM_OK/);
    assert.equal(stack.state.upstreamHits, 0, '撤销后不该再有请求出站');
  } finally {
    await stack.close();
  }
});

// ---------- 设置页通道只对本机开放 ----------

test('/dsh-pocket：局域网来源被 403 拒（pocket.status 会泄露公网 PIN）', async () => {
  const stack = await startStack();
  try {
    const res = await call(stack.proxy.port, {
      method: 'POST',
      path: '/dsh-pocket/pocket.status',
      host: '192.168.1.50:3081',
      headers: { 'content-type': 'application/json' },
      body: '{"rpcId":"1","method":"pocket.status"}',
    });
    assert.equal(res.status, 403);
    assert.match(res.body, /pocket-rpc-local-only/);
    assert.equal(stack.state.upstreamHits, 0, '不该把设置页通道转发给上游');
  } finally {
    await stack.close();
  }
});

test('/dsh-pocket：公网来源被 403 拒', async () => {
  const stack = await startStack();
  try {
    const res = await call(stack.proxy.port, {
      method: 'POST',
      path: '/dsh-pocket/pocket.status',
      host: 'someone.trycloudflare.com',
      headers: { 'content-type': 'application/json' },
      body: '{"rpcId":"1","method":"pocket.status"}',
    });
    assert.equal(res.status, 403);
    assert.equal(stack.state.upstreamHits, 0);
  } finally {
    await stack.close();
  }
});

test('/dsh-pocket：白名单端点（pocket.fileRead）对远程仍然可用', async () => {
  const stack = await startStack();
  try {
    const res = await call(stack.proxy.port, {
      method: 'POST',
      path: '/dsh-pocket/pocket.fileRead',
      host: '192.168.1.50:3081',
      headers: { 'content-type': 'application/json' },
      body: '{"rpcId":"1","method":"pocket.fileRead","payload":{"path":"a.txt"}}',
    });
    assert.equal(res.status, 200);
    assert.match(res.body, /UPSTREAM_OK/, '移动端复制文件必须还能用');
    assert.equal(stack.state.upstreamHits, 1);
  } finally {
    await stack.close();
  }
});

test('/dsh-pocket：本机（loopback）来源照常放行', async () => {
  const stack = await startStack();
  try {
    const res = await call(stack.proxy.port, {
      method: 'POST',
      path: '/dsh-pocket/pocket.status',
      host: '127.0.0.1:3081',
      headers: { 'content-type': 'application/json' },
      body: '{"rpcId":"1","method":"pocket.status"}',
    });
    assert.equal(res.status, 200);
    assert.match(res.body, /UPSTREAM_OK/);
  } finally {
    await stack.close();
  }
});

test('/dsh-pocket：设备通道**已认证**的手机也拿不到设置页通道', async () => {
  const stack = await startStack();
  try {
    const { token } = await paired(stack);
    const login = await call(stack.proxy.port, {
      method: 'POST',
      path: '/pocket-auth/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `${DEVICE_COOKIE}=${token}` },
      body: `password=${encodeURIComponent(PASSWORD)}`,
    });
    const sid = cookieValue(login.setCookie, SESSION_COOKIE);

    const res = await call(stack.proxy.port, {
      method: 'POST',
      path: '/dsh-pocket/pocket.status',
      headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${sid}` },
      body: '{"rpcId":"1","method":"pocket.status"}',
    });
    assert.equal(res.status, 403, '设备认证不等于可以改设置/管设备');
    assert.equal(stack.state.upstreamHits, 0);
  } finally {
    await stack.close();
  }
});

// ---------- 非设备通道不受影响 ----------

test('其它 Host 不走设备闸门（局域网/Quick 的共享 PIN 语义保持原样）', async () => {
  const stack = await startStack();
  try {
    const res = await call(stack.proxy.port, {
      path: '/',
      host: '192.168.1.50:3081',
      headers: { accept: 'text/html' },
    });
    assert.equal(res.status, 200);
    assert.match(res.body, /UPSTREAM_OK/, '非设备通道应当照常转发');
    assert.equal(stack.state.upstreamHits, 1);
  } finally {
    await stack.close();
  }
});
