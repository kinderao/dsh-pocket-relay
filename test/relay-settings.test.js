// 中继通道的配置持久化 + 常开自动启动 + RPC 脱敏
//
// 这一组测的是「无人监听」这条诉求的骨架：配置好了就该自己连上，
// 不需要用户点任何按钮；而 token 这类凭据永远不能出现在 RPC 响应里。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { relayConfig, setRelayConfig, clearRelayConfig, relayConfigured } from '../lib/settings.mjs';
import { createPocketService } from '../lib/service.mjs';
import { installPocketRpc } from '../lib/web-rpc.js';
import { POCKET_ENDPOINTS, POCKET_RPC_CHANNEL } from '../client/api.js';
import { createRelayAgent, localAgentId } from '../lib/relay.mjs';
import { relayBinary, startGoRelay, SKIP_HINT } from './helpers/go-relay.mjs';

const TOKEN = 'relay-token-for-tests-0123456789';
const HAS_RELAY_BINARY = relayBinary() !== null;

/** settings.mjs 读的是 $DSH_HOME，指向临时目录，别碰用户真实配置。 */
function withTempHome(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dshp-relay-'));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = dir;
  try {
    return fn(dir);
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 最小 webServer 假体：只为让 installPocketRpc 走「直挂路由」分支。 */
function fakeWebServer() {
  const routes = new Map();
  return {
    routes,
    register(route) {
      routes.set(route.path, route);
      return () => routes.delete(route.path);
    },
  };
}

// ---------- 配置持久化 ----------

test('relay 配置：默认关闭且未配置', () => {
  withTempHome(() => {
    const cfg = relayConfig();
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.consent, false);
    assert.equal(cfg.host, '');
    assert.equal(cfg.port, 0);
    assert.equal(cfg.token, '');
    assert.equal(relayConfigured(cfg), false);
  });
});

test('relay 配置：主机名归一化（容忍粘贴带 scheme/端口/路径的地址）', () => {
  withTempHome(() => {
    setRelayConfig({ host: 'https://Pocket.Example.com:8443/some/path' });
    assert.equal(relayConfig().host, 'pocket.example.com');

    setRelayConfig({ host: 'relay.example.com.' });
    assert.equal(relayConfig().host, 'relay.example.com');
  });
});

test('relay 配置：token 留空表示保持原值（界面不回显 token，不能因此被抹掉）', () => {
  withTempHome(() => {
    setRelayConfig({ host: 'r.example.com', port: 8090, token: TOKEN });
    assert.equal(relayConfig().token, TOKEN);

    setRelayConfig({ host: 'r2.example.com' }); // 不带 token
    assert.equal(relayConfig().token, TOKEN, 'token 不该被清空');
    assert.equal(relayConfig().host, 'r2.example.com');
  });
});

test('relay 配置：边界校验（端口范围、token 长度、对外地址）', () => {
  withTempHome(() => {
    assert.throws(() => setRelayConfig({ port: 70000 }), /端口非法/);
    assert.throws(() => setRelayConfig({ port: 1.5 }), /端口非法/);
    assert.throws(() => setRelayConfig({ token: 'too-short' }), /至少 24 个字符/);
    assert.throws(() => setRelayConfig({ publicUrl: 'http://' }), /对外访问地址格式不对/);

    // 对外地址补全 scheme 并去掉路径（relay 不支持路径前缀）
    setRelayConfig({ publicUrl: 'pocket.example.com/some/path?x=1' });
    assert.equal(relayConfig().publicUrl, 'https://pocket.example.com');
  });
});

// 多机共存的关键配置：本机在 relay 上的名字。
//
// 语义与 token 不同：留空是**清除**（回到按主机名派生），不是「保持不变」——
// 名字不是凭据，是可读的标识，用户要有办法把它改回默认。
test('relay 配置：本机名称（agentId）的校验与清除', () => {
  withTempHome(() => {
    assert.equal(relayConfig().agentId, '', '未配置时应当为空（= 按主机名派生）');

    setRelayConfig({ agentId: 'pc-study' });
    assert.equal(relayConfig().agentId, 'pc-study');

    assert.throws(() => setRelayConfig({ agentId: 'bad name' }), /本机名称/);
    assert.throws(() => setRelayConfig({ agentId: 'x'.repeat(33) }), /本机名称/);
    assert.throws(() => setRelayConfig({ agentId: '有中文' }), /本机名称/);
    assert.equal(relayConfig().agentId, 'pc-study', '非法值不该覆盖已存的名字');

    setRelayConfig({ agentId: '  ' });   // 纯空白 = 清除
    assert.equal(relayConfig().agentId, '');
  });
});

test('relay 配置：开启前必须先配置完整且勾过知情同意（服务端强制，防绕过界面）', () => {
  withTempHome(() => {
    // 什么都没配就想开 → 拒
    assert.throws(() => setRelayConfig({ enabled: true }), /请先填写中继地址/);

    // 配齐了但没同意 → 拒
    setRelayConfig({ host: 'r.example.com', port: 8090, token: TOKEN });
    assert.throws(() => setRelayConfig({ enabled: true }), /安全声明/);

    // 同意了 → 放行
    setRelayConfig({ consent: true });
    setRelayConfig({ enabled: true });
    assert.equal(relayConfig().enabled, true);
  });
});

// ---------- 常开自动启动 ----------

test('service.startRelay：配置完整时启动 agent 并连上真实 relay', { skip: HAS_RELAY_BINARY ? false : SKIP_HINT }, async () => {
  const relay = await startGoRelay({ token: TOKEN });

  const service = createPocketService({
    dshPort: 1,                       // 不会被真正连上：测试只关心中继就连
    internals: {
      createProxy: async () => ({ port: 3081, close: async () => {} }),
      createRelayAgent,
    },
    getRelayConfig: () => ({ enabled: true, host: '127.0.0.1', port: relay.agentPort, token: TOKEN }),
    log: silent(),
  });

  try {
    await service.startRelay();
    // agent 是异步连上的，等它 online
    await waitFor(() => service.relayStatus().phase === 'online', 5000, '中继未连上');
    const st = await service.status();
    assert.equal(st.relayRunning, true);
    assert.equal(st.relayState.phase, 'online');
  } finally {
    await service.dispose();
    await relay.close();
  }
});

test('service.startRelay：配置不全时明确报错，而不是静默不连', async () => {
  const service = createPocketService({
    dshPort: 1,
    internals: { createProxy: async () => ({ port: 3081, close: async () => {} }) },
    getRelayConfig: () => ({ enabled: true, host: '', port: 0, token: '' }),
    log: silent(),
  });
  await assert.rejects(() => service.startRelay(), /未配置完整/);
});

// agent 名字真的传到了 agent 上（多机共存的最后一环：配置 → 线协议）。
// 留空时必须按主机名派生——固定成 'default' 会让两台电脑互相顶下线。
test('service.startRelay：把本机名称传给 agent；留空则按主机名派生', async () => {
  const seen = [];
  const stubAgent = (opts) => {
    seen.push(opts);
    return { start() {}, stop() {}, status: () => ({ phase: 'online', streams: 0, reconnects: 0 }) };
  };
  const makeService = (agentId) => createPocketService({
    dshPort: 1,
    internals: {
      createProxy: async () => ({ port: 3081, close: async () => {} }),
      createRelayAgent: stubAgent,
    },
    getRelayConfig: () => ({ enabled: true, host: '127.0.0.1', port: 8444, token: TOKEN, agentId }),
    log: silent(),
  });

  const explicit = makeService('pc-study');
  try {
    await explicit.startRelay();
  } finally {
    await explicit.dispose();
  }
  assert.equal(seen.length, 1);
  assert.equal(seen[0].agentId, 'pc-study', '显式配置的名字应当原样传给 agent');

  seen.length = 0;
  const derived = makeService('');
  try {
    await derived.startRelay();
  } finally {
    await derived.dispose();
  }
  assert.equal(seen.length, 1);
  assert.equal(seen[0].agentId, localAgentId(), '留空时应当按主机名派生');
  assert.notEqual(seen[0].agentId, 'default', '不能再固定成 default（多台电脑会互相踢）');
});

test('service：dispose 会停掉中继（插件卸载不留孤儿连接）', { skip: HAS_RELAY_BINARY ? false : SKIP_HINT }, async () => {
  const relay = await startGoRelay({ token: TOKEN });

  const service = createPocketService({
    dshPort: 1,
    internals: {
      createProxy: async () => ({ port: 3081, close: async () => {} }),
      createRelayAgent,
    },
    getRelayConfig: () => ({ enabled: true, host: '127.0.0.1', port: relay.agentPort, token: TOKEN }),
    log: silent(),
  });
  try {
    await service.startRelay();
    await waitFor(() => service.relayStatus().phase === 'online', 5000, '中继未连上');
    await service.dispose();
    assert.equal(service.relayStatus().phase, 'idle');
    // relay 侧应当看到 agent 掉线（进程内 agent 已断开）
    await relay.close();
  } finally {
    await service.dispose();
    await relay.close();
  }
});

test('RPC：relay.setConfig 保存配置，且响应里永远没有 token 原文', async () => {
  await withTempHomeAsync(async () => {
    const webServer = fakeWebServer();
    const service = {
      dshPort: 3080,
      status: async () => ({ dshPort: 3080 }),
      stopTunnel() {},
      stopRelay() {},
      startRelay: async () => {},
    };
    let stored = {};
    installPocketRpc({ webServer, connection: null }, {
      service,
      getRelayConfig: () => ({ enabled: false, consent: false, host: '', port: 0, tls: false, allowInsecure: false, token: '', publicUrl: '', ...stored }),
      setRelayConfig: (patch) => { stored = { ...stored, ...patch }; return stored; },
      log: silent(),
    });

    const route = webServer.routes.get(POCKET_RPC_CHANNEL);
    assert.ok(route, 'RPC 路由应当已挂上');
    const res = await postRpc(route, POCKET_ENDPOINTS.relaySetConfig, {
      host: 'relay.example.com', port: 8090, token: TOKEN, consent: true,
    });
    assert.equal(res.statusCode, 200);
    const body = await res.json();
    assert.equal(body.result.ok, true, JSON.stringify(body));
    assert.equal(body.result.value.relay.host, 'relay.example.com');
    assert.equal(body.result.value.relay.tokenSet, true);
    // 关键安全断言：整个响应体里不能出现 token 原文
    assert.equal(JSON.stringify(body).includes(TOKEN), false, 'RPC 响应泄露了 relay token');
  });
});

test('RPC：relay.setConfig 会透传本机名称，并出现在脱敏视图里', async () => {
  await withTempHomeAsync(async () => {
    const webServer = fakeWebServer();
    const service = {
      dshPort: 3080,
      status: async () => ({ dshPort: 3080 }),
      stopTunnel() {},
      stopRelay() {},
      startRelay: async () => {},
    };
    let stored = {};
    installPocketRpc({ webServer, connection: null }, {
      service,
      getRelayConfig: () => ({ enabled: false, consent: true, host: '', port: 0, tls: false, allowInsecure: false, token: '', publicUrl: '', agentId: '', ...stored }),
      setRelayConfig: (patch) => { stored = { ...stored, ...patch }; return stored; },
      log: silent(),
    });
    const route = webServer.routes.get(POCKET_RPC_CHANNEL);

    const res = await postRpc(route, POCKET_ENDPOINTS.relaySetConfig, {
      host: 'relay.example.com', port: 8090, token: TOKEN, agentId: 'pc-b', consent: true,
    });
    const body = await res.json();
    assert.equal(body.result.ok, true, JSON.stringify(body));
    assert.equal(stored.agentId, 'pc-b', '本机名称没有透传到 setRelayConfig');
    assert.equal(body.result.value.relay.agentId, 'pc-b', '脱敏视图里应当带上本机名称');
  });
});

test('RPC：relay.setEnabled 开启时透传，未配置则报错', async () => {
  await withTempHomeAsync(async () => {
    const webServer = fakeWebServer();
    const service = {
      dshPort: 3080,
      status: async () => ({ dshPort: 3080 }),
      stopTunnel() {},
      stopRelay() {},
      startRelay: async () => {},
    };
    let stored = { host: '', port: 0, token: '' };
    installPocketRpc({ webServer, connection: null }, {
      service,
      getRelayConfig: () => ({ enabled: false, consent: true, tls: false, allowInsecure: false, publicUrl: '', ...stored }),
      setRelayConfig: (patch) => {
        if (patch.enabled === true && !(stored.host && stored.port && stored.token)) {
          throw new Error('请先填写中继地址、端口和 Token');
        }
        stored = { ...stored, ...patch };
        return stored;
      },
      log: silent(),
    });
    const route = webServer.routes.get(POCKET_RPC_CHANNEL);

    const bad = await postRpc(route, POCKET_ENDPOINTS.relaySetEnabled, { on: true });
    const badBody = await bad.json();
    assert.equal(badBody.result.ok, false);
    assert.match(badBody.result.error.message, /请先填写中继地址/);

    stored = { host: 'r.example.com', port: 8090, token: TOKEN };
    const good = await postRpc(route, POCKET_ENDPOINTS.relaySetEnabled, { on: true });
    const goodBody = await good.json();
    assert.equal(goodBody.result.ok, true, JSON.stringify(goodBody));
    assert.equal(goodBody.result.value.relay.enabled, true);
  });
});

test('RPC：恢复出厂设置会一并撤销已配对设备（否则「重置」后旧手机还能进）', async () => {
  await withTempHomeAsync(async () => {
    const webServer = fakeWebServer();
    const calls = { resetDevices: 0, stopRelay: 0, stopTunnel: 0, resetPocket: 0 };
    const service = {
      dshPort: 3080,
      status: async () => ({ dshPort: 3080 }),
      stopTunnel() { calls.stopTunnel += 1; },
      stopRelay() { calls.stopRelay += 1; },
      resetDevices() { calls.resetDevices += 1; },
      startRelay: async () => {},
      relayStatus: () => ({ phase: 'idle' }),
    };
    installPocketRpc({ webServer, connection: null }, {
      service,
      resetPocket: () => { calls.resetPocket += 1; return { accessToken: 'x', lanToken: 'y' }; },
      getRelayConfig: () => ({ enabled: true, consent: true, host: 'r.example.com', port: 8090, token: 'x'.repeat(24) }),
      log: silent(),
    });
    const route = webServer.routes.get(POCKET_RPC_CHANNEL);

    const res = await postRpc(route, POCKET_ENDPOINTS.pocketReset, { confirm: true });
    const body = await res.json();
    assert.equal(body.result.ok, true, JSON.stringify(body));
    assert.equal(calls.resetDevices, 1, '恢复出厂必须撤销设备凭据');
    assert.equal(calls.stopRelay, 1, '恢复出厂必须先停中继');
    assert.equal(calls.stopTunnel, 1);
    assert.equal(calls.resetPocket, 1);
  });
});

test('RPC：恢复出厂未显式确认时拒绝，且不动任何东西', async () => {
  await withTempHomeAsync(async () => {
    const webServer = fakeWebServer();
    let touched = 0;
    const service = {
      dshPort: 3080,
      status: async () => ({ dshPort: 3080 }),
      stopTunnel() { touched += 1; },
      stopRelay() { touched += 1; },
      resetDevices() { touched += 1; },
      startRelay: async () => {},
    };
    installPocketRpc({ webServer, connection: null }, {
      service,
      resetPocket: () => { touched += 1; },
      log: silent(),
    });
    const route = webServer.routes.get(POCKET_RPC_CHANNEL);
    const res = await postRpc(route, POCKET_ENDPOINTS.pocketReset, {});
    const body = await res.json();
    assert.equal(body.result.ok, false);
    assert.match(body.result.error.message, /需要确认/);
    assert.equal(touched, 0, '未确认时不该有任何副作用');
  });
});

// ---------- helpers ----------

function silent() {
  return { info() {}, warn() {}, error() {}, log() {} };
}

async function waitFor(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitFor 超时：${message}`);
}

/** 直接调用挂上去的 route handler，构造一个最小的 node:http 形参对。 */
async function postRpc(route, endpoint, payload) {
  const rpcId = 'r1';
  const body = Buffer.from(JSON.stringify({ rpcId, method: endpoint, payload }));
  const res = fakeResponse();
  await route.handler(
    {
      method: 'POST',
      url: `${POCKET_RPC_CHANNEL}/${endpoint}`,
      headers: { host: '127.0.0.1:3080', 'content-type': 'application/json', 'content-length': String(body.length) },
      [Symbol.asyncIterator]: async function* () { yield body; },
      on() {}, destroy() {},
    },
    res,
  );
  return res;
}

function fakeResponse() {
  const chunks = [];
  let status = 0;
  let headers = {};
  return {
    get statusCode() { return status; },
    headersSent: false,
    writableEnded: false,
    writeHead(code, h) { status = code; headers = h ?? {}; this.headersSent = true; },
    write(chunk) { chunks.push(Buffer.from(chunk)); return true; },
    end(chunk) { if (chunk) chunks.push(Buffer.from(chunk)); this.writableEnded = true; },
    on() {}, once() {}, off() {},
    get body() { return Buffer.concat(chunks).toString('utf8'); },
    json() { return Promise.resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); },
    get allHeaders() { return headers; },
  };
}

/** withTempHome 的异步版本（RPC 用例里要 await）。 */
async function withTempHomeAsync(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dshp-relay-'));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = dir;
  try {
    return await fn(dir);
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}
