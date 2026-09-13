// 设备管理 RPC（device.*）
//
// 这条通道是**本机专属**的：代理层已经保证非 loopback 来源调不到 /dsh-pocket
// （白名单端点除外，见 test/device-auth-http.test.js）。这里在 RPC 层再守两件事：
//   1. 响应体里永远不出现凭据哈希；
//   2. 状态机正确——批准只对「待批准」生效，撤销只对真实存在的设备生效。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDeviceAuth } from '../lib/device-auth.mjs';
import { installPocketRpc } from '../lib/web-rpc.js';
import { POCKET_ENDPOINTS, POCKET_RPC_CHANNEL } from '../client/api.js';

const PASSWORD = 'device-password-1';
const FAST = { N: 1 << 12, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };
const PUBLIC_URL = 'https://pocket.example.com:8443';

function silent() {
  return { info() {}, warn() {}, error() {}, log() {} };
}

/** 起一套 RPC：真实设备存储 + 最小 webServer 假体。 */
function makeRpc({ publicUrl = PUBLIC_URL } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dshp-dadmin-'));
  const store = createDeviceAuth({ path: join(dir, 'devices.json'), scryptParams: FAST });
  const webServer = {
    routes: new Map(),
    register(route) {
      this.routes.set(route.path, route);
      return () => this.routes.delete(route.path);
    },
  };
  const service = {
    dshPort: 3080,
    deviceAuth: store,
    status: async () => ({ dshPort: 3080 }),
    stopTunnel() {},
    stopRelay() {},
    startRelay: async () => {},
  };
  installPocketRpc({ webServer, connection: null }, {
    service,
    getRelayConfig: () => ({
      enabled: true, consent: true, host: 'pocket.example.com', port: 8444,
      token: 'x'.repeat(24), publicUrl,
    }),
    log: silent(),
  });
  return {
    store,
    route: webServer.routes.get(POCKET_RPC_CHANNEL),
    close: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** 直接调挂上去的 route handler，返回假 Response。 */
async function rpc(route, endpoint, payload = {}) {
  const body = Buffer.from(JSON.stringify({ rpcId: 'r1', method: endpoint, payload }));
  const res = fakeResponse();
  await route.handler({
    method: 'POST',
    url: `${POCKET_RPC_CHANNEL}/${endpoint}`,
    headers: { host: '127.0.0.1:3080', 'content-type': 'application/json', 'content-length': String(body.length) },
    [Symbol.asyncIterator]: async function* () { yield body; },
    on() {}, destroy() {},
  }, res);
  return res;
}

async function call(route, endpoint, payload) {
  const res = await rpc(route, endpoint, payload);
  const body = await res.json();
  return body.result;
}

function fakeResponse() {
  const chunks = [];
  let status = 0;
  return {
    headersSent: false,
    writableEnded: false,
    statusCode: 0,
    writeHead(code) { status = code; this.statusCode = code; this.headersSent = true; },
    write(c) { chunks.push(Buffer.from(c)); return true; },
    end(c) { if (c) chunks.push(Buffer.from(c)); this.writableEnded = true; },
    on() {}, once() {}, off() {},
    json() { return Promise.resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); },
    text() { return Buffer.concat(chunks).toString('utf8'); },
    get _status() { return status; },
  };
}

// ---------- 列表 ----------

test('device.list：已批准与待批准分开返回，且不含任何哈希', async () => {
  const h = makeRpc();
  try {
    const pairing = h.store.createPairing({ name: '手机 A' });
    const claimed = await h.store.claimPairing(pairing.code, { name: '手机 A', password: PASSWORD });

    const pendingView = await call(h.route, POCKET_ENDPOINTS.deviceList);
    assert.equal(pendingView.ok, true);
    assert.equal(pendingView.value.pending.length, 1);
    assert.equal(pendingView.value.devices.length, 0, '未批准的不该出现在已批准列表里');

    h.store.approve(claimed.device.id);
    const approvedView = await call(h.route, POCKET_ENDPOINTS.deviceList);
    assert.equal(approvedView.value.devices.length, 1);
    assert.equal(approvedView.value.pending.length, 0);

    const raw = JSON.stringify(approvedView);
    assert.equal(/[a-f0-9]{64}/.test(raw), false, '响应里出现了疑似哈希');
    assert.equal(raw.includes(claimed.token), false, '响应泄露了设备凭据');
    assert.equal(raw.includes(PASSWORD), false, '响应泄露了设备密码');
  } finally {
    h.close();
  }
});

// ---------- 生成配对码 ----------

test('device.pairing.create：返回配对码与可扫的完整地址', async () => {
  const h = makeRpc();
  try {
    const out = await call(h.route, POCKET_ENDPOINTS.devicePairingCreate, { name: '我的 iPhone' });
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.ok(out.value.code);
    assert.equal(out.value.name, '我的 iPhone');
    assert.equal(out.value.pairUrl, `${PUBLIC_URL}/pocket-pair?code=${encodeURIComponent(out.value.code)}`);
    assert.ok(out.value.expiresAt > Date.now());
  } finally {
    h.close();
  }
});

test('device.pairing.create：未填对外访问地址时明确报错（生成的码会打不开）', async () => {
  const h = makeRpc({ publicUrl: '' });
  try {
    const out = await call(h.route, POCKET_ENDPOINTS.devicePairingCreate, {});
    assert.equal(out.ok, false);
    assert.match(out.error.message, /对外访问地址/);
  } finally {
    h.close();
  }
});

test('device.pairing.create：已有待批准申请时拒绝（决策 #12）', async () => {
  const h = makeRpc();
  try {
    assert.equal((await call(h.route, POCKET_ENDPOINTS.devicePairingCreate, {})).ok, true);
    const second = await call(h.route, POCKET_ENDPOINTS.devicePairingCreate, {});
    assert.equal(second.ok, false);
    assert.match(second.error.message, /已有待批准的配对申请/);
  } finally {
    h.close();
  }
});

test('device.pairing.cancel：取消后可以重新生成', async () => {
  const h = makeRpc();
  try {
    assert.equal((await call(h.route, POCKET_ENDPOINTS.devicePairingCreate, {})).ok, true);
    const cancel = await call(h.route, POCKET_ENDPOINTS.devicePairingCancel);
    assert.equal(cancel.ok, true);
    const again = await call(h.route, POCKET_ENDPOINTS.devicePairingCreate, {});
    assert.equal(again.ok, true, '取消后应当能重新生成配对码');
  } finally {
    h.close();
  }
});

// ---------- 批准 / 拒绝 / 撤销 ----------

test('device.approve：把待批准变成已批准，之后该设备才能登录', async () => {
  const h = makeRpc();
  try {
    const created = await call(h.route, POCKET_ENDPOINTS.devicePairingCreate, { name: 'A' });
    const claimed = await h.store.claimPairing(created.value.code, { name: 'A', password: PASSWORD });

    const before = await h.store.authenticate({ token: claimed.token, password: PASSWORD });
    assert.equal(before.ok, false);
    assert.equal(before.reason, 'not-approved');

    const approved = await call(h.route, POCKET_ENDPOINTS.deviceApprove, { id: claimed.device.id });
    assert.equal(approved.ok, true, JSON.stringify(approved));
    assert.equal(approved.value.devices.length, 1);

    const after = await h.store.authenticate({ token: claimed.token, password: PASSWORD });
    assert.equal(after.ok, true, '批准后应当可以登录');
  } finally {
    h.close();
  }
});

test('device.reject：拒绝待批准设备后记录消失', async () => {
  const h = makeRpc();
  try {
    const created = await call(h.route, POCKET_ENDPOINTS.devicePairingCreate, { name: 'A' });
    const claimed = await h.store.claimPairing(created.value.code, { name: 'A', password: PASSWORD });
    const rejected = await call(h.route, POCKET_ENDPOINTS.deviceReject, { id: claimed.device.id });
    assert.equal(rejected.ok, true);
    assert.equal(rejected.value.pending.length, 0);
    assert.equal(rejected.value.devices.length, 0);
  } finally {
    h.close();
  }
});

test('device.revoke：撤销已批准设备后凭据立即作废', async () => {
  const h = makeRpc();
  try {
    const created = await call(h.route, POCKET_ENDPOINTS.devicePairingCreate, { name: 'A' });
    const claimed = await h.store.claimPairing(created.value.code, { name: 'A', password: PASSWORD });
    await call(h.route, POCKET_ENDPOINTS.deviceApprove, { id: claimed.device.id });

    const revoked = await call(h.route, POCKET_ENDPOINTS.deviceRevoke, { id: claimed.device.id });
    assert.equal(revoked.ok, true);
    assert.equal(revoked.value.devices.length, 0);

    const out = await h.store.authenticate({ token: claimed.token, password: PASSWORD });
    assert.equal(out.ok, false, '撤销后旧凭据必须作废');
  } finally {
    h.close();
  }
});

test('device.*：状态机不匹配时如实报错（批准一个不存在的 id / 批准已批准的）', async () => {
  const h = makeRpc();
  try {
    const missing = await call(h.route, POCKET_ENDPOINTS.deviceApprove, { id: 'nope' });
    assert.equal(missing.ok, false);
    assert.match(missing.error.message, /不存在或状态不匹配/);

    const created = await call(h.route, POCKET_ENDPOINTS.devicePairingCreate, { name: 'A' });
    const claimed = await h.store.claimPairing(created.value.code, { name: 'A', password: PASSWORD });
    assert.equal((await call(h.route, POCKET_ENDPOINTS.deviceApprove, { id: claimed.device.id })).ok, true);
    const twice = await call(h.route, POCKET_ENDPOINTS.deviceApprove, { id: claimed.device.id });
    assert.equal(twice.ok, false, '重复批准应当报错而不是静默成功');

    const noId = await call(h.route, POCKET_ENDPOINTS.deviceRevoke, {});
    assert.equal(noId.ok, false);
    assert.match(noId.error.message, /缺少设备 id/);
  } finally {
    h.close();
  }
});

// ---------- status 集成 ----------

test('pocket.status：带上设备计数，且不含 token 原文', async () => {
  const h = makeRpc();
  try {
    const created = await call(h.route, POCKET_ENDPOINTS.devicePairingCreate, { name: 'A' });
    await h.store.claimPairing(created.value.code, { name: 'A', password: PASSWORD });

    const status = await call(h.route, POCKET_ENDPOINTS.status);
    assert.equal(status.ok, true);
    assert.equal(status.value.deviceStatus.pending, 1);
    assert.equal(status.value.deviceStatus.devices, 0);
    assert.equal(status.value.relay.tokenSet, true);
    assert.equal(JSON.stringify(status).includes('x'.repeat(24)), false, 'status 泄露了 relay token');
  } finally {
    h.close();
  }
});

// ---------- 端到端：RPC 生成码 → 手机提交 → RPC 批准 → 登录 ----------

test('端到端：生成配对码 → 提交 → 批准 → 设备登录成功', async () => {
  const h = makeRpc();
  try {
    const created = await call(h.route, POCKET_ENDPOINTS.devicePairingCreate, { name: '我的 iPhone' });
    assert.equal(created.ok, true, JSON.stringify(created));

    // 手机侧：扫 pairUrl 里的 code
    const code = new URL(created.value.pairUrl).searchParams.get('code');
    const claimed = await h.store.claimPairing(code, { name: '我的 iPhone', password: PASSWORD });
    assert.ok(claimed.token, `提交配对失败：${claimed.error}`);

    const approved = await call(h.route, POCKET_ENDPOINTS.deviceApprove, { id: claimed.device.id });
    assert.equal(approved.ok, true);

    const login = await h.store.authenticate({ token: claimed.token, password: PASSWORD });
    assert.equal(login.ok, true, JSON.stringify(login));
    assert.ok(login.sessionId);

    // 登录后凭据轮换，列表里 lastLoginAt 应当更新
    const list = await call(h.route, POCKET_ENDPOINTS.deviceList);
    assert.equal(list.value.devices.length, 1);
    assert.ok(list.value.devices[0].lastLoginAt > 0, '应当记录最后登录时间');
    assert.equal(list.value.devices[0].name, '我的 iPhone');
  } finally {
    h.close();
  }
});
