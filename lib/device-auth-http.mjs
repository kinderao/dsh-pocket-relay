// dsh-pocket 设备认证的 HTTP 层（relay 通道专用）
//
// lib/device-auth.mjs 只管存储与密码学；本模块把它的判定翻译成 HTTP：
// 登录页、配对页、Cookie、会话续期端点，以及「已认证才放行」这道闸门。
//
// 闸门的位置很关键：它在 **lib/proxy.mjs 转发之前**，并且对该 host 上的
// **所有**请求生效（不只是 `/`——`/api/*`、WebSocket、`/dsh-pocket/*` 一并覆盖）。
// 否则设备认证就只是首页的一块门帘：拿到真实域名的攻击者绕开首页直接打
// `/api/...` 就进去了。

/** 长期设备凭据 cookie（值 = 设备 token；每次登录都会轮换）。 */export const DEVICE_COOKIE = 'dshp_device';
/** 短会话 cookie（值 = 会话 id）。 */
export const SESSION_COOKIE = 'dshp_session';

/** 登录/配对 POST body 上限。 */
const BODY_MAX = 8 * 1024;

/** 真实用户活动的上报节流：15 秒内最多记一次（决策 #8 的实现细节）。 */
export const ACTIVITY_THROTTLE_MS = 15_000;

/** 默认长期凭据 cookie 有效期（1 年）——设备的「长期」由它体现。 */
const DEVICE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function pathnameOf(reqUrl) {
  try {
    return new URL(reqUrl ?? '/', 'http://dsh.invalid').pathname;
  } catch {
    return String(reqUrl ?? '/').split('?')[0];
  }
}

/** 浏览器导航请求（要登录页）还是 API/WS（要 401）。与 proxy.mjs 同款判据。 */
function isHtmlRequest(req) {
  if (String(req.headers?.accept ?? '').includes('text/html')) return true;
  const pathname = pathnameOf(req.url);
  return pathname === '/' || /\.html?$/i.test(pathname);
}

function pageShell(title, body) {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH Pocket · ${title}</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px 24px;max-width:340px;width:calc(100% - 48px);text-align:center}
h1{font-size:16px;margin:0 0 6px;color:#111827}
p{font-size:13px;color:#6b7280;margin:0 0 14px;line-height:1.7}
input{width:100%;box-sizing:border-box;padding:10px 12px;font-size:15px;border:1px solid #d1d5db;border-radius:8px;outline:none;margin-bottom:10px}
input:focus{border-color:#4f6ef7}
button{width:100%;padding:10px;font-size:15px;background:#4f6ef7;color:#fff;border:none;border-radius:8px;cursor:pointer}
.err{color:#dc2626;font-size:12px;margin-bottom:10px;min-height:16px}
code{background:#f3f4f6;padding:2px 6px;border-radius:6px;font-size:12px;color:#374151;word-break:break-all}
</style></head><body><div class="card">${body}</div></body></html>`;
}

/**
 * 设备活动上报脚本（注入到 app HTML）。
 *
 * **只**监听真实用户输入事件；刻意不含 setInterval / visibilitychange / 心跳——
 * 那类信号会让「页面开着不动」也算活动，10 分钟空闲超时等于不存在（决策 #8）。
 */
export function activityScript(throttleMs = ACTIVITY_THROTTLE_MS) {
  return `<script data-dsh-pocket-activity="1">!function(){try{var last=0;function report(){var n=Date.now();if(n-last<${throttleMs})return;last=n;try{fetch('/pocket-auth/activity',{method:'POST',credentials:'same-origin',keepalive:true}).catch(function(){});}catch(e){}}['pointerdown','keydown','touchstart'].forEach(function(ev){document.addEventListener(ev,report,{capture:true,passive:true});});}catch(e){}}();</script>`;
}

/**
 * 创建设备认证网关。
 *
 * @param {object} opts
 * @param {object} opts.auth          createDeviceAuth() 实例
 * @param {(host: string) => boolean} opts.isDeviceHost 该 host 是否属于设备认证通道
 * @param {string} [opts.publicUrl]   对外访问地址（决定 cookie 是否带 Secure）
 * @param {object} [opts.log]
 */
export function createDeviceAuthGateway({ auth, isDeviceHost, publicUrl = '', log = console, sessionIdleMs = 10 * 60 * 1000 } = {}) {
  // publicUrl 允许传函数：用户可能中途把对外地址从 http 改成 https，
  // Secure 标志必须跟着变，不能停在网关创建那一刻的快照上。
  const secureNow = () => /^https:/i.test(String(typeof publicUrl === 'function' ? publicUrl() : publicUrl));
  const logWarn = (...a) => (log.warn ?? log.log).call(log, ...a);

  function cookieAttrs(maxAge) {
    return `HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secureNow() ? '; Secure' : ''}`;
  }

  function setCookies(res, cookies) {
    if (cookies.length > 0) res.setHeader('set-cookie', cookies);
  }

  function deviceCookie(token) {
    return `${DEVICE_COOKIE}=${token}; ${cookieAttrs(DEVICE_COOKIE_MAX_AGE)}`;
  }

  function sessionCookie(sid) {
    return `${SESSION_COOKIE}=${sid}; ${cookieAttrs(Math.floor(sessionIdleMs / 1000))}`;
  }

  function clearCookies() {
    return [
      `${DEVICE_COOKIE}=; ${cookieAttrs(0)}`,
      `${SESSION_COOKIE}=; ${cookieAttrs(0)}`,
    ];
  }

  function sendHtml(res, status, html) {
    const buf = Buffer.from(html, 'utf8');
    res.writeHead(status, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(buf.length),
      'cache-control': 'no-store',
    });
    res.end(buf);
  }

  function sendJson(res, status, obj, extraHeaders = {}) {
    const buf = Buffer.from(JSON.stringify(obj), 'utf8');
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(buf.length),
      'cache-control': 'no-store',
      ...extraHeaders,
    });
    res.end(buf);
  }

  /** 读取表单 body（urlencoded 或 JSON）。超限直接截断返回空对象。 */
  function readBody(req) {
    return new Promise((resolve) => {
      let raw = '';
      let tooBig = false;
      req.on('data', (c) => {
        if (tooBig) return;
        raw += c;
        if (raw.length > BODY_MAX) { tooBig = true; raw = ''; }
      });
      req.on('end', () => {
        if (tooBig) return resolve({});
        const ct = String(req.headers['content-type'] ?? '');
        try {
          if (ct.includes('application/json')) return resolve(JSON.parse(raw || '{}'));
          const out = {};
          for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
          return resolve(out);
        } catch {
          return resolve({});
        }
      });
      req.on('error', () => resolve({}));
    });
  }

  // ---------- 页面 ----------

  function loginPage(error = '', retryAfter = 0) {
    const err = retryAfter > 0
      ? `尝试次数过多，请 ${retryAfter} 秒后再试 | Too many attempts — retry in ${retryAfter}s`
      : error;
    return pageShell('设备验证', `
<h1>🔐 DSH Pocket</h1>
<p>此设备已配对，请输入<b>本设备的密码</b>。</p>
<div class="err">${err}</div>
<form method="post" action="/pocket-auth/login">
<input name="password" type="password" autocomplete="current-password" autofocus required placeholder="设备密码">
<button type="submit">进入 | Enter</button>
</form>
<p style="margin-top:14px;font-size:12px;color:#9ca3af">会话在 10 分钟无操作后失效，需要重新输入。</p>`);
  }

  function unpairedPage() {
    return pageShell('此设备尚未配对', `
<h1>📵 此设备尚未配对</h1>
<p>中继通道使用<b>设备认证</b>：每台设备有自己的密码，可单独撤销。</p>
<p>请回到电脑上打开 <b>设置 → 手机访问 → 中继</b>，点「添加设备」生成配对二维码，再用本机扫描。</p>
<p style="font-size:12px;color:#9ca3af">直接访问本地址是无法登录的——这是有意设计。</p>`);
  }

  function pairingPage(code, error = '') {
    return pageShell('配对这台设备', `
<h1>📱 配对这台设备</h1>
<p>设置一个<b>本设备专用</b>的密码（至少 8 位）。提交后需在电脑上批准。</p>
<div class="err">${error}</div>
<form method="post" action="/pocket-pair">
<input type="hidden" name="code" value="${String(code).replace(/[^A-Za-z0-9_-]/g, '')}">
<input name="name" type="text" maxlength="80" placeholder="设备名称（如 我的 iPhone）" autofocus>
<input name="password" type="password" minlength="8" autocomplete="new-password" required placeholder="设备密码（≥8 位）">
<input name="confirm" type="password" minlength="8" autocomplete="new-password" required placeholder="再输一次">
<button type="submit">提交配对 | Pair</button>
</form>`);
  }

  function pendingPage(name) {
    return pageShell('等待电脑批准', `
<h1>⏳ 等待电脑批准</h1>
<p>设备「${String(name).replace(/[<>&]/g, '')}」已提交。</p>
<p>请到电脑上 <b>设置 → 手机访问 → 中继 → 待批准设备</b> 点「批准」。</p>
<p style="font-size:12px;color:#9ca3af">批准后刷新本页，输入刚才设置的设备密码即可进入。</p>`);
  }

  function errorPage(title, detail) {
    return pageShell(title, `<h1>⚠️ ${title}</h1><p>${detail}</p>`);
  }

  // ---------- 闸门 ----------

  /**
   * 判断一条请求是否已经过设备认证。
   * @returns {object|null} 有效会话对应的设备视图
   */
  function sessionOf(req) {
    const cookies = parseCookies(req.headers?.cookie);
    const sid = cookies[SESSION_COOKIE];
    if (!sid) return null;
    return auth.validateSession(sid);
  }

  return {
    handles(host) {
      return isDeviceHost ? isDeviceHost(host) === true : false;
    },

    /** 供 WebSocket upgrade 复用：只有带有效会话才放行（否则拒绝握手）。 */
    authorizeUpgrade(req) {
      return sessionOf(req) !== null;
    },

    /** 给 app HTML 追加活动上报脚本（仅本通道注入）。 */
    activityScript: () => activityScript(),

    /**
     * 处理一条设备通道上的请求。
     * @returns {Promise<'continue'|'handled'>} continue = 已认证，交给代理转发
     */
    async gate(req, res) {
      const pathname = pathnameOf(req.url);
      const cookies = parseCookies(req.headers.cookie);
      const method = String(req.method ?? 'GET').toUpperCase();

      // ---- 活动上报：只有真实操作会打到这里（脚本只监听输入事件） ----
      if (pathname === '/pocket-auth/activity') {
        const ok = auth.touchSession(cookies[SESSION_COOKIE]);
        res.writeHead(ok ? 204 : 401, { 'cache-control': 'no-store' });
        res.end();
        return 'handled';
      }

      // ---- 登出 ----
      if (pathname === '/pocket-auth/logout') {
        auth.dropSession(cookies[SESSION_COOKIE]);
        setCookies(res, clearCookies());
        res.writeHead(303, { location: '/', 'cache-control': 'no-store' });
        res.end();
        return 'handled';
      }

      // ---- 配对提交 ----
      if (pathname === '/pocket-pair' && method === 'POST') {
        const body = await readBody(req);
        if (String(body.password ?? '') !== String(body.confirm ?? '')) {
          sendHtml(res, 400, pairingPage(body.code, '两次输入的密码不一致 | passwords do not match'));
          return 'handled';
        }
        const result = await auth.claimPairing(String(body.code ?? ''), {
          name: body.name,
          password: body.password,
        });
        if (result.error) {
          sendHtml(res, 400, pairingPage(body.code, result.error));
          return 'handled';
        }
        // 凭据此刻即下发（批准只是入册；批准前 authenticate 会以 not-approved 拒掉）
        setCookies(res, [deviceCookie(result.token)]);
        sendHtml(res, 200, pendingPage(result.device.name));
        return 'handled';
      }

      // ---- 配对页（扫码进来）----
      if (pathname === '/pocket-pair') {
        const code = new URL(req.url ?? '/', 'http://dsh.invalid').searchParams.get('code') ?? '';
        if (!code) {
          sendHtml(res, 400, errorPage('缺少配对码', '请扫描电脑上生成的配对二维码。'));
          return 'handled';
        }
        sendHtml(res, 200, pairingPage(code));
        return 'handled';
      }

      // ---- 设备登录 ----
      if (pathname === '/pocket-auth/login') {
        const token = cookies[DEVICE_COOKIE] ?? '';
        if (method !== 'POST') {
          sendHtml(res, 200, token ? loginPage() : unpairedPage());
          return 'handled';
        }
        // 没有凭据 cookie 就认不出是哪台设备。这里必须说「尚未配对」而不是
        // 「密码错误」——后者会让用户以为是密码打错了，然后一遍遍重试，
        // 而真正的问题是这台浏览器没有配对凭据（决策 #11 的前半条）。
        if (!token) {
          sendHtml(res, 200, unpairedPage());
          return 'handled';
        }
        const body = await readBody(req);
        // 凭据来自 cookie，密码来自表单——两者缺一不可（决策 #11）
        const out = await auth.authenticate({ token, password: String(body.password ?? '') });
        if (!out.ok) {
          logWarn(`dsh-pocket-relay: device login failed (${out.reason}) | 设备登录失败`);
          const retryAfter = out.retryAfter ?? 0;
          sendHtml(res, retryAfter > 0 ? 429 : 200, retryAfter > 0
            ? loginPage('', retryAfter)
            : loginPage('密码错误，请重试 | Wrong password'));
          return 'handled';
        }
        // 登录成功会轮换 token：必须把新的写回 cookie，否则手机会丢凭据
        setCookies(res, [deviceCookie(out.token), sessionCookie(out.sessionId)]);
        res.writeHead(303, { location: '/', 'cache-control': 'no-store' });
        res.end();
        return 'handled';
      }

      // ---- 其余一切：有会话放行，没有就给登录页 / 401 ----
      if (sessionOf(req)) return 'continue';

      if (isHtmlRequest(req)) {
        sendHtml(res, 200, cookies[DEVICE_COOKIE] ? loginPage() : unpairedPage());
      } else {
        sendJson(res, 401, { error: 'device-auth-required' });
      }
      return 'handled';
    },
  };
}
