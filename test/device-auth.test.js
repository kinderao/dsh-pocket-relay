// 设备认证（relay 通道）单元测试
//
// 这一组测的是安全属性本身，不是「函数能跑」：凭据不落盘、配对码一次性、
// 凭据与密码必须同时成立、锁定阶梯、撤销立刻生效、会话只按真实活动续期。
// 任何一条被改坏，relay 通道就等于开在公网上的后门。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createDeviceAuth, validatePassword, digest,
  LOCKOUT_STEPS, SESSION_IDLE_MS, SCRYPT_PARAMS, MIN_DEVICE_PASSWORD,
} from '../lib/device-auth.mjs';

/** 测试用快参数：真实参数 N=2^15 每次哈希 ~50ms，几十次调用会把测试拖慢。 */
const FAST = { N: 1 << 12, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

const PASSWORD = 'device-password-1';

/** 可控时钟：锁定/过期都要靠它，不然测试得真等 24 小时。 */
function makeClock(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; }, get value() { return t; } };
}

function withStore(fn, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dshp-dev-'));
  const path = join(dir, 'devices.json');
  const clock = opts.clock ?? makeClock();
  const auth = createDeviceAuth({ path, now: clock.now, scryptParams: FAST, ...opts.extra });
  const done = () => {
    rmSync(dir, { recursive: true, force: true });
    return dir;
  };
  return Promise.resolve(fn({ auth, path, clock, dir })).finally(done);
}

/** 走完「配对 → 提交 → 批准」，返回可直接登录的凭据。 */
async function pairedDevice(auth, { name = '测试手机', password = PASSWORD } = {}) {
  const pairing = auth.createPairing({ name });
  assert.ok(pairing.code, `配对码未生成：${pairing.error}`);
  const claimed = await auth.claimPairing(pairing.code, { name, password });
  assert.ok(claimed.token, `配对失败：${claimed.error}`);
  assert.equal(auth.approve(claimed.device.id), true);
  return { deviceId: claimed.device.id, token: claimed.token };
}

// ---------- 密码校验 ----------

test('设备密码：长度下限与长度上限', () => {
  assert.match(validatePassword('1234567'), new RegExp(`至少 ${MIN_DEVICE_PASSWORD}`));
  assert.equal(validatePassword('12345678'), null);
  assert.equal(validatePassword('x'.repeat(200)), null);
  assert.match(validatePassword('x'.repeat(201)), /过长/);
});

test('真实 scrypt 参数可用（N=2^15 贴着 Node 默认 maxmem，必须显式放开）', async () => {
  // 这条专门守 SCRYPT_PARAMS：参数一旦改回不显式设 maxmem，Node 会抛
  // ERR_CRYPTO_INVALID_SCRYPT_PARAMS，而快参数测试发现不了。
  const dir = mkdtempSync(join(tmpdir(), 'dshp-dev-real-'));
  try {
    const auth = createDeviceAuth({ path: join(dir, 'd.json'), scryptParams: SCRYPT_PARAMS });
    const pairing = auth.createPairing({ name: 'real' });
    const claimed = await auth.claimPairing(pairing.code, { password: PASSWORD });
    assert.ok(claimed.token, `真实参数下配对失败：${claimed.error}`);
    auth.approve(claimed.device.id);
    const out = await auth.authenticate({ token: claimed.token, password: PASSWORD });
    assert.equal(out.ok, true, JSON.stringify(out));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- 配对 ----------

test('配对：码只能用一次（第二次直接失效）', async () => {
  await withStore(async ({ auth }) => {
    const pairing = auth.createPairing({ name: '手机 A' });
    const first = await auth.claimPairing(pairing.code, { password: PASSWORD });
    assert.ok(first.token);
    const second = await auth.claimPairing(pairing.code, { password: PASSWORD });
    assert.match(second.error, /无效或已过期/);
  });
});

test('配对：过期码被拒（5 分钟）', async () => {
  await withStore(async ({ auth, clock }) => {
    const pairing = auth.createPairing({ name: '手机 A' });
    clock.advance(5 * 60 * 1000 + 1);
    const claimed = await auth.claimPairing(pairing.code, { password: PASSWORD });
    assert.match(claimed.error, /无效或已过期/);
  });
});

test('配对：同一时间只允许一个待批准申请（决策 #12）', async () => {
  await withStore(async ({ auth }) => {
    assert.ok(auth.createPairing({ name: 'A' }).code);
    const second = auth.createPairing({ name: 'B' });
    assert.match(second.error, /已有待批准的配对申请/);
  });
});

test('配对：提交后是「待批准」，批准前无法登录（决策 #11/#12）', async () => {
  await withStore(async ({ auth }) => {
    const pairing = auth.createPairing({ name: 'A' });
    const claimed = await auth.claimPairing(pairing.code, { password: PASSWORD });
    assert.equal(claimed.device.pending, true);
    assert.equal(claimed.device.approved, false);

    const before = await auth.authenticate({ token: claimed.token, password: PASSWORD });
    assert.equal(before.ok, false);
    assert.equal(before.reason, 'not-approved');

    auth.approve(claimed.device.id);
    const after = await auth.authenticate({ token: claimed.token, password: PASSWORD });
    assert.equal(after.ok, true, JSON.stringify(after));
  });
});

test('配对：提交时校验密码强度，弱密码不建记录', async () => {
  await withStore(async ({ auth }) => {
    const pairing = auth.createPairing({ name: 'A' });
    const bad = await auth.claimPairing(pairing.code, { password: '123' });
    assert.match(bad.error, /至少/);
    assert.equal(auth.list().length, 0, '弱密码不该留下设备记录');
    // 码已焚毁：不能拿它重试
    const retry = await auth.claimPairing(pairing.code, { password: PASSWORD });
    assert.match(retry.error, /无效或已过期/);
  });
});

test('配对：拒绝待批准设备（不留记录）', async () => {
  await withStore(async ({ auth }) => {
    const pairing = auth.createPairing({ name: 'A' });
    const claimed = await auth.claimPairing(pairing.code, { password: PASSWORD });
    assert.equal(auth.pending().length, 1);
    assert.equal(auth.reject(claimed.device.id), true);
    assert.equal(auth.pending().length, 0);
    assert.equal(auth.list().length, 0);
  });
});

// ---------- 凭据与存储 ----------

test('存储：token 永不落盘，只存 SHA-256（沿用 devices.js 约定）', async () => {
  await withStore(async ({ auth, path }) => {
    const { token } = await pairedDevice(auth);
    const raw = readFileSync(path, 'utf8');
    assert.equal(raw.includes(token), false, 'token 原文被写进了磁盘');
    assert.ok(raw.includes(digest(token)), '应当存下 token 的 sha256');
    // 密码也不能明文落盘
    assert.equal(raw.includes(PASSWORD), false, '设备密码明文被写进了磁盘');
  });
});

test('存储：状态文件权限 0600（POSIX；Windows 上跳过断言）', async () => {
  await withStore(async ({ auth, path }) => {
    await pairedDevice(auth);
    assert.ok(existsSync(path));
    if (process.platform !== 'win32') {
      assert.equal(statSync(path).mode & 0o777, 0o600);
    }
  });
});

test('存储：重启（重新加载）后设备仍可用，凭据依然有效', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshp-dev-'));
  const path = join(dir, 'devices.json');
  try {
    const a = createDeviceAuth({ path, scryptParams: FAST });
    const { token, deviceId } = await pairedDevice(a);

    const b = createDeviceAuth({ path, scryptParams: FAST });
    assert.equal(b.list().length, 1);
    assert.equal(b.list()[0].id, deviceId);
    const out = await b.authenticate({ token, password: PASSWORD });
    assert.equal(out.ok, true, JSON.stringify(out));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('存储：损坏的状态文件按「没有设备」处理，不抛错', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshp-dev-'));
  const path = join(dir, 'devices.json');
  try {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, '{ this is not json', 'utf8');
    const auth = createDeviceAuth({ path, scryptParams: FAST });
    assert.equal(auth.list().length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('列表：对外视图不含任何哈希字段', async () => {
  await withStore(async ({ auth }) => {
    await pairedDevice(auth);
    const row = auth.list()[0];
    assert.equal('tokenHash' in row, false);
    assert.equal('password' in row, false);
    assert.deepEqual(Object.keys(row).sort(), [
      'approved', 'createdAt', 'failures', 'id', 'lastLoginAt', 'lockedUntil', 'name', 'pending',
    ]);
  });
});

// ---------- 双条件认证 ----------

test('认证：凭据与密码必须同时成立（决策 #11）', async () => {
  await withStore(async ({ auth }) => {
    const { token } = await pairedDevice(auth);

    // 只有密码、没凭据 → 拒（未配对浏览器即使知道密码也进不来）
    const noCred = await auth.authenticate({ password: PASSWORD });
    assert.equal(noCred.ok, false);
    assert.equal(noCred.reason, 'no-credential');

    // 只有凭据、密码错 → 拒
    const badPw = await auth.authenticate({ token, password: 'wrong-password' });
    assert.equal(badPw.ok, false);
    assert.equal(badPw.reason, 'bad-password');

    // 两者都对 → 通过
    const ok = await auth.authenticate({ token, password: PASSWORD });
    assert.equal(ok.ok, true);
    assert.ok(ok.sessionId);
  });
});

test('认证：成功后凭据轮换，旧 token 立即失效', async () => {
  await withStore(async ({ auth }) => {
    const { token } = await pairedDevice(auth);
    const first = await auth.authenticate({ token, password: PASSWORD });
    assert.equal(first.ok, true);
    assert.notEqual(first.token, token, 'token 应当轮换');

    const replay = await auth.authenticate({ token, password: PASSWORD });
    assert.equal(replay.ok, false);
    assert.equal(replay.reason, 'no-credential', '旧 token 不该还能用');

    const withNew = await auth.authenticate({ token: first.token, password: PASSWORD });
    assert.equal(withNew.ok, true);
  });
});

test('认证：伪造/随机 token 一律拒', async () => {
  await withStore(async ({ auth }) => {
    await pairedDevice(auth);
    const out = await auth.authenticate({ token: 'x'.repeat(43), password: PASSWORD });
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'no-credential');
  });
});

// ---------- 渐进锁定 ----------

test('锁定：第 5/10/15/20 次连续失败分别锁 5 分钟/15 分钟/45 分钟/24 小时', async () => {
  await withStore(async ({ auth, clock }) => {
    const { token } = await pairedDevice(auth);

    // 语义说明（实现取「阶梯」而非「仅在整数次锁」）：
    // 一旦失败数达到某一档，之后的**每一次**失败都会按当前档重新锁定。
    // 于是攻击者熬过 5 分钟锁只能换来一次尝试，随即又被锁 5 分钟；
    // 若只在第 5/10/15/20 次锁，他每轮能白嫖 4 次尝试，明显更弱。
    const tierFor = (failures) => {
      let tier = null;
      for (const step of LOCKOUT_STEPS) if (failures >= step.failures) tier = step;
      return tier;
    };

    for (let i = 1; i <= 20; i++) {
      const out = await auth.authenticate({ token, password: 'wrong' });
      assert.equal(out.ok, false);

      const tier = tierFor(i);
      const expected = tier ? Math.ceil(tier.lockMs / 1000) : 0;
      assert.equal(out.retryAfter, expected, `第 ${i} 次失败的锁定时长不对（期望 ${expected}s）`);
      assert.equal(out.failures, i, `失败计数应为 ${i}`);

      if (tier) {
        // 锁定期内不做密码比对：连正确密码也直接拒（否则锁定窗口就是免费穷举窗口）
        const locked = await auth.authenticate({ token, password: PASSWORD });
        assert.equal(locked.ok, false);
        assert.equal(locked.reason, 'locked', `第 ${i} 次失败后的锁定期内应直接拒`);
        clock.advance(tier.lockMs + 1);
      }
    }
  });
});

test('锁定：成功登录清零计数（不会累积到高阶梯）', async () => {
  await withStore(async ({ auth }) => {
    const { token } = await pairedDevice(auth);
    for (let i = 0; i < 4; i++) await auth.authenticate({ token, password: 'wrong' });

    const ok = await auth.authenticate({ token, password: PASSWORD });
    assert.equal(ok.ok, true);

    // 计数已清零：再来 4 次不该锁
    const rotated = ok.token;
    for (let i = 0; i < 4; i++) {
      const out = await auth.authenticate({ token: rotated, password: 'wrong' });
      assert.equal(out.retryAfter, 0, `清零后第 ${i + 1} 次失败不该锁定`);
    }
  });
});

// ---------- 会话 ----------

test('会话：空闲超过 10 分钟后失效，活动可续期', async () => {
  await withStore(async ({ auth, clock }) => {
    const { token } = await pairedDevice(auth);
    const login = await auth.authenticate({ token, password: PASSWORD });
    const sid = login.sessionId;

    assert.ok(auth.validateSession(sid));

    // 未到空闲上限：仍然有效
    clock.advance(SESSION_IDLE_MS - 1000);
    assert.ok(auth.validateSession(sid), '未超时就不该失效');

    // 活动续期后再等一个窗口，仍然有效（证明续期真的生效）
    assert.equal(auth.touchSession(sid), true);
    clock.advance(SESSION_IDLE_MS - 1000);
    assert.ok(auth.validateSession(sid), 'touch 应当续期');

    // 完全不活动 → 过期
    clock.advance(SESSION_IDLE_MS + 1);
    assert.equal(auth.validateSession(sid), null, '空闲超时后应失效');
  });
});

test('会话：续期必须基于真实操作——过期会话 touch 不复活', async () => {
  await withStore(async ({ auth, clock }) => {
    const { token } = await pairedDevice(auth);
    const { sessionId } = await auth.authenticate({ token, password: PASSWORD });
    clock.advance(SESSION_IDLE_MS + 1);
    assert.equal(auth.touchSession(sessionId), false, '过期会话不该被 touch 救活');
  });
});

test('会话：登出后立即失效', async () => {
  await withStore(async ({ auth }) => {
    const { token } = await pairedDevice(auth);
    const { sessionId } = await auth.authenticate({ token, password: PASSWORD });
    assert.equal(auth.dropSession(sessionId), true);
    assert.equal(auth.validateSession(sessionId), null);
  });
});

// ---------- 撤销 ----------

test('撤销：设备记录与已开会话立即失效，旧凭据立即作废', async () => {
  await withStore(async ({ auth }) => {
    const { token, deviceId } = await pairedDevice(auth);
    const { sessionId, token: rotated } = await auth.authenticate({ token, password: PASSWORD });
    assert.ok(auth.validateSession(sessionId));

    assert.equal(auth.revoke(deviceId), true);

    assert.equal(auth.validateSession(sessionId), null, '撤销后会话必须立刻失效');
    assert.equal(auth.list().length, 0);
    const out = await auth.authenticate({ token: rotated, password: PASSWORD });
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'no-credential', '撤销后旧凭据必须作废');
  });
});

test('撤销：只影响目标设备，其它设备照常', async () => {
  await withStore(async ({ auth }) => {
    const a = await pairedDevice(auth, { name: 'A' });
    const b = await pairedDevice(auth, { name: 'B' });
    assert.equal(auth.list().length, 2);

    auth.revoke(a.deviceId);
    assert.equal(auth.list().length, 1);
    assert.equal(auth.list()[0].id, b.deviceId);
    const out = await auth.authenticate({ token: b.token, password: PASSWORD });
    assert.equal(out.ok, true, '不该误伤另一台设备');
  });
});

// ---------- 状态 ----------

test('status：计数与 reset 清空', async () => {
  await withStore(async ({ auth, path }) => {
    const { token } = await pairedDevice(auth);
    await auth.authenticate({ token, password: PASSWORD });
    const s = auth.status();
    assert.equal(s.devices, 1);
    assert.equal(s.pending, 0);
    assert.equal(s.sessions, 1);

    auth.reset();
    assert.equal(auth.list().length, 0);
    assert.equal(existsSync(path), false, 'reset 应删掉状态文件');
  });
});
