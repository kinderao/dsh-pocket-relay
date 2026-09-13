// dsh-pocket 设置持久化（$DSH_HOME/dsh-pocket/settings.json）
//
// 当前项：
//   - lanEnabled        局域网访问总开关（默认开启）：关闭后局域网扫码/链接直接失效（代理拒绝局域网 Host）
//   - lanAuthEnabled    局域网访问密码开关（issue #24），默认开启
//   - publicPinCustom   公网密码是否用户自定义（issue #33），自定义后不自动轮换
//   - lanPinCustom      局域网密码是否用户自定义（issue #33）
//   - tunnelMode        公网隧道模式（issue #66）：'quick'（默认，随机 trycloudflare.com）| 'named'（固定域名）
//   - tunnelToken       Cloudflare 命名隧道 Token（issue #66，秘密；文件 0o600，RPC 不回显）
//   - tunnelHostname    命名隧道绑定的固定域名（issue #66，如 pocket.example.com）
//   - proxyPort         代理监听端口（issue #70）
//   - cloudflaredPath   自定义 cloudflared 二进制路径（issue #45）
//   - relay             自建中继配置（{enabled,consent,host,port,tls,allowInsecure,token,publicUrl,agentId}）：
//                       配置好并 enabled 后，插件启动即自动连接——「无人监听」的实现方式
//                       agentId = 本机在 relay 上的名字（多台电脑共存靠它区分，留空按主机名派生）
// 默认**开启**（安全优先）：局域网扫码也要输 8 位密码；
// 用户可关闭——关闭后局域网扫码直连（仅同一网络内的设备能访问），公网不受影响（永远要密码）。

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { isValidIpv4 } from './ip.mjs';
import { isValidAgentId } from './relay.mjs';

const settingsRel = join('dsh-pocket', 'settings.json');
export function settingsPath() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), settingsRel);
}

function readSettings() {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch { /* 无文件/损坏 → 默认 */ }
  return {};
}

function writeSettings(s) {
  try {
    mkdirSync(dirname(settingsPath()), { recursive: true });
    writeFileSync(settingsPath(), JSON.stringify(s, null, 2), { mode: 0o600 });
  } catch { /* 忽略 */ }
  return s;
}

/** 局域网访问总开关：默认开启（文件缺失/损坏都视为开启）。 */
export function lanEnabled() {
  return readSettings().lanEnabled !== false;
}

/** 设置局域网访问总开关，返回新状态（持久化）。 */
export function setLanEnabled(on) {
  const s = readSettings();
  s.lanEnabled = !!on;
  writeSettings(s);
  return s.lanEnabled;
}

/** 局域网访问密码开关：默认开启（文件缺失/损坏都视为开启）。 */
export function lanAuthEnabled() {
  return readSettings().lanAuthEnabled !== false;
}

/** 设置局域网访问密码开关，返回新状态（持久化）。 */
export function setLanAuthEnabled(on) {
  const s = readSettings();
  s.lanAuthEnabled = !!on;
  writeSettings(s);
  return s.lanAuthEnabled;
}

/** 局域网地址手动覆盖：默认空字符串 = 自动选择。 */
export function lanIpOverride() {
  return readSettings().lanIpOverride ?? '';
}

/** 设置局域网地址覆盖；空字符串清除覆盖，恢复自动选择。非法 IPv4 抛错。 */
export function setLanIpOverride(value) {
  const ip = String(value ?? '').trim();
  if (ip && !isValidIpv4(ip)) {
    throw new Error('局域网地址必须是 IPv4 地址 | LAN address must be an IPv4 address');
  }
  const s = readSettings();
  if (ip) s.lanIpOverride = ip;
  else delete s.lanIpOverride;
  writeSettings(s);
  return ip;
}

// ---------- 访问密码「自定义」标记（issue #33） ----------
// 用户可把公网/局域网密码设成自己固定的 8 位密码（英文字母大小写或数字；自定义后不再自动轮换）。
// 标记存 settings.json：publicPinCustom / lanPinCustom。
const PIN_CUSTOM_KEYS = { public: 'publicPinCustom', lan: 'lanPinCustom' };

/** 该 PIN（public | lan）是否用户自定义过（自定义后不自动轮换）。 */
export function pinCustom(which) {
  const key = PIN_CUSTOM_KEYS[which];
  if (!key) return false;
  return readSettings()[key] === true;
}

/** 设置自定义标记，返回新状态。 */
export function setPinCustom(which, on) {
  const key = PIN_CUSTOM_KEYS[which];
  if (!key) return false;
  const s = readSettings();
  s[key] = !!on;
  writeSettings(s);
  return !!on;
}

// ---------- 恢复出厂设置 ----------
// 设置出问题时的临时兜底：删掉 settings.json 即回到出厂默认（文件缺失 = 默认开启，
// 于是局域网访问开、访问密码开、局域网地址自动、公网模式随机）。DSH 自身的会话、
// 模型、插件配置都在 $DSH_HOME 的其他目录，不受影响。

/** 删除本机设置文件（不存在也算成功）；返回 true 表示已清空。 */
export function resetSettings() {
  try {
    rmSync(settingsPath(), { force: true });
    return true;
  } catch {
    return false;
  }
}

// ---------- 命名隧道配置（issue #66：固定公网域名） ----------
// 用户在 Cloudflare Zero Trust（Networks → Tunnels）创建命名隧道并复制 Tunnel Token，
// 把自己域名的 ingress Service 指向 http://127.0.0.1:<代理端口>；填到这里后，
// 开启公网改用 `cloudflared tunnel run`，公网地址固定为该域名（重启不再变化）。
// token 是长期凭据：只存本机 0o600 文件，RPC 只写不读（回显仅 tokenSet 布尔值）。

/** 隧道模式：'quick'（默认，随机地址）| 'named'（固定域名）。 */
export function tunnelMode() {
  return readSettings().tunnelMode === 'named' ? 'named' : 'quick';
}

/** 设置隧道模式（持久化）；非法值抛错。 */
export function setTunnelMode(mode) {
  if (mode !== 'quick' && mode !== 'named') {
    throw new Error('隧道模式必须是 quick 或 named | tunnel mode must be quick or named');
  }
  const s = readSettings();
  if (mode === 'quick') delete s.tunnelMode;
  else s.tunnelMode = mode;
  writeSettings(s);
  return mode;
}

/** 命名隧道 Token（未配置返回空字符串）。 */
export function tunnelToken() {
  const v = readSettings().tunnelToken;
  return typeof v === 'string' ? v : '';
}

/**
 * 设置命名隧道 Token（持久化）。空字符串清除；非空要求至少 20 个
 * base64url 字符（Cloudflare Token 是长 base64 串，过短/含空白视为无效）。
 */
export function setTunnelToken(value) {
  const v = String(value ?? '').trim();
  if (v) {
    if (v.length < 20 || !/^[A-Za-z0-9+/_=-]+$/.test(v)) {
      throw new Error('Tunnel Token 格式不对（应为 Cloudflare 后台复制的完整 Token） | invalid tunnel token');
    }
  }
  const s = readSettings();
  if (v) s.tunnelToken = v;
  else delete s.tunnelToken;
  writeSettings(s);
  return v;
}

/** 命名隧道绑定的固定域名（未配置返回空字符串）。 */
export function tunnelHostname() {
  const v = readSettings().tunnelHostname;
  return typeof v === 'string' ? v : '';
}

/**
 * 设置固定域名（持久化）。接受 `https://host/path` 粘贴并归一化为裸域名；
 * 空字符串清除。要求是带点的合法公网域名（局域网主机名/裸 IP 不允许——
 * 那不该走公网密码边界之外的东西）。
 */
export function setTunnelHostname(value) {
  let v = String(value ?? '').trim().toLowerCase();
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#\s]/)[0].replace(/:\d+$/, '').replace(/\.$/, '');
  if (v) {
    const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
    const IS_IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
    if (IS_IPV4.test(v) || !v.includes('.') || !HOSTNAME_RE.test(v)) {
      throw new Error('固定域名格式不对（如 pocket.example.com） | invalid tunnel hostname');
    }
  }
  const s = readSettings();
  if (v) s.tunnelHostname = v;
  else delete s.tunnelHostname;
  writeSettings(s);
  return v;
}

// ---------- 代理端口（issue #70） ----------
// 局域网代理的监听端口（默认 3081）。插件模式下唯一改法就是写 settings.json 的
// proxyPort 字段（CLI 模式可用 dsh-pocket --port）。允许范围 1-65535；
// 端口已被占用时 dsh web 启动会直接抛 EADDRINUSE（保持原行为），不必在 setter 校验。
/** 当前代理端口（0 = 用默认 3081）。 */
export function proxyPort() {
  const v = Number(readSettings().proxyPort);
  return Number.isInteger(v) && v >= 1 && v <= 65535 ? v : 0;
}

/** 设置代理端口（持久化）。空/0/非法值清除，回退默认 3081。 */
export function setProxyPort(value) {
  const n = Number(value);
  const s = readSettings();
  if (Number.isInteger(n) && n >= 1 && n <= 65535) s.proxyPort = n;
  else delete s.proxyPort;
  writeSettings(s);
  return proxyPort();
}

// ---------- cloudflared 路径（issue #45：远程 Linux 服务器下载源不可达时手动指定） ----------
// Linux 服务器在国内/部分企业网下，所有 CDN 源（GitHub / ghproxy / gh.ddlc / gh-proxy）
// 都连不上时，下载 cloudflared 二进制始终失败。允许用户在 settings.json 里**写死
// 一个已经存在 / 自己上传的 cloudflared 路径**，跳过下载。`lib/tunnel.mjs` 的
// `resolveCloudflared` 启动时会优先读 `process.env.DSH_POCKET_CLOUDFLARED`，
// 找不到再回退到 PATH 探测和下载。`lib/index.js` 在插件 apply 时把 settings
// 的这个值写入 env，确保 service 走自定义路径。
// 空字符串 = 清除，回退到默认行为（PATH 探测 + 下载）。
/** 当前 cloudflared 自定义路径（空 = 用默认）。 */
export function cloudflaredPath() {
  return readSettings().cloudflaredPath ?? '';
}

/** 设置 cloudflared 自定义路径。空字符串清除（回退到 PATH 探测 + 下载）。 */
export function setCloudflaredPath(value) {
  const v = String(value ?? '').trim();
  const s = readSettings();
  if (v) s.cloudflaredPath = v;
  else delete s.cloudflaredPath;
  writeSettings(s);
  return v;
}

// ---------- 中继（自建 relay 服务器） ----------
// 替代 cloudflared 的传输层：电脑出站长连接到你自己的服务器，手机也连服务器。
// 全部字段收在一个 relay 对象里，避免 settings.json 顶层被十几个 relayXxx 键淹没。
//
// enabled 默认 **false**：中继要先配置（填地址+token）才谈得上常开。
// 一旦配置好并 enabled，插件 apply 时就自动拉起——这就是「无人监听」的实现方式。
// consent 是**一次性**知情同意：保存配置时勾一次即可，之后不再每次弹框
// （这是相对 cloudflared「每次开启都弹免责」的有意放宽，见 README 安全说明）。

/** 中继配置（未配置的字段返回空值，不抛错）。 */
export function relayConfig() {
  const s = readSettings();
  const r = s.relay && typeof s.relay === 'object' ? s.relay : {};
  return {
    enabled: r.enabled === true,
    consent: r.consent === true,
    host: typeof r.host === 'string' ? r.host : '',
    port: Number.isInteger(r.port) && r.port >= 1 && r.port <= 65535 ? r.port : 0,
    tls: r.tls === true,
    allowInsecure: r.allowInsecure === true,
    token: typeof r.token === 'string' ? r.token : '',
    publicUrl: typeof r.publicUrl === 'string' ? r.publicUrl : '',
    // agentId 留空 = 由 relay.mjs 按主机名派生（多台电脑各自不同，天然不冲突）
    agentId: typeof r.agentId === 'string' ? r.agentId : '',
  };
}

/** 中继是否已配置完整（地址 + 端口 + token 齐了）。 */
export function relayConfigured(cfg = relayConfig()) {
  return Boolean(cfg.host && cfg.port && cfg.token);
}

/** 规范化一个 relay 服务地址：容忍粘贴 `https://host:port/path`，只留裸主机名。 */
function normalizeRelayHost(value) {
  let v = String(value ?? '').trim();
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#\s]/)[0];
  v = v.replace(/:\d+$/, '');        // 端口单独有字段，这里不该再带
  return v.replace(/\.$/, '').toLowerCase();
}

/**
 * 规范化对外访问地址（二维码/链接用的那个 https://…）。
 * 只接受 http(s) 形式并补全 scheme——手机扫的必须是完整 URL。
 */
function normalizePublicUrl(value) {
  let v = String(value ?? '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  let u;
  try {
    u = new URL(v);
  } catch {
    throw new Error('对外访问地址格式不对（如 https://pocket.example.com） | invalid public URL');
  }
  // 去掉路径/查询，只留 origin：路径前缀 relay 不支持（见 PROTOCOL.md）
  return u.origin;
}

/**
 * 更新中继配置（增量 patch）。返回更新后的完整配置。
 *
 * 校验原则：**宁可在这里报错，也不要写进去然后连不上**。
 * token 长度与 relay 服务端的 MIN_TOKEN_LENGTH 保持一致，早报错比
 * 「服务端拒绝、界面只说连不上」好排查得多。
 */
export function setRelayConfig(patch = {}) {
  const s = readSettings();
  const cur = { ...(s.relay ?? {}) };
  const p = patch && typeof patch === 'object' ? patch : {};

  if (p.host !== undefined) {
    const host = normalizeRelayHost(p.host);
    if (host) cur.host = host;
    else delete cur.host;
  }
  if (p.port !== undefined) {
    if (p.port === '' || p.port === null || p.port === 0) {
      delete cur.port;
    } else {
      const n = Number(p.port);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        throw new Error('中继端口非法（应为 1-65535） | invalid relay port');
      }
      cur.port = n;
    }
  }
  if (p.token !== undefined) {
    // 留空 = 保持原值（与隧道 Token 同款语义）：界面不回显 token，
    // 用户没改就不该把已存的 token 抹掉。
    const t = String(p.token ?? '').trim();
    if (t) {
      if (t.length < 24) {
        throw new Error('中继 Token 至少 24 个字符（用 relay/relay.mjs --gen-token 生成） | relay token too short');
      }
      cur.token = t;
    }
  }
  if (p.publicUrl !== undefined) {
    const u = normalizePublicUrl(p.publicUrl);
    if (u) cur.publicUrl = u;
    else delete cur.publicUrl;
  }
  if (p.agentId !== undefined) {
    // 留空 = 清除，回到「按主机名派生」的默认名（与 token 的「留空不改」不同：
    // 这个名字是可读的、不是凭据，清空是有意义的操作，得能表达出来）。
    const id = String(p.agentId ?? '').trim();
    if (!id) {
      delete cur.agentId;
    } else if (!isValidAgentId(id)) {
      throw new Error('本机名称只能包含字母、数字、- _ .，最长 32 个字符 | '
        + 'agent name allows letters, digits, - _ . (max 32)');
    } else {
      cur.agentId = id;
    }
  }
  if (p.tls !== undefined) cur.tls = p.tls === true;
  if (p.allowInsecure !== undefined) cur.allowInsecure = p.allowInsecure === true;
  if (p.consent !== undefined) cur.consent = p.consent === true;

  if (p.enabled !== undefined) {
    const on = p.enabled === true;
    // 开启前必须已经配置完整且勾过知情同意：服务端强制，防绕过界面直接调 RPC
    if (on) {
      const merged = { ...relayConfig(), ...cur };
      if (!merged.host || !merged.port || !merged.token) {
        throw new Error('请先填写中继地址、端口和 Token | fill in the relay address, port and token first');
      }
      if (merged.consent !== true) {
        throw new Error('开启中继前请先阅读并勾选安全声明 | please accept the security notice first');
      }
    }
    cur.enabled = on;
  }

  if (Object.keys(cur).length === 0) delete s.relay;
  else s.relay = cur;
  writeSettings(s);
  return relayConfig();
}

/** 清空中继配置（恢复出厂设置时一并清掉）。 */
export function clearRelayConfig() {
  const s = readSettings();
  delete s.relay;
  writeSettings(s);
  return relayConfig();
}
