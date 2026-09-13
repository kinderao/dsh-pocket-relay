# Release 首次运行失败：诊断与修复

## 现象

GitHub Actions → Release #1：`release` job 27s 后 **Failure**，`relay-binaries` 被跳过（它 `needs: release`）。

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
| 3. `npm publish` | ❌ 失败 | npm 上 `dsh-pocket-relay` 仍然 **404**（包名未被占用） |

于是留下一个**半发布状态**：

- **GitHub 侧**：已有 `v1.0.0` tag 与 release 提交（`package.json` 已写为 `1.0.0`）；
- **npm 侧**：什么都没有；
- **CI 侧**：job 标红。

## 根因：npm 凭据

`semantic-release` 的 npm 插件（`@semantic-release/npm/lib/set-npmrc-auth.js`）**只认环境变量 `NPM_TOKEN`**：

```js
if (NPM_TOKEN) { ... `${nerfDart(registry)}:_authToken = \${NPM_TOKEN}` }
```

workflow 里已经把它传进去了（`NPM_TOKEN: ${{ secrets.NPM_TOKEN }}`），所以失败只可能是：

1. **secret 没建 / 名字不是 `NPM_TOKEN`**（大小写敏感）；
2. **token 类型不对**：发布**新包名**必须用 **Automation** token（Classic 的 Publish token 在新包上可能被 2FA 拦；Granular token 需要显式勾选 *Read and write* 权限并允许 bypass 2FA）；
3. **token 已过期或被 revoke**；
4. token 是从别的账号建的，对该 scope/包名无发布权。

## 修复步骤

### 1) 先把本地与远端对齐（否则会撞 tag）

CI 已经推了 `ed13213`，本地 `main` 落后 1 个提交。不同步的话，本地任何 push 都会与远端分叉。

```powershell
cd D:\code\ai\dsh-pocket-remote
git pull --ff-only origin main
```

### 2) 确认 secret 名称与类型

GitHub 仓库 → **Settings → Secrets and variables → Actions**：

- 必须叫 **`NPM_TOKEN`**（与 workflow 里的 `${{ secrets.NPM_TOKEN }}` 完全一致）；
- 值来自 npm：**Account Settings → Access Tokens → Generate New Token → 选 "Automation"**。
  - ⚠️ 不要选 "Classic → Publish"，也不要只给 Granular 的只读权限——发布**新包**需要 Automation（它绕过 2FA 交互）。

### 3) 确认 npm 账号已完成邮箱验证

未验证邮箱的账号不能发布。登录 npmjs.com 看顶部是否有验证提示。

### 4) 重新发版前先决定「1.0.0 还算不算数」

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

### 5) 修好凭据后重跑

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
| workflow 的 `NPM_TOKEN` 传参 | ✅ 写法正确 |
| `relay-binaries` 被跳过 | ✅ **正确行为**（`needs: release`，前置失败就该跳过） |
| Node 20 deprecated 警告 | ✅ 仅警告，不影响；可后续把 actions 升到 v5 |

> 那个 "Node.js 20 is deprecated ... actions/checkout@v4, actions/setup-node@v4" 是**警告不是错误**，
> GitHub 只是强制它们跑在 Node 24 上。有空可以升级到 `@v5` 消除它。
