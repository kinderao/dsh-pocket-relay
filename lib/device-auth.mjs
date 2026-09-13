// dsh-pocket 设备认证（relay 通道专用）
//
// 为什么 relay 通道不用共享密码：relay 地址是**固定**的，会长期挂在公网上被扫。
// 一个共享的 8 位 PIN 在固定地址上撑不了太久，而且一旦泄露就得全员换密码。
// 设备认证把凭据按设备切开：每台设备一个独立密码，可以单独撤销，泄露面小得多。
//
// 本模块只做**存储与密码学**，不碰 HTTP：登录页、Cookie、限流放在代理那一层
// （与 settings.mjs 之于 web-rpc.js 同款分工）。这样所有安全判定都能脱离
// socket 单测，而 HTTP 层只负责搬参数。
//
// 设计取自 docs/三通道独立管理改造方案.md 的 Named 通道设备认证决策，并沿用
// 本机 dsh-remote/dsh-plugin-mobile-gateway/lib/devices.js 已验证的存储约定：
//   - 长期凭据 token 256 bit，**永不落盘**，只存 SHA-256；
//   - 配对码一次性、仅内存、5 分钟过期，重启即全部失效；
//   - 状态文件原子写（tmp + rename）+ 0600。

import { randomBytes, randomUUID, createHash, timingSafeEqual, scrypt as scryptCb } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, chmodSync, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

/** 状态文件版本（结构变更时递增，加载时按版本迁移）。 */
export const DEVICE_STORE_VERSION = 1;

/** 配对码有效期。 */
export const PAIRING_TTL_MS = 5 * 60 * 1000;

/** 会话空闲上限：**只按真实用户操作**续期（见 touchSession 的说明）。 */
export const SESSION_IDLE_MS = 10 * 60 * 1000;

/**
 * 渐进锁定阶梯：连续失败达到 failures 次就锁 lockMs。
 * 取「不超过当前失败次数的最大一档」，所以 20 次以上一直锁 24 小时。
 * 任何一次成功登录都把计数清零。
 */
export const LOCKOUT_STEPS = Object.freeze([
  { failures: 5, lockMs: 5 * 60 * 1000 },
  { failures: 10, lockMs: 15 * 60 * 1000 },
  { failures: 15, lockMs: 45 * 60 * 1000 },
  { failures: 20, lockMs: 24 * 60 * 60 * 1000 },
]);

/**
 * 设备密码哈希参数。
 *
 * 这里用 Node 内置的 **scrypt** 而不是设计文档写的 Argon2id：Argon2 要引入
 * `argon2` 原生模块，而本插件的卖点之一是「一个 npm 包装完」，原生模块在
 * 各平台预编译二进制缺失时会让安装直接失败。scrypt 同为内存硬化 KDF，
 * Node 自带，没有安装风险。参数按 OWASP 建议取 N=2^15 / r=8 / p=1（约 32 MiB）。
 *
 * maxmem 必须显式给：Node 默认上限 32 MiB，而 128*N*r 正好贴着这个值，
 * 不放开会抛 ERR_CRYPTO_INVALID_SCRYPT_PARAMS。
 */
export const SCRYPT_PARAMS = Object.freeze({ N: 1 << 15, r: 8, p: 1, keylen: 32, maxmem: 96 * 1024 * 1024 });

/** 设备名长度上限。 */
export const MAX_DEVICE_NAME = 80;

/** 设备密码长度下限：它是这台设备唯一的进门凭据，别让人设 4 位。 */
export const MIN_DEVICE_PASSWORD = 8;

/** 默认状态文件路径：$DSH_HOME/dsh-pocket/devices.json。 */
export function deviceStorePath() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-pocket', 'devices.json');
}

/** SHA-256 十六进制摘要（token / 配对码都只以它落盘）。 */
export function digest(secret) {
  return createHash('sha256').update(String(secret), 'utf8').digest('hex');
}

/** 常量时间比较两个 hex 摘要。 */
function safeEqualHex(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

/** 对外可见的设备行（**不含任何哈希**）。 */
function publicDevice(device, at = Date.now()) {
  return {
    id: device.id,
    name: device.name,
    createdAt: device.createdAt,
    lastLoginAt: device.lastLoginAt,
    approved: device.approvedAt !== null,
    pending: device.approvedAt === null,
    lockedUntil: device.lockedUntil && device.lockedUntil > at ? device.lockedUntil : null,
    failures: device.failures,
  };
}

function normalizeName(value, fallback = '未命名设备') {
  const v = String(value ?? '').trim();
  return (v === '' ? fallback : v).slice(0, MAX_DEVICE_NAME);
}

/** 校验设备密码；不合法返回错误文案，合法返回 null。 */
export function validatePassword(value) {
  const v = String(value ?? '');
  if (v.length < MIN_DEVICE_PASSWORD) {
    return `设备密码至少 ${MIN_DEVICE_PASSWORD} 位 | device password must be at least ${MIN_DEVICE_PASSWORD} characters`;
  }
  if (v.length > 200) return '设备密码过长 | device password too long';
  return null;
}

/** 生成 scrypt 哈希（salt 随机）。 */
async function hashPassword(password, params = SCRYPT_PARAMS) {
  const salt = randomBytes(16);
  const derived = await scrypt(String(password), salt, params.keylen, {
    N: params.N, r: params.r, p: params.p, maxmem: params.maxmem,
  });
  return {
    algo: 'scrypt',
    N: params.N,
    r: params.r,
    p: params.p,
    keylen: params.keylen,
    salt: salt.toString('hex'),
    hash: Buffer.from(derived).toString('hex'),
  };
}

/** 校验密码（参数从记录里读，便于以后调参而不失效老记录）。 */
async function verifyPassword(password, record) {
  if (!record || typeof record.salt !== 'string' || typeof record.hash !== 'string') return false;
  let derived;
  try {
    derived = await scrypt(String(password), Buffer.from(record.salt, 'hex'), record.keylen, {
      N: record.N, r: record.r, p: record.p, maxmem: SCRYPT_PARAMS.maxmem,
    });
  } catch {
    return false;
  }
  const expected = Buffer.from(record.hash, 'hex');
  const actual = Buffer.from(derived);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * 创建设备认证器。
 *
 * @param {object} [opts]
 * @param {string} [opts.path]        状态文件路径（默认 deviceStorePath()；测试注入用）
 * @param {number} [opts.pairingTtlMs]
 * @param {number} [opts.sessionIdleMs]
 * @param {() => number} [opts.now]   时钟注入（锁定/过期测试用）
 * @param {object} [opts.scryptParams]
 */
export function createDeviceAuth({
  path = deviceStorePath(),
  pairingTtlMs = PAIRING_TTL_MS,
  sessionIdleMs = SESSION_IDLE_MS,
  now = () => Date.now(),
  scryptParams = SCRYPT_PARAMS,
} = {}) {
  /** @type {Array<object>} 已批准 + 待批准的设备（撤销即删除） */
  let devices = [];
  /** codeHash -> { id, name, expiresAt }：仅内存，重启即失效 */
  const pairings = new Map();
  /** sessionId -> { deviceId, startedAt, lastActivityAt }：仅内存 */
  const sessions = new Map();

  // ---------- 持久化 ----------
  function save() {
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: DEVICE_STORE_VERSION, devices }, null, 2), { mode: 0o600 });
      try { chmodSync(tmp, 0o600); } catch { /* Windows 上 chmod 语义有限 */ }
      renameSync(tmp, path);
    } catch { /* 磁盘问题不该让认证整体崩掉；下次操作再试 */ }
  }

  function load() {
    let raw;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return; // 无文件 / 损坏 → 空表（等同「没有任何已批准设备」）
    }
    if (!raw || !Array.isArray(raw.devices)) return;
    devices = raw.devices.flatMap((row) => {
      if (!row || typeof row.id !== 'string' || typeof row.name !== 'string') return [];
      // tokenHash 是必需的：没有它这条记录永远无法通过凭据校验，留着只会误导
      if (typeof row.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.tokenHash)) return [];
      if (!row.password || typeof row.password.hash !== 'string') return [];
      return [{
        id: row.id,
        name: row.name.slice(0, MAX_DEVICE_NAME),
        tokenHash: row.tokenHash,
        password: row.password,
        createdAt: Number.isFinite(row.createdAt) ? row.createdAt : now(),
        approvedAt: Number.isFinite(row.approvedAt) ? row.approvedAt : null,
        lastLoginAt: Number.isFinite(row.lastLoginAt) ? row.lastLoginAt : null,
        failures: Number.isFinite(row.failures) ? row.failures : 0,
        lockedUntil: Number.isFinite(row.lockedUntil) ? row.lockedUntil : 0,
      }];
    });
  }

  load();

  // ---------- 内部工具 ----------
  const view = (device) => publicDevice(device, now());

  function prunePairings() {
    const t = now();
    for (const [hash, pairing] of pairings) {
      if (pairing.expiresAt <= t) pairings.delete(hash);
    }
  }

  function pruneSessions() {
    const t = now();
    for (const [id, s] of sessions) {
      if (t - s.lastActivityAt > sessionIdleMs) sessions.delete(id);
    }
  }

  function findById(id) {
    return devices.find((d) => d.id === id) ?? null;
  }

  function findByToken(token) {
    if (typeof token !== 'string' || token === '') return null;
    const hash = digest(token);
    return devices.find((d) => safeEqualHex(d.tokenHash, hash)) ?? null;
  }

  /** 当前生效的锁定时长（0 = 未锁）。 */
  function lockFor(failures) {
    let lockMs = 0;
    for (const step of LOCKOUT_STEPS) {
      if (failures >= step.failures) lockMs = step.lockMs;
    }
    return lockMs;
  }

  function sessionFor(sessionId) {
    pruneSessions();
    const s = sessions.get(String(sessionId ?? ''));
    if (!s) return null;
    const device = findById(s.deviceId);
    // 设备被撤销/拒绝 → 已发出去的会话立即失效（撤销必须立刻生效）
    if (!device || device.approvedAt === null) {
      sessions.delete(String(sessionId));
      return null;
    }
    return { session: s, device };
  }

  /** 开一个会话（authenticate 与对外的 createSession 共用，避免依赖 this）。 */
  function openSession(deviceId) {
    pruneSessions();
    const sessionId = randomBytes(32).toString('base64url');
    const t = now();
    sessions.set(sessionId, { deviceId: String(deviceId), startedAt: t, lastActivityAt: t });
    return sessionId;
  }

  return {
    // ---------- 设备列表 / 管理 ----------

    /** 全部设备（已批准 + 待批准），对外安全视图。 */
    list() {
      return devices.map(view);
    },

    /** 待批准设备。 */
    pending() {
      return devices.filter((d) => d.approvedAt === null).map(view);
    },

    /**
     * 生成一次性配对码（仅内存，5 分钟）。
     *
     * 同一时间只允许一个待批准申请（决策 #12）：否则电脑端要面对一堆
     * 分不清来源的待批准条目，用户很容易点错批准。
     */
    createPairing({ name } = {}) {
      prunePairings();
      if (devices.some((d) => d.approvedAt === null) || pairings.size > 0) {
        return { error: '已有待批准的配对申请，请先在电脑上处理 | a pairing request is already pending' };
      }
      const code = randomBytes(32).toString('base64url');
      const pairing = { id: randomUUID(), name: normalizeName(name), expiresAt: now() + pairingTtlMs };
      pairings.set(digest(code), pairing);
      return { code, name: pairing.name, expiresAt: pairing.expiresAt };
    },

    /**
     * 手机提交配对：校验一次性配对码 → 建「待批准」设备并**当场**下发凭据。
     *
     * 凭据在提交时就发（决策 #12）：批准只是一个入册动作，批准前凭据用不了
     * （authenticate 要求 approvedAt 非空），所以先发不会造成越权，
     * 却能让手机提交完就能关页面等电脑批准。
     */
    async claimPairing(code, { name, password } = {}) {
      prunePairings();
      const codeHash = digest(String(code ?? ''));
      const pairing = pairings.get(codeHash);
      if (!pairing) return { error: '配对码无效或已过期 | pairing code is invalid or expired' };
      // 先删再干活：即使后面任何一步失败，这个码也只能用一次
      pairings.delete(codeHash);

      const pwError = validatePassword(password);
      if (pwError) return { error: pwError };

      const token = randomBytes(32).toString('base64url');
      const device = {
        id: pairing.id,
        name: normalizeName(name, pairing.name),
        tokenHash: digest(token),
        password: await hashPassword(password, scryptParams),
        createdAt: now(),
        approvedAt: null,          // 等电脑批准
        lastLoginAt: null,
        failures: 0,
        lockedUntil: 0,
      };
      devices.push(device);
      save();
      return { device: view(device), token };
    },

    /**
     * 撤销当前未使用的配对码。
     *
     * 没有它的话，一个没人扫的配对码会把「同时只允许一个待批准申请」的槽位
     * 占满 5 分钟——用户点了「添加设备」又反悔，就只能干等。
     */
    cancelPairing() {
      const had = pairings.size > 0;
      pairings.clear();
      return had;
    },

    /** 电脑批准一台待批准设备。 */
    approve(id) {
      const device = findById(String(id));
      if (!device || device.approvedAt !== null) return false;
      device.approvedAt = now();
      save();
      return true;
    },

    /** 电脑拒绝一台待批准设备（直接删除）。 */
    reject(id) {
      const device = findById(String(id));
      if (!device || device.approvedAt !== null) return false;
      devices = devices.filter((d) => d !== device);
      for (const [sid, s] of [...sessions]) if (s.deviceId === device.id) sessions.delete(sid);
      save();
      return true;
    },

    /** 撤销一台已批准设备：记录删除、会话立即失效、旧凭据立即作废。 */
    revoke(id) {
      const device = findById(String(id));
      if (!device) return false;
      devices = devices.filter((d) => d !== device);
      for (const [sid, s] of [...sessions]) if (s.deviceId === device.id) sessions.delete(sid);
      save();
      return true;
    },

    // ---------- 认证 ----------

    /**
     * 设备登录：**凭据 + 密码双条件**（决策 #11）。
     *
     * - 凭据 token 决定「是哪台设备」。没有有效凭据 → 直接拒（未配对浏览器
     *   即使知道设备密码也进不来）；
     * - 密码决定「是不是本人」；
     * - 锁定期内**不做密码比对**就直接拒——否则锁定窗口本身就成了免费的
     *   穷举窗口（与 lib/proxy.mjs 对 PIN 的处理一致）；
     * - 成功后轮换 token（旧值立即失效），并开一个新会话。
     *
     * @returns {Promise<{ok:true, device:object, token:string, sessionId:string}
     *          |{ok:false, reason:string, retryAfter?:number}>}
     */
    async authenticate({ token, password } = {}) {
      const device = findByToken(token);
      if (!device) return { ok: false, reason: 'no-credential' };

      if (device.approvedAt === null) return { ok: false, reason: 'not-approved' };

      const t = now();
      if (device.lockedUntil > t) {
        return { ok: false, reason: 'locked', retryAfter: Math.ceil((device.lockedUntil - t) / 1000) };
      }

      const ok = await verifyPassword(password, device.password);
      if (!ok) {
        device.failures += 1;
        const lockMs = lockFor(device.failures);
        if (lockMs > 0) device.lockedUntil = t + lockMs;
        save();
        return {
          ok: false,
          reason: 'bad-password',
          failures: device.failures,
          lockedUntil: device.lockedUntil > t ? device.lockedUntil : null,
          retryAfter: device.lockedUntil > t ? Math.ceil((device.lockedUntil - t) / 1000) : 0,
        };
      }

      // 成功：清零计数、轮换凭据、记录最后登录
      const freshToken = randomBytes(32).toString('base64url');
      device.tokenHash = digest(freshToken);
      device.failures = 0;
      device.lockedUntil = 0;
      device.lastLoginAt = t;
      save();

      const sessionId = openSession(device.id);
      return { ok: true, device: view(device), token: freshToken, sessionId };
    },

    // ---------- 会话 ----------

    /** 开一个会话（内部也会被 authenticate 调用）。 */
    createSession(deviceId) {
      return openSession(deviceId);
    },

    /** 会话是否有效；有效返回设备视图。 */
    validateSession(sessionId) {
      const hit = sessionFor(sessionId);
      return hit ? view(hit.device) : null;
    },

    /**
     * 续期会话 —— **只由真实用户操作驱动**（决策 #8）。
     *
     * 明确不算活动的东西：WebSocket 心跳、后台自动请求、页面只是停在
     * 前台不动。旧实现那套「页面可见就每 30s ping 一次」会让前台静置
     * 永不超时，等于没有超时，已废弃。
     */
    touchSession(sessionId) {
      const hit = sessionFor(sessionId);
      if (!hit) return false;
      hit.session.lastActivityAt = now();
      return true;
    },

    /** 主动登出。 */
    dropSession(sessionId) {
      return sessions.delete(String(sessionId ?? ''));
    },

    /** 运维/自检视图。 */
    status() {
      pruneSessions();
      prunePairings();
      return {
        devices: devices.filter((d) => d.approvedAt !== null).length,
        pending: devices.filter((d) => d.approvedAt === null).length,
        pairings: pairings.size,
        sessions: sessions.size,
      };
    },

    // ---------- 测试/维护 ----------

    /** 清空一切（恢复出厂设置用）。 */
    reset() {
      devices = [];
      pairings.clear();
      sessions.clear();
      try { rmSync(path, { force: true }); } catch { /* 忽略 */ }
    },

    /** 从磁盘重读（测试用；正常运行时不需要）。 */
    reload() {
      devices = [];
      load();
    },
  };
}
