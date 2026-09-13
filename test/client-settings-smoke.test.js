// 设置页「中继 + 设备管理」区块的渲染冒烟测试
//
// 为什么需要它：`node client/build.mjs` 只能证明**语法**没问题，证明不了渲染
// 时不会抛错。新增的两百多行渲染代码里有大量作用域引用（Switch / fmt / errText /
// busy / devices…），任何一个拼错都要等用户打开设置页才会炸。
//
// 做法：把打包产物真跑一遍。用一个极小的 React 运行时垫片（useState/useEffect
// 能真正触发重渲染）驱动组件走完「首屏 → 拉 status → 重渲染」这条真实路径，
// 这样「中继已启用 + 有设备」那段分支才会被真的执行到。
//
// 不追求像素级断言，只守「能渲染出来且关键内容在场」。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const BUNDLE = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');

/**
 * 最小 React 运行时：hooks 按调用顺序编号，setState 标脏 → 调用方重渲染。
 * 不实现并发/优先级那一套，只需要「effect 跑起来、状态更新能反映到下一帧」。
 */
function createReactRuntime() {
  let states = [];
  let refs = [];
  let deps = [];
  let cursor = 0;
  let dirty = false;
  let pending = [];

  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(init) {
      const i = cursor++;
      if (!(i in states)) states[i] = typeof init === 'function' ? init() : init;
      return [states[i], (v) => {
        const next = typeof v === 'function' ? v(states[i]) : v;
        if (next !== states[i]) { states[i] = next; dirty = true; }
      }];
    },
    useRef(v) {
      const i = cursor++;
      if (!(i in refs)) refs[i] = { current: v };
      return refs[i];
    },
    useEffect(fn, d) {
      const i = cursor++;
      const prev = deps[i];
      const changed = !d || !prev || d.length !== prev.length || d.some((x, k) => x !== prev[k]);
      if (changed) { deps[i] = d; pending.push(fn); }
    },
    useLayoutEffect() {},
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn(),
    Fragment: 'Fragment',
  };

  return {
    React,
    reset() { cursor = 0; dirty = false; pending = []; },
    get dirty() { return dirty; },
    /** 跑本帧登记的 effect，并等它们发起的 promise 链落地。 */
    async settle() {
      const fns = pending;
      pending = [];
      for (const fn of fns) {
        try { fn(); } catch { /* effect 里的 DOM 逻辑与本次无关 */ }
      }
      for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
    },
  };
}

/** 反复「渲染 → 跑 effect → 若状态变了再渲染」，直到稳定。 */
async function renderComponent(Component, props, rt, maxPasses = 8) {
  let tree = null;
  for (let pass = 0; pass < maxPasses; pass++) {
    rt.reset();
    tree = Component(props);
    await rt.settle();
    if (!rt.dirty) break;
  }
  return tree;
}

/** 加载打包产物，返回它的 exports。产物形如 window.__ModuleLoader__.load({ factory })。 */
function loadBundle(React) {
  let exports = null;
  const requireStub = (name) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') {
      return { jsx: React.createElement, jsxs: React.createElement, Fragment: 'Fragment' };
    }
    // 图标等外部模块：任何属性都给一个能当组件用的空函数
    return new Proxy({}, { get: () => function Stub() { return null; } });
  };
  const documentStub = {
    body: { setAttribute() {}, style: {}, appendChild() {} },
    documentElement: { appendChild() {} },
    head: { appendChild() {} },
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, dataset: {} }),
  };
  const sandbox = {
    console,
    setTimeout, clearTimeout,
    // 定时器不复用真实实现：组件里的轮询会让测试进程挂着不退
    setInterval: () => 0,
    clearInterval: () => {},
    // vm 的裸上下文里没有这些全局，产物会用到 URL（mobileApply 读 ?dsh-layout）
    URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, AbortSignal,
    MutationObserver: class { observe() {} disconnect() {} },
    document: documentStub,
    navigator: { clipboard: {} },
    window: {
      __ModuleLoader__: { load: (m) => { exports = m.factory(requireStub); } },
      // 宽屏 → mobileApply 早早 return，不走移动端那套 DOM 逻辑
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      location: { href: 'http://localhost:3080/' },
    },
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(BUNDLE, sandbox, { filename: 'client.js' });
  assert.ok(exports, '打包产物没有调用 __ModuleLoader__.load');
  return exports;
}

/** 建一个能捕获 slots.register 组件的 ctx。 */
function makeCtx() {
  const slots = new Map();
  const ctx = {
    connection: { rpc: { call: async () => ({ ok: true, value: {} }) }, isLoopback: true },
    locale: { bind: () => (k) => k, register: () => () => {} },
    effect: (fn) => { try { fn(); } catch { /* 忽略 */ } return () => {}; },
    slots: {
      inject: (name, fn) => (typeof fn === 'function' ? fn() : undefined),
      register: (meta, component) => { slots.set(meta.id, component); return () => {}; },
    },
    layout: { toggleSidebar() {} },
    sessionLogDownload: { download() {} },
    get: () => undefined,
  };
  return { ctx, slots };
}

/** 「中继已启用、一台已批准 + 一台待批准」的 status 响应。 */
function relayEnabledStatus() {
  return {
    ok: true,
    value: {
      proxyRunning: true, proxyPort: 3081, lanUrl: 'http://192.168.1.9:3081',
      lanQr: null, lanCandidates: [], lanIpOverride: '', lanEnabled: true,
      lanAuthEnabled: true, lanToken: '12345678', accessToken: '87654321',
      publicPinCustom: false, lanPinCustom: false, desktop: false, restartNotice: null,
      killHint: 'lsof', tunnelUrl: null, tunnelQr: null, tunnelState: { phase: 'idle' },
      tunnelConfig: { mode: 'quick', hostname: '', tokenSet: false }, dshPort: 3080,
      relay: {
        enabled: true, consent: true, host: 'pocket.example.com', port: 8444,
        tls: true, allowInsecure: false, tokenSet: true,
        publicUrl: 'https://pocket.example.com:8443',
      },
      relayState: { phase: 'online', detail: '', reconnects: 2, streams: 1 },
      relayQr: 'data:image/png;base64,RELAYQR',
      deviceStatus: { devices: 1, pending: 1, pairings: 0, sessions: 1 },
    },
  };
}

const DEVICE_LIST = {
  ok: true,
  value: {
    devices: [{
      id: 'd1', name: '我的 iPhone', createdAt: Date.now(), lastLoginAt: Date.now(),
      approved: true, pending: false, lockedUntil: null, failures: 0,
    }],
    pending: [{
      id: 'd2', name: 'iPad', createdAt: Date.now(), lastLoginAt: null,
      approved: false, pending: true, lockedUntil: null, failures: 0,
    }],
    status: { devices: 1, pending: 1, pairings: 0, sessions: 1 },
  },
};

/** 把元素树序列化成字符串，方便断言「某段内容渲染出来了」。 */
function flatten(tree) {
  return JSON.stringify(tree, (k, v) => (typeof v === 'function' ? '[fn]' : v));
}

async function boot({ rpcCall }) {
  const rt = createReactRuntime();
  const exports = loadBundle(rt.React);
  const { ctx, slots } = makeCtx();
  exports.apply(ctx);
  const Tab = slots.get('pocket');
  assert.equal(typeof Tab, 'function', '设置页组件没注册上');
  const tree = await renderComponent(Tab, { rpcCall, t: (k) => k }, rt);
  return { tree, flatten: flatten(tree) };
}

test('设置页组件能加载并注册', () => {
  const rt = createReactRuntime();
  const exports = loadBundle(rt.React);
  assert.equal(typeof exports.apply, 'function');
  const { ctx, slots } = makeCtx();
  exports.apply(ctx);
  assert.equal(typeof slots.get('pocket'), 'function', '设置页组件没注册上');
  assert.equal(typeof exports.redactStatus, 'function');
});

test('中继区块：未配置时渲染「请先填写」分支', async () => {
  const { flatten: flat } = await boot({
    rpcCall: async () => ({ ok: true, value: { dshPort: 3080 } }),
  });
  assert.match(flat, /relayTitle/);
  assert.match(flat, /relayNeedCfg/, '未配置时应提示先填写');
});

test('中继区块：已启用 + 有设备时渲染完整分支（状态点/二维码/设备列表）', async () => {
  const status = relayEnabledStatus();
  const { flatten: flat } = await boot({
    rpcCall: async (endpoint) => (endpoint === 'device.list' ? DEVICE_LIST : status),
  });

  assert.match(flat, /relayTitle/);
  assert.match(flat, /relayStateOnline/, '在线状态没渲染出来');
  // 状态点用绿色（online）
  assert.match(flat, /state-success-primary/);
  // 对外地址二维码
  assert.match(flat, /data:image\/png;base64,RELAYQR/);
  assert.match(flat, /https:\/\/pocket\.example\.com:8443/);
  // 设备管理：标题、待批准、已批准
  assert.match(flat, /deviceTitle/);
  assert.match(flat, /devicePendingTitle/);
  assert.match(flat, /我的 iPhone/);
  assert.match(flat, /iPad/);
  assert.match(flat, /deviceApprove/);
  assert.match(flat, /deviceRevoke/);
  // 不涉及回显敏感值（relay token 永远不回显）
  assert.doesNotMatch(flat, /relayTokenMissing/);
});

test('中继区块：未启用时显示「未启用」而不是在线（状态点不能骗人）', async () => {
  const status = relayEnabledStatus();
  status.value.relay = { ...status.value.relay, enabled: false };
  status.value.relayState = { phase: 'idle', detail: '', reconnects: 0, streams: 0 };
  const { flatten: flat } = await boot({
    rpcCall: async (endpoint) => (endpoint === 'device.list' ? DEVICE_LIST : status),
  });
  assert.match(flat, /relayStateIdle/);
  assert.doesNotMatch(flat, /relayStateOnline/);
});

test('中继区块：出错时展示错误态与原因，而不是停在「连接中」', async () => {
  const status = relayEnabledStatus();
  status.value.relayState = { phase: 'error', detail: 'token rejected | bad-token', reconnects: 7, streams: 0 };
  const { flatten: flat } = await boot({
    rpcCall: async (endpoint) => (endpoint === 'device.list' ? DEVICE_LIST : status),
  });
  assert.match(flat, /relayStateError/);
  assert.match(flat, /bad-token/, '错误原因应当显示出来，否则用户无从排查');
});
