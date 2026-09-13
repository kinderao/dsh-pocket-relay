// 多台电脑（多 PC 端）共存与热备。
//
// 这一组直接打**真实的 Go relay**，因为要证明的正是「两条 Node agent 与 Go 服务端
// 之间的登记、路由、管理动作」这条跨语言链路：
//   - 两台不同名字的电脑能同时在线（同名才会互相踢——这是「多机」的前提）；
//   - 只有首选那台接流，首选掉线才轮到备机；
//   - 管理端能改首选、能断开、能禁止接入，并且落盘。
//
// 单侧单测（relay/internal/hub/hub_test.go）已经覆盖了路由规则的细节，这里补的是
// 「Node agent 报的名字真的被服务端当成了不同的机器」这一环。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRelayAgent, localAgentId, isValidAgentId } from '../lib/relay.mjs';
import { relayBinary, startGoRelay, SKIP_HINT } from './helpers/go-relay.mjs';

const TOKEN = 'multi-agent-token-0123456789abcdef';
const ADMIN_PW = 'multi-agent-admin-pw';
const HAS_RELAY_BINARY = relayBinary() !== null;
const skip = HAS_RELAY_BINARY ? false : SKIP_HINT;

// ---------- 本机名字的派生与校验 ----------

test('localAgentId：主机名派生出的名字必须合法，且不能退化成固定值', () => {
  const id = localAgentId();
  assert.ok(isValidAgentId(id), `派生出的名字不合法：${JSON.stringify(id)}`);
  // 关键：不能再是固定的 'default'，否则多台电脑会互相顶下线
  assert.notEqual(id, 'default');
  assert.ok(id.length <= 32);
  // 每次调用都一样（否则每次重连都换名字，relay 那边会以为是新机器）
  assert.equal(localAgentId(), id);
});

test('isValidAgentId：字符集与服务端 ValidAgentID 保持一致', () => {
  for (const ok of ['pc-a', 'PC_B', 'desktop.1', 'a', 'x'.repeat(32)]) {
    assert.equal(isValidAgentId(ok), true, `应当合法：${ok}`);
  }
  for (const bad of ['', '有中文', 'a b', 'a/b', 'a\nb', 'a:b', 'x'.repeat(33), null, undefined]) {
    assert.equal(isValidAgentId(bad), false, `应当被拒：${JSON.stringify(bad)}`);
  }
});

// ---------- 端到端：两台电脑 + 管理端 ----------

/** 起一个 relay agent（只连控制连接；测试不跑访客流量，所以不需要本机代理）。 */
function startAgent(relay, agentId) {
  const agent = createRelayAgent({
    host: '127.0.0.1',
    port: relay.agentPort,
    token: TOKEN,
    agentId,
    getTargetPort: () => 3081,   // 不会被连上：这些用例不做访客转发
    log: { info() {}, warn() {}, error() {} },
    backoff: { minMs: 50, maxMs: 200 },
    heartbeat: { intervalMs: 100, timeoutMs: 5000 },
  });
  agent.start();
  return agent;
}

async function waitFor(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitFor 超时：${message}`);
}

/** 极简管理端客户端：登录拿 cookie，然后调 API。 */
async function adminClient(port) {
  const base = `http://127.0.0.1:${port}`;
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: ADMIN_PW }),
    redirect: 'manual',
  });
  const setCookie = res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? '';
  const cookie = setCookie.split(';')[0];
  assert.ok(cookie.startsWith('dshp_admin='), `登录没有拿到会话 cookie：${setCookie}`);

  const api = async (path, body) => {
    const r = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  return {
    status: () => api('/api/status'),
    setDefault: (id) => api('/api/agent/default', { id }),
    kick: (id) => api('/api/agent/kick', { id }),
    block: (id, blocked) => api('/api/agent/block', { id, blocked }),
  };
}

test('多机：两台电脑同时在线，只有首选那台接流；管理端可切首选/断开/禁止', { skip }, async () => {
  const relay = await startGoRelay({
    token: TOKEN,
    admin: true,
    adminPassword: ADMIN_PW,
    defaultAgent: 'pc-a',
  });
  const agents = [];
  try {
    const admin = await adminClient(relay.adminPort);

    const a = startAgent(relay, 'pc-a');
    const b = startAgent(relay, 'pc-b');
    agents.push(a, b);

    // 两台都连上，并且**同时**在线 —— 这就是「多 PC 端共存」
    await waitFor(async () => {
      const { body } = await admin.status();
      return (body.hub.agents ?? []).length === 2;
    }, 8000, '两台电脑没有同时上线');

    const st = (await admin.status()).body;
    const ids = st.hub.agents.map((x) => x.id).sort();
    assert.deepEqual(ids, ['pc-a', 'pc-b'], '两台电脑应当分别登记');
    assert.equal(st.hub.serving, 'pc-a', '首选是 pc-a，应当由它接流');
    assert.equal(st.hub.defaultAgent, 'pc-a');
    // 接流标记只能有一个
    assert.equal(st.hub.agents.filter((x) => x.serving).length, 1);
    // 没被选中的那台不能被标成 stale（它是活的，只是没轮到它）
    assert.equal(st.hub.agents.find((x) => x.id === 'pc-b').stale, false);

    // 切首选 → 接流目标跟着换
    const sw = await admin.setDefault('pc-b');
    assert.equal(sw.status, 200, JSON.stringify(sw.body));
    assert.equal(sw.body.hub.serving, 'pc-b');
    assert.equal((await admin.status()).body.hub.serving, 'pc-b');

    // 断开首选：PC 侧会自己重连（不是致命错误），所以它应当重新上线
    const kicked = await admin.kick('pc-b');
    assert.equal(kicked.status, 200, JSON.stringify(kicked.body));
    await waitFor(async () => {
      const { body } = await admin.status();
      return (body.hub.agents ?? []).some((x) => x.id === 'pc-b');
    }, 8000, '被断开的电脑没有自动重连（断开不该是致命的）');

    // 非法名字要 400，而不是写进配置
    const bad = await admin.setDefault('bad name!');
    assert.equal(bad.status, 400);
    assert.equal((await admin.status()).body.hub.defaultAgent, 'pc-b', '非法输入不该改掉当前首选');

    // 禁止接入：另一台立刻消失，并且它的 agent 会收到明确的拒绝原因
    const blocked = await admin.block('pc-a', true);
    assert.equal(blocked.status, 200, JSON.stringify(blocked.body));
    assert.deepEqual(blocked.body.hub.blockedAgents, ['pc-a']);
    await waitFor(async () => {
      const { body } = await admin.status();
      return !(body.hub.agents ?? []).some((x) => x.id === 'pc-a');
    }, 8000, '被禁止的电脑还挂在 agents 里');

    // PC 侧看到的是「中继拒绝：agent-blocked…」，而不是无限重连
    await waitFor(() => a.status().phase === 'error', 8000, '被禁的 agent 没有进入错误态');
    assert.match(a.status().detail, /agent-blocked/, `拒绝原因不明确：${a.status().detail}`);
    // 关键：被禁不代表被断网——没被禁的那台还在线且仍然接流
    const after = (await admin.status()).body;
    assert.equal(after.hub.serving, 'pc-b', '禁掉一台后应当由剩下的那台接流');

    // 解除禁止后重新允许接入（PC 侧需要重启 agent 才会重试，这里只验证服务端放行）
    const unblocked = await admin.block('pc-a', false);
    assert.equal(unblocked.status, 200);
    assert.deepEqual(unblocked.body.hub.blockedAgents, []);
    // 落盘（重启后黑名单还在）由 Go 侧 TestAgentManagementEndpoints 覆盖：
    // 它用同一份 stateFile 重开一个 Server，能真正证明持久化。
  } finally {
    for (const a of agents) a.stop();
    await relay.close().catch(() => {});
  }
});

test('多机：首选掉线后由备机接管（热备），新机器上线不抢流量', { skip }, async () => {
  const relay = await startGoRelay({
    token: TOKEN,
    admin: true,
    adminPassword: ADMIN_PW,
    defaultAgent: 'pc-a',
    agentIdleMs: 400,
  });
  const agents = [];
  try {
    const admin = await adminClient(relay.adminPort);
    const a = startAgent(relay, 'pc-a');
    await waitFor(async () => (await admin.status()).body.hub.agents.length === 1, 8000, 'pc-a 没上线');
    await new Promise((r) => setTimeout(r, 60));   // 让 pc-b 的注册时间明确晚一些
    const b = startAgent(relay, 'pc-b');
    agents.push(a, b);
    await waitFor(async () => (await admin.status()).body.hub.agents.length === 2, 8000, 'pc-b 没上线');

    assert.equal((await admin.status()).body.hub.serving, 'pc-a');

    // pc-a 停止心跳（模拟假死：进程还在、链路已成黑洞）→ 由 pc-b 接管。
    // b 的心跳间隔是 100ms，远小于 400ms 的 agentIdle，所以它保持新鲜。
    a.stop();
    await waitFor(async () => {
      const { body } = await admin.status();
      return body.hub.serving === 'pc-b';
    }, 8000, '首选假死后备机没有接管（热备失效）');
  } finally {
    for (const a of agents) a.stop();
    await relay.close().catch(() => {});
  }
});
