// dsh-pocket relay 线协议（PC 侧 agent 用）
//
// 服务端已改为 Go 实现（relay/ 目录，见 relay/PROTOCOL.md）。本文件是**协议在
// Node 侧的唯一定义**，与 Go 的 relay/internal/protocol 一一对应；两边都改才算
// 改了协议，权威描述在 relay/PROTOCOL.md。
//
// 之所以不共用一份文件：Go 与 Node 之间不存在共享模块，硬凑共享只会让任一端
// 多一层构建步骤。协议本身很小（3 个帧类型 + 一行 NDJSON + 常量时间比较），
// 复制一份的维护成本远低于引入代码生成的复杂度。

import { timingSafeEqual } from 'node:crypto';

/** 协议版本；两端不一致时 relay 直接拒绝，避免半懂不懂地跑。 */
export const PROTOCOL_VERSION = 1;

/** 控制帧类型。 */
export const T = Object.freeze({
  /** agent → relay：首帧握手 */
  hello: 'hello',
  /** relay → agent：握手通过 */
  welcome: 'welcome',
  /** relay → agent：请为该流开一条数据连接 */
  open: 'open',
  /** 双向：关闭该流 */
  close: 'close',
  /** agent → relay：数据连接首行握手 */
  data: 'data',
  ping: 'ping',
  pong: 'pong',
  /** 任一端：致命错误，随后连接会被关闭 */
  error: 'error',
});

/**
 * 编码一条控制帧。
 * 用 NDJSON 而不是二进制帧：隧道出问题时能在日志/抓包里直接看懂，
 * 而这些帧的吞吐量相比承载的 HTTP 正文可以忽略。
 */
export function encodeControl(obj) {
  return Buffer.from(`${JSON.stringify(obj)}\n`, 'utf8');
}

/**
 * 增量行切分器，用于「首行是 NDJSON 握手、其后是裸字节流」的协议。
 *
 * - `push(chunk)` → 返回本次切出的完整行数组；未成行的尾部留在内部。
 * - `takeRest()`  → 取走未成行的剩余字节。握手行解析完成后调用它，
 *   拿到的就是裸流的开头（**必须**这么做，否则同一 TCP 分片里跟在
 *   `\n` 后面的正文会被静默丢掉）。
 *
 * @param {{ maxLine?: number }} [opts] 单行上限，防对端吐无限长行撑爆内存
 */
export function makeLineSplitter({ maxLine = 64 * 1024 } = {}) {
  let pending = Buffer.alloc(0);
  return {
    push(chunk) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      pending = pending.length === 0 ? buf : Buffer.concat([pending, buf]);
      const lines = [];
      let idx;
      while ((idx = pending.indexOf(0x0a)) >= 0) {
        lines.push(pending.subarray(0, idx).toString('utf8'));
        pending = pending.subarray(idx + 1);
      }
      if (pending.length > maxLine) {
        throw new Error(`relay: handshake line too long | 握手行过长（>${maxLine} 字节）`);
      }
      return lines;
    },
    takeRest() {
      const rest = pending;
      pending = Buffer.alloc(0);
      return rest;
    },
    get buffered() {
      return pending.length;
    },
  };
}

/** 解析一行控制 JSON；非法返回 null，由调用方按协议错误处理。 */
export function parseControl(line) {
  try {
    const value = JSON.parse(String(line));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/**
 * 常量时间比较（长度不同或空值一律判否）。
 * 用 `===` 比 token 会在首个不同字节处提前返回，理论上可被计时侧信道逐字节还原
 * ——与 lib/proxy.mjs 的 safeEqual 同一考量。
 */
export function tokenEquals(a, b) {
  const ba = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
