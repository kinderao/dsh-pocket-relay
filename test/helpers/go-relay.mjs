// 跨语言端到端测试的辅助：启动 **Go 版** relay 二进制，让 Node 侧 agent 连上去。
//
// 这是唯一能证明「Go 服务端与 Node agent 线协议兼容」的手段——任何单侧的测试
// 都只能证明自己那一半。协议一旦漂移（比如 Go 侧忘了 takeRest 的等价处理），
// 只有这里会红。
//
// 二进制**不在这里构建**：`go build` 首次要几十秒，塞进测试会被 --test-timeout
// 掐掉，而且大多数环境根本没装 Go。改为「没有就跳过」，用 npm run build:relay 预构建。

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 当前平台的 relay 二进制路径（build.mjs 产出）。 */
export function relayBinaryPath() {
  const ext = process.platform === 'win32' ? '.exe' : '';
  return join(repoRoot, 'relay', 'dist', `dsh-pocket-relay${ext}`);
}

/** 二进制是否可用；不可用时给出可操作的提示。 */
export function relayBinary() {
  const p = relayBinaryPath();
  return existsSync(p) ? p : null;
}

export const SKIP_HINT = 'relay 二进制未构建：先跑 `npm run build:relay`（需要 Go 1.25+）';

const silent = { info() {}, warn() {}, error() {} };
export { silent };

/** 等 stdout 里出现 relay-listen 行，解析出实际监听地址（端口 0 时尤其需要）。 */
function waitForListen(child, timeoutMs = 15000) {
  return new Promise((resolvePromise, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`等待 relay 启动超时；已收到输出：\n${buf}`)), timeoutMs);
    const onData = (chunk) => {
      buf += String(chunk);
      const m = /relay-listen agent=(\S+) visitor=(\S+)(?: admin=(\S+))?/.exec(buf);
      if (m) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolvePromise({ agentAddr: m[1], visitorAddr: m[2], adminAddr: m[3] ?? null });
      }
    };
    child.stdout.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`relay 进程提前退出（code=${code}）：\n${buf}`));
    });
  });
}

const portOf = (addr) => Number(String(addr).slice(String(addr).lastIndexOf(':') + 1));

/** 收集 limits 覆盖项（agentIdleMs 是顶层快捷参数）。 */
function buildLimits(opts) {
  const l = { ...(opts.limits ?? {}) };
  if (opts.agentIdleMs) l.agentIdleMs = opts.agentIdleMs;
  return Object.keys(l).length ? l : null;
}

/**
 * 启动一个 Go relay 实例。
 *
 * @param {object} opts
 * @param {string} opts.token
 * @param {string[]} [opts.allowIps]
 * @param {object} [opts.limits]
 * @param {string} [opts.domain]   提供时启用 TLS（用测试夹具证书）
 * @param {string} [opts.certFile]
 * @param {string} [opts.keyFile]
 * @param {boolean} [opts.admin]   是否启用 Web 管理端
 * @param {string} [opts.adminPassword]
 * @param {string} [opts.defaultAgent] 首选接流的 agent 名（多机测试用，默认 'default'）
 * @param {number} [opts.agentIdleMs]  agent 多久没消息算「假死」（多机热备测试用）
 */
export async function startGoRelay(opts = {}) {
  const bin = relayBinary();
  if (!bin) throw new Error(SKIP_HINT);

  const dir = mkdtempSync(join(tmpdir(), 'dshp-gorelay-'));
  const cfgPath = join(dir, 'config.json');
  const tls = Boolean(opts.certFile && opts.keyFile);

  const cfg = {
    token: opts.token,
    agent: { host: '127.0.0.1', port: 0, tls },
    visitor: { host: '127.0.0.1', port: 0, tls, proxyProtocol: opts.proxyProtocol === true },
    admin: opts.admin
      ? { enabled: true, host: '127.0.0.1', port: 0, tls: false, password: opts.adminPassword ?? 'test-admin-pw', stateFile: join(dir, 'admin.json') }
      : { enabled: false },
    cert: { mode: 'files', ...(tls ? { certFile: opts.certFile, keyFile: opts.keyFile } : {}) },
    defaultAgent: opts.defaultAgent ?? 'default',
    allowIps: opts.allowIps ?? [],
    // limits 支持部分覆盖（服务端会把缺的字段补成默认值）
    ...(buildLimits(opts) ? { limits: buildLimits(opts) } : {}),
  };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');

  const child = spawn(bin, ['--config', cfgPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += String(c); });

  const { agentAddr, visitorAddr, adminAddr } = await waitForListen(child);

  return {
    proc: child,
    agentAddr,
    visitorAddr,
    adminAddr,
    agentPort: portOf(agentAddr),
    visitorPort: portOf(visitorAddr),
    adminPort: adminAddr ? portOf(adminAddr) : null,
    get stderr() { return stderr; },
    async close() {
      await new Promise((r) => {
        if (child.exitCode !== null) return r();
        child.once('exit', () => r());
        child.kill('SIGTERM');
        setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* 已退出 */ } r(); }, 2000);
      });
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
