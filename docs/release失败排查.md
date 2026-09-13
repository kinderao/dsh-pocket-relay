# Release 首次运行失败：诊断与修复

## 结论（已由 CI 日志确认）

```
npm error code E403
npm error 403 403 Forbidden - PUT https://registry.npmjs.org/dsh-pocket-relay
npm error 403 - You may not perform that action with these credentials.
```

**这是 token 权限问题，不是代码问题，也不是包名被占。**

关键区分：

| 码 | 含义 |
| --- | --- |
| `E401` | 没读到凭据 / 凭据无效 → 属于「secret 没配好」 |
| **`E403`（本次）** | **凭据有效、身份已认证，但这个账号无权做这个动作** |

而且 npm 在「包名已被占用」时会明确说 *You cannot publish over the previously published versions* ——
本次日志里**没有**这句，且 `https://registry.npmjs.org/dsh-pocket-relay` 仍返回 **404**（名字空着）。
所以可以排除「名字被抢」，问题锁定在 token 的权限上。

## 逐步结论（来自 GitHub API，不是猜测）

```
1. Set up job            => success
2. actions/checkout@v4   => success
3. actions/setup-node@v4 => success
4. npm ci                => success
5. npm test              => success   ← 我们的测试在 Linux 上是过的
6. Publish release       => failure   ← 唯一失败的一步
```

**关键事实：`npm test` 在 CI 上是通过的**（Test workflow 的 #3、#4 也都 success）。本地那 2 个失败是
Windows 专有（spawn 无扩展名的 `cloudflared` 脚本 → ENOENT），Linux 上那两个测试文件用
`mode: 0o755` 写 shell 脚本后直接执行，正常通过。所以「本地 npm test 有 2 红」**不是**这次失败的原因。

## 真正发生了什么：一次「半发布」

`Publish release` 这一步跑的是 `semantic-release`，它按顺序做三件事，**在第 3 件上失败了**：

| 阶段 | 结果 | 证据 |
| --- | --- | --- |
| 1. 分析提交、定版本、写 CHANGELOG | ✅ 成功 | 远端多了 `ed13213 chore(release): 1.0.0 [skip ci]`，`CHANGELOG.md` +179 行 |
| 2. 打 tag 并推送 | ✅ 成功 | 远端 `refs/tags/v1.0.0` → `ed13213` |
| 3. `npm publish` | ❌ 失败（E403） | npm 上 `dsh-pocket-relay` 仍然 **404**（包名未被占用） |

于是留下一个**半发布状态**：

- **GitHub 侧**：已有 `v1.0.0` tag 与 release 提交（`package.json` 已写为 `1.0.0`）；
- **npm 侧**：什么都没有；
- **CI 侧**：job 标红。

## 根因：token 的类型 / 权限

`semantic-release` 的 npm 插件（`@semantic-release/npm/lib/set-npmrc-auth.js`）**只认环境变量 `NPM_TOKEN`**：

```js
if (NPM_TOKEN) { ... `${nerfDart(registry)}:_authToken = \${NPM_TOKEN}` }
```

workflow 写法正确、token 也确实被读到了（否则是 E401 而不是 E403）。**403 的成因按概率：**

1. **用了 Granular Access Token，但权限不足** —— npm 的 Granular token 默认**只读**，必须在
   *Permissions → Packages and scopes* 里显式给 **Read and write**，并允许 **bypass 2FA**；
2. **用了 Classic 的 "Publish" token，而账号开了 2FA** —— 首次发布**新包**这种情况会 403；
   正确类型是 **Automation**（专为 CI 设计，绕过 2FA 交互）；
3. token 属于**另一个账号**（对该包名没有发布权）；
4. token 已被 revoke / 过期（虽然通常报 E401）。

### 修复：重新生成一个 Automation token

1. 登录 npmjs.com → 右上头像 → **Account Settings** → **Access Tokens**
2. **Generate New Token** → 选 **Automation**（⚠️ 不要选 Classic 的 Publish，也不要只给 Granular 只读）
3. 复制 token（形如 `npm_xxxxxxxx`，**只显示一次**）
4. GitHub 仓库 → **Settings → Secrets and variables → Actions → Repository secrets**
   → 找到 `NPM_TOKEN` → **Update**（或删掉重建）→ 粘贴新 token
   - ⚠️ 必须在 **Repository secrets**，不能建在 **Environment secrets**：本 workflow 的 job
     **没有声明 `environment:`**，读不到 Environment secret；
   - ⚠️ 名字必须精确是 `NPM_TOKEN`（大小写敏感）。
5. 顺带确认 **npm 账号邮箱已验证**（未验证不能发布）。

## 修复步骤

### 1) 先把本地与远端对齐（否则会撞 tag）

CI 已经推了 `ed13213`，本地 `main` 落后 1 个提交。不同步的话，本地任何 push 都会与远端分叉。

```powershell
cd D:\code\ai\dsh-pocket-remote
git pull --ff-only origin main
```

### 2) 重新生成 token 并更新 secret

见上节。

### 3) 重新发版前先决定「1.0.0 还算不算数」

- **`v1.0.0` tag 已经存在**（指向 `ed13213`），`package.json` 也已是 `1.0.0`。
  semantic-release 以 tag 为「已发布的版本」基准，**重跑不会再次发布 1.0.0**。
- 两种走法：

  **A. 让 1.0.0 就地补发（推荐）**
  重跑 workflow 前，先推一个空提交或任意 `fix:` 提交，让 semantic-release 有「新变更」可算：

  ```powershell
  git commit --allow-empty -m "fix(release): 触发 1.0.0 的 npm 补发"
  git push origin main
  ```

  它会算成 `1.0.1`（因为已有 1.0.0 tag）。想严格停在 1.0.0，就用下面的 B。

  **B. 抹掉这次半发布，重来一遍 1.0.0**

  ```powershell
  # 删除远端与本地 tag（requires 权限）
  git push origin :refs/tags/v1.0.0
  git tag -d v1.0.0
  # 然后重跑 workflow，它会重新算 1.0.0 并发布
  ```

  > 注意：`ed13213` 那个 release 提交已经改了 `package.json` 与 `CHANGELOG.md`，
  > 删 tag 后重跑会再生成一次提交，CHANGELOG 可能出现重复段落——可接受，或手工整理。

### 4) 修好凭据后重跑

```
Actions → Release → Run workflow
```

成功的判据：npm 上出现 `dsh-pocket-relay@1.0.0`（`https://registry.npmjs.org/dsh-pocket-relay` 不再 404），
且 `relay-binaries` job 把三个平台二进制挂到同一个 Release。

---

## 附：本次排查中确认无误的部分（别再怀疑这些）

| 项 | 状态 |
| --- | --- |
| `npm ci` | ✅ CI 通过（本地 `--dry-run` 也通过） |
| `npm test` | ✅ **CI 上通过**；本地 2 红是 Windows 专有问题 |
| lockfile 与 package.json 同步 | ✅ |
| `publishConfig` | ✅ `{access: public, registry: registry.npmjs.org}` |
| workflow 的 `NPM_TOKEN` 传参 | ✅ 写法正确，且 token 确实被读到了（E403 而非 E401） |
| 包名 `dsh-pocket-relay` | ✅ **仍未被占用**（registry 返回 404）→ 不是「名字被抢」 |
| registry 可达 | ✅ `/-/ping` 返回 200 |
| `relay-binaries` 被跳过 | ✅ **正确行为**（`needs: release`，前置失败就该跳过） |
| Node 20 deprecated 警告 | ✅ 仅警告，不影响；可后续把 actions 升到 v5 |

> 那个 "Node.js 20 is deprecated ... actions/checkout@v4, actions/setup-node@v4" 是**警告不是错误**，
> GitHub 只是强制它们跑在 Node 24 上。有空可以升级到 `@v5` 消除它。
