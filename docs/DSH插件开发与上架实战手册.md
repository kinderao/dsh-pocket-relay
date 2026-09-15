# DSH 插件开发与上架 · 实战手册

> 这份文档来自 `dsh-pocket-relay`（基于 `dsh-pocket` 二次开发，自建 Go relay 中继）的
> 一次完整实践：从改包名、发 npm、修 CI、到提 PR 进目录。目标是**下次开发新插件时
> 直接照着走，避开这次踩过的坑**。
>
> 每条「坑」都标注了真实症状，方便你在遇到同样报错时快速对上号。

---

## 目录

- [零、先记住这 5 条](#零先记住这-5-条)
- [一、项目骨架：从零建一个可安装的插件](#一项目骨架从零建一个可安装的插件)
- [二、本地开发与调试](#二本地开发与调试)
- [三、发布到 npm：最容易翻车的一段](#三发布到-npm最容易翻车的一段)
- [四、发 GitHub Release（二进制/预构建产物）](#四发-github-release二进制预构建产物)
- [五、上架到 dsh-market（提 PR 到精选目录）](#五上架到-dsh-market提-pr-到精选目录)
- [六、坑位速查表](#六坑位速查表)
- [七、新插件启动清单](#七新插件启动清单)

---

## 零、先记住这 5 条

如果只读一段，读这段。这次 90% 的返工都源于这五件事之一：

1. **包名（`package.json` 的 `name`）一旦定了就别改。** 它是 DSH 加载插件的解析键，
   改了会让已安装用户的 profile 身份校验失败，客户端**直接起不来**。
2. **npm 首次发布用 Granular token + `All packages` 范围。** 选成 scope（如 `@you`）
   会得到 `E403`，因为无 scope 的包名不在该 scope 授权内。
3. **semantic-release 的「成功」可能是假成功。** CI 全绿但什么都没发，是因为
   自上个 tag 以来没有 `feat`/`fix`/`perf` 提交 —— 它 exit 0 静默退出。
4. **`success` 步骤的报错会连带砍掉下游 job。** 若 `relay-binaries` 之类声明了
   `needs: release`，release job 因收尾报错失败 = 二进制产物全部丢失。
5. **提 PR 到精选目录时，base 必须是上游仓库**，不是你的 fork。GitHub 容易默认填错。

---

## 一、项目骨架：从零建一个可安装的插件

### 1.1 最小可安装结构

```
your-plugin/
├── package.json          # 必须声明 dsh.bundle
├── cordis.patch.yml      # 必须存在，dsh.bundle.patch 指向它
├── lib/index.js          # 宿主侧入口（main 指向它）
├── client/               # 可选：浏览器端 UI（编译产物 + 源码）
└── README.md
```

### 1.2 `package.json` 关键字段

```jsonc
{
  "name": "your-plugin",           // ⚠️ 定了别改，见 §6.1
  "version": "1.0.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "default": "./lib/index.js" },
    "./client": "./client/client.js",
    "./package.json": "./package.json"
  },
  "files": ["lib", "client", "cordis.patch.yml", "README.md", "LICENSE"],

  "dsh": {
    // ⚠️ 必须项。只声明 dsh.client 的插件无法安装，是目录 PR 最常见的被拒原因
    "bundle": { "patch": "./cordis.patch.yml" },
    // 仅当有浏览器端 UI 时才需要
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-connection",
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-ui-layout",
        "@deepseek-ai/dsh-client-locale"
      ],
      "platform": "web"
    }
  },

  // ⚠️ 官方包必须放 peerDependencies，放 dependencies 会在 profile 里产生重复运行时
  "peerDependencies": { "@deepseek-ai/cordis": "^4.0.1" },
  "engines": { "node": ">=22" },

  // npm 与仓库的关联依据（市场靠它显示下载量），必须指回本仓库
  "repository": {
    "type": "git",
    "url": "git+https://github.com/<owner>/<repo>.git"
  },
  "publishConfig": { "access": "public", "registry": "https://registry.npmjs.org/" }
}
```

### 1.3 `cordis.patch.yml` —— `id` 与 `name` 的分工

这是最容易搞混的一处，务必分清：

```yaml
- insert:
    - id: your-plugin-id        # 市场「启用/禁用」开关按它记状态
      name: your-package-name   # loader 按它解析 npm 包名
```

| 字段 | 作用 | 约束 |
|---|---|---|
| `id` | 市场开关、profile 补丁行的身份键 | 可以保持历史值不变（便于老用户状态不失效） |
| `name` | **loader 据此解析 npm 包名** | **必须与 `package.json` 的 `name` 完全一致** |

> **真实事故**：改包名时把 `name` 改成了新包名，但新包名从未安装进 profile，
> 导致 DSH Desktop 启动报
> `profile package identity is invalid for <old-name>`，只能禁用插件才能启动。

### 1.4 peerDependencies 的预发布陷阱

如果插件要支持 harness 的预发布版本（如 `0.1.0-rc.6`），**宽范围写法会静默失效**：

```jsonc
// ❌ 看起来能匹配一切，实际排除了所有 0.1.0-* 预发布版
"peerDependencies": { "@deepseek-ai/dsh-tools": ">=0.0.1-rc.1 <0.2.0" }

// ✅ 显式 || 分支，在对应元组上带预发布标签
"peerDependencies": {
  "@deepseek-ai/dsh-tools": ">=0.0.1-rc.1 <0.1.0 || >=0.1.0-rc.1 <0.2.0-0"
}
```

原因：node-semver 只有当范围里**某个比较符与目标版本的 `major.minor.patch` 元组完全一致、
且自身带预发布标签**时才放行预发布版。症状是用户 `npm install` 时报 `ERESOLVE`。

---

## 二、本地开发与调试

### 2.1 profile 与安装边界

DSH 用 profile 管理插件，路径在 `$DSH_HOME/profiles/<name>/`（通常是
`~/.dsh/profiles/desktop`）。关键文件：

| 文件 | 作用 |
|---|---|
| `package.json` | profile 的依赖清单 + `dsh.profile.bundles` 列表 |
| `cordis.patch.yml` | 你的覆盖层（禁用/插入插件） |
| `node_modules/` | 实际安装的插件（hoisted 普通目录） |
| `.dsh-market/state.json` | 市场的启用/禁用状态 |
| `.dsh-market/log.ndjson` | 市场操作日志（排查安装问题第一现场） |

> **重要**：DSH Desktop 的安装边界只接受 **`name@exact.version` 形式的 registry 包**，
> 不接受 `github:` 源。所以**不发 npm 的插件，在你自己的桌面端装不上**。

### 2.2 不启动服务就验证配置

排查启动类问题时，这个命令极其有用 —— 它只组合 profile 树然后退出：

```powershell
dsh --profile desktop --dump-config
```

- `exit=0` + 无报错 = profile 健康
- 输出里搜插件名，可确认它是否被正确加载/排除
- **对比 `exit code` 是判断改动是否有效的决定性证据**

### 2.3 开发期接入方式

| 方式 | 优点 | 缺点 |
|---|---|---|
| junction 指向源码目录 | 改代码立即生效 | `pnpm install` 可能清掉它 |
| 拷贝进 `node_modules` | 稳定 | 改代码要重新拷贝 |
| **从市场正常安装** | 走正规流程，无身份问题 | 需要先发 npm + 上架 |

**推荐**：开发期用 junction，功能稳定后发 npm 并改为从市场安装。

```powershell
# 建 junction（需管理员权限或开发者模式）
New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\your-plugin" `
         -Target "D:\code\ai\your-plugin"
```

> ⚠️ **改造/改名时要清理旧残留**。若 `node_modules` 里留下一个**孤儿目录**
> （名字带 `.bak`、或旧包名），它的 `package.json` 声明了 `dsh.bundle` 却无人认领，
> DSH 扫描到会判定身份非法 → **启动失败**。清理后务必删掉或移出 `node_modules`。

### 2.4 插件日志排查顺序

遇到「插件不生效/启动报错」，按这个顺序查：

1. `.dsh-market/log.ndjson` —— 找 `install` / `toggle` / `boot` 事件
2. `dsh --profile desktop --dump-config` —— 看插件是否在树里、exit code
3. profile 的 `package.json` 与 `cordis.patch.yml` —— 确认依赖声明与禁用状态
4. `node_modules` 里是否有孤儿目录/断链

---

## 三、发布到 npm：最容易翻车的一段

### 3.1 一次性准备（新账号必做）

**① 注册并验证邮箱。** 未验证邮箱的账号，npm 会阻止**首次发布**，且报错信息很迷惑。

**② 生成 Granular Access Token**（Classic token 已停止创建，别再找了）：

路径：`https://www.npmjs.com/settings/<your-name>/tokens` → Generate New Token

| 字段 | 取值 | 说明 |
|---|---|---|
| **Bypass two-factor authentication (2FA)** | ☑ **必须勾** | CI 无法完成 2FA 挑战 |
| **Allowed IP ranges** | **留空** | GitHub runner IP 动态，填了必被拦 |
| **Packages and scopes → Permissions** | `Read and write (publish and stage)` | 别选 `stage only` |
| **包范围** | **`All packages`** | ⚠️ 见下方坑 |
| **Organizations → Permissions** | `No access` | 除非真的发布到 org |

> ### ⚠️ 坑：包范围选了 scope 会得到 E403
>
> **症状**：`npm error code E403 ... You may not perform that action with these credentials.`
>
> **原因**：Granular token 的 scope 授权是**严格前缀匹配**的。选了 `@yourname` 只覆盖
> `@yourname/*` 形式的包；若你的包名是**无 scope** 的 `your-plugin`，则完全不在授权内。
>
> **修复**：把包范围改成 **`All packages`**；或者把包名改成 `@yourname/your-plugin`。
>
> **判断技巧**：`npm whoami` 输出正确用户名 **不代表有发布权限** —— 它只验证身份。
> 身份对 + 权限不足 = `E403`；身份错/无凭据 = `E401`。**这两个码的含义要分清。**

**③ 存为 GitHub 仓库 secret**，名字必须精确是 `NPM_TOKEN`：

`https://github.com/<owner>/<repo>/settings/secrets/actions` → New repository secret

> ⚠️ **必须在 Repository secrets 下**，不是 Environment secrets。
> 若 workflow 的 job 没有声明 `environment:`，Environment secret 对它**不可见**，
> 变量会静默变成空字符串。

### 3.2 提交前先单独验证 token

每次失败的发布都会消耗一个版本号并推送 tag，所以**先验证再跑 CI**：

```powershell
$env:NPM_TOKEN = 'npm_你的token'
npm whoami --registry=https://registry.npmjs.org/ --//registry.npmjs.org/:_authToken=$env:NPM_TOKEN
Remove-Item Env:\NPM_TOKEN   # 用完清理
```

- 输出用户名 → 身份 OK（但**不保证**有发布权限，见上面 E403 说明）
- `E401` → token 值错误/复制不全
- `E403` → token 类型或包范围不对

### 3.3 semantic-release 的三种「失败」

这是本次最耗时的部分。同一个工具，三种不同的坏法：

#### 坑 A：静默空操作（最坑）

**症状**：CI 全绿、20 个 step 全 success，但 npm 上什么都没有，仓库也没有新的
`chore(release)` 提交。

**原因**：`commit-analyzer` 只认 `feat` / `fix` / `perf` / breaking / revert。
若自上个 tag 以来的提交全是 `chore:` / `docs:` / `style:`，它判定「无相关改动」，
**exit 0 静默退出**。

**修复**：确保有一个 `fix:` 或 `feat:` 提交；或者删除 tag 让基线回退。

#### 坑 B：版本号被「预支」

**症状**：tag 已存在且指向含全部功能的提交，但 npm 上从未发布，重跑永远不动。

**原因**：semantic-release 取**可达的最高 tag** 作为基线。tag 存在 = 它认为那些改动发过了。

**修复**：

```powershell
# 只删远端 tag（本地可能有继承来的同名 tag，不要动）
git push origin :refs/tags/v1.0.0 :refs/tags/v1.0.1
```

#### 坑 C：版本号算得比预期高

**症状**：想要 `1.0.0`，结果算出 `2.0.0`。

**原因**：历史里有 `feat!:`（breaking change）就会判定 `major`。
**fork 来的仓库尤其容易中招** —— 上游的历史提交也在你的历史里。

**修复**：把 `package.json` 的 version 设成比目标低一个 major，让递增后正好落到目标：

| 当前 version | release 类型 | 发布结果 |
|---|---|---|
| `1.0.1` | `major` | `2.0.0` |
| `1.0.0` | `major` | `2.0.0` |
| **`0.9.0`** | `major` | **`1.0.0`** ✅ |

> **先用 dry-run 验证，别赌**。在隔离克隆里跑：
> ```powershell
> git clone https://github.com/<owner>/<repo>.git $env:TEMP\dryrun
> cd $env:TEMP\dryrun; npm ci
> node --input-type=module -e "
> import { analyzeCommits } from '@semantic-release/commit-analyzer';
> import { execSync } from 'child_process';
> const log = execSync('git log --format=%H%x1f%s%x1f%b%x1e',{maxBuffer:1e8}).toString();
> const commits = log.split('\x1e').filter(s=>s.trim()).map(r=>{const p=r.split('\x1f');
>   return {hash:p[0],message:((p[1]||'')+'\n\n'+(p[2]||'')).trim()};});
> const t = await analyzeCommits({}, {commits, cwd:process.cwd(), env:process.env,
>   logger:{log(){},error(){},warn(){}}, branch:{name:'main'}});
> console.log('release 类型:', t);
> "
> ```
> 注意 `analyzeCommits` 是**具名导出**，且遇 `major` 会提前 `break`。

### 3.4 `.releaserc.cjs` 推荐配置

```js
module.exports = {
  branches: ['main'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    ['@semantic-release/changelog', { changelogFile: 'CHANGELOG.md' }],
    '@semantic-release/npm',
    [
      '@semantic-release/github',
      {
        // ⚠️ 强烈建议关掉，见下方坑
        successComment: false,
        failComment: false,
        failTitle: false,
        labels: false,
      },
    ],
    ['@semantic-release/git', {
      assets: ['CHANGELOG.md', 'package.json', 'package-lock.json'],
    }],
  ],
}
```

> ### ⚠️ 坑：`success` 步骤的 issue 引用会让整个 release job 失败
>
> **症状**：
> ```
> ✘ Failed step "success" of plugin "@semantic-release/github"
> Error: Could not resolve to an issue or pull request with the number of 117.
> ```
> 而且 release job 标记为 failure → 声明了 `needs: release` 的下游 job（如编译二进制的）
> **全部被 skip** → Release 上一个产物都没有。
>
> **原因**：CHANGELOG 里 `closes [#117]` 这类引用是**上游仓库的 issue 编号**
> （fork 来的仓库会原样继承历史提交）。semantic-release 在 `success` 步骤挨个发评论，
> 但它们在**你的**仓库里不存在 → `NOT_FOUND`。
>
> 注意这个错误发生在 **npm publish 之后**，所以包本身发出去了，但产物被连带砍掉。
>
> **修复**：如上关闭自动评论。**键名要按插件版本核对** —— v11 用的是 `labels`，
> 不是旧版的 `releasedLabels`；也没有 `addReleases` 选项。写错键名会静默无效：
> ```powershell
> # 列出插件真实读取的配置键
> Select-String -Path "node_modules\@semantic-release\github\index.js" -Pattern "pluginConfig\.\w+\s*="
> ```

---

## 四、发 GitHub Release（二进制/预构建产物）

### 4.1 为什么要单独发 Release

npm 包应该只装**插件运行时代码**。服务器端二进制、预构建产物不要打进 npm ——
会让每个装插件的人白下几十 MB。走 Release 资产。

```yaml
relay-binaries:
  needs: release          # ⚠️ 等 semantic-release 发完，package.json 才是新版本号
  runs-on: ubuntu-latest
  permissions: { contents: write }
  steps:
    - uses: actions/checkout@v4
      with: { ref: main } # ⚠️ 取 semantic-release 刚推的提交
    - uses: actions/setup-go@v5
      with: { go-version: '1.25' }
    - name: 读取版本号
      id: v
      run: echo "version=$(node -p "require('./package.json').version")" >> "$GITHUB_OUTPUT"
    - name: 交叉编译
      run: DSHP_RELAY_VERSION="${{ steps.v.outputs.version }}" npm run build:relay:all
    - name: 挂到 Release
      uses: softprops/action-gh-release@v2
      with:
        tag_name: v${{ steps.v.outputs.version }}
        files: |
          dist/your-binary-linux-amd64
          dist/your-binary-windows-amd64.exe
          dist/SHA256SUMS.txt
```

三个要点：

1. **`needs: release`** —— 否则 checkout 到的 `package.json` 还是旧版本号
2. **显式传版本号** `DSHP_RELAY_VERSION=...` —— 构建脚本里硬编码的默认值会让产物内嵌错误版本
3. **`ref: main`** —— 取 semantic-release 刚推的那个提交

### 4.2 交叉编译矩阵：用固定列表，别用 `localGoos`

```js
// ❌ 曾经的写法：第三项用本机 GOOS
// 在 Linux CI 上会重复 linux/amd64，Windows 二进制永远不会被构建
const RELEASE_MATRIX = [
  { goos: 'linux',   goarch: 'amd64' },
  { goos: 'linux',   goarch: 'arm64' },
  { goos: 'windows', goarch: 'amd64' },   // ✅ 固定写死
]

// 本机目标的裸别名单独加，并去重
const targets = [...RELEASE_MATRIX, { goos: localGoos, goarch: localGoarch, bare: true }]
```

> **真实事故**：这个 bug 导致 Release 长期缺少 `windows-amd64.exe`，
> 而 CI 是绿的 —— 因为 Linux 上「本机目标」恰好等于矩阵第一项，重复构建也不会报错。

### 4.3 二进制验证清单

发布后**必须验证**，不要只看 CI 绿：

```powershell
# 1) 下载并核对哈希
Invoke-WebRequest "https://github.com/<o>/<r>/releases/download/v1.0.1/SHA256SUMS.txt" -OutFile sums.txt
Get-FileHash <下载的二进制> -Algorithm SHA256    # 与 sums.txt 对比

# 2) 确认内嵌版本号正确（管理端/日志会显示它）
$bytes = [System.IO.File]::ReadAllBytes("your-binary.exe")
[regex]::Matches([System.Text.Encoding]::ASCII.GetString($bytes), '\d+\.\d+\.\d+') |
  ForEach-Object { $_.Value } | Select-Object -Unique
```

> 注意 `sha256sum *` 会把**本机裸别名**（无后缀那个）也算进去，
> 但它通常不作为资产上传 —— `SHA256SUMS.txt` 里会多出一行，无害但不整洁。
> 想干净就显式列出文件名。

---

## 五、上架到 dsh-market（提 PR 到精选目录）

### 5.1 机制说明

- 数据源是精选目录仓库 **`awesome-dsh-plugin/awesome-dsh-plugin`**
- 列表在 `data/plugins/`，**一个插件一个 YAML 文件**
- 两个 `README.md` 由脚本生成，**不要手工编辑**
- 提 PR 只需**一个文件**：`data/plugins/<owner>__<repo>.yml`（双下划线）
- **一个 PR 最多 3 条**

### 5.2 条目格式

```yaml
url: https://github.com/<owner>/<repo>     # 必须纯 https，无 .git、无路径
name: <owner>/<repo>                        # 列表里显示的链接文字
category: remote                            # 见下方分类列表
description:
  en: 'One-line description ending with a period.'
  zh: '一句话描述，以句号结尾。'              # 可选，维护者会补
```

**可用分类**：
`agi` `ui` `usage` `theme` `model` `identity` `session` `memory` `tools` `wsl`
`browser` `vision` `voice` `docs` `skill` `workflow` `git` `notify` `dev`
`security` `remote` `market` `fun`

要点：

- **含 `: `（冒号+空格）的英文描述必须加引号**，否则 YAML 解析失败
- **不要写 `npm:` 字段** —— 会被校验拒绝；npm 映射从 registry 自动采集
- 主题/皮肤类必须放 `theme`（会进市场专属 Tab）

### 5.3 前置条件（CI 会查）

| 条件 | 说明 |
|---|---|
| `package.json` 声明 **`dsh.bundle`** | ⚠️ 只声明 `dsh.client` 是**最常见被拒原因** |
| 仓库创建满 **1 天** | 自动检查，不达标就做完再提，**重新提交没有惩罚** |
| 添加 **`dsh-plugin`** topic | 仓库首页 About → Topics |
| 有真实可用代码 | 占位仓库、纯 README 不收 |
| 描述**属实** | 会被当声明与代码核对，夸大是主要打回原因 |

### 5.4 提交步骤（含最容易错的一步）

**① Fork 上游仓库**

```
https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/fork
```

**② 在你的 fork 里新建文件**

```
https://github.com/<you>/awesome-dsh-plugin/new/main/data/plugins
```

文件名：`<owner>__<repo>.yml`（**双下划线**，**必须 `.yml` 结尾**）

**③ 提交时选「Create a new branch for this commit and start a pull request」**

> ### ⚠️ 坑：PR 默认提到你自己的 fork，上游看不到
>
> **症状**：PR 创建成功，但 base 显示 `<you>:main` 而不是 `awesome-dsh-plugin:main`，
> 上游仓库的 PR 列表里找不到它。
>
> **修复**：用 compare 直达链接构造正确的 PR：
> ```
> https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/compare/main...<you>:awesome-dsh-plugin:<branch>?expand=1
> ```
> 或在上游仓库首页点 *Compare & pull request* 横幅。
>
> 另外：PR 创建后的 **Edit 只能改标题，改不了 base 仓库** —— 别在那儿浪费时间。

**④ 确认对比方向**

| | 应该是 |
|---|---|
| base | `awesome-dsh-plugin/awesome-dsh-plugin` : `main` |
| head | `<you>/awesome-dsh-plugin` : `<your-branch>` |

### 5.5 本地预演 CI（省一轮往返）

```powershell
git clone https://github.com/awesome-dsh-plugin/awesome-dsh-plugin.git
cd awesome-dsh-plugin
# 放进你的条目后：
npm ci
node scripts/generate-readme.mjs --check                    # README 是否一致
node scripts/build-site.mjs                                 # 站点构建（需 SKIP_PUBLISH_CHECKS=1）
node --test scripts/added-dates.test.mjs                    # 日期推导回归测试
```

> `build-site.mjs` 需要**完整 git 历史**（`--depth 1` 克隆会报
> `no added-date derivable`），且条目**必须已提交**。
> 报这个错不是条目有问题，是本地克隆方式的问题。

CI 实际检查项（按顺序）：条目数 ≤3 → `dsh.bundle` → 仓库年龄 → `awesome-lint` → 站点构建。

### 5.6 截图（可选，推荐）

在**你自己的仓库**放 `screenshots.json`（与 `package.json` 同级）：

```json
["docs/shot-1.png", "docs/shot-2.png"]
```

- 1–8 张，相对路径不能以 `/` 开头、不能含 `..`
- 也接受 GitHub 托管的 https 绝对 URL（第三方图床会被拒）
- **不声明也可以** —— 市场会从 README 自动抽图
- 好处：以后换图只需推自己的仓库，不用再提 PR

> ⚠️ 文件名避开会被当品牌图过滤的词：
> `badge` `shield` `logo` `icon` `avatar` `sponsor` `qr` `wechat` `npm`
> `coverage` `license` `status` `banner` `favicon`

### 5.7 预构建 tarball（可选）

市场安装优先级：**npm 包 → Release 预构建 tarball → 整仓源码**。

```yaml
# ⚠️ latest/download/ 只在请求时解析 latest，文件名是照字面取的
# 资产名带版本号的话，下次发版就 404，而且没人会发现
tarball: https://github.com/<o>/<r>/releases/latest/download/your-plugin.tgz

# ✅ 或钉住 tag，此时文件名带版本号是正常写法
tarball: https://github.com/<o>/<r>/releases/download/v1.0.0/your-plugin-1.0.0.tgz
```

### 5.8 评审会看什么

1. 代码是否与描述一致（**包括描述里的数字与 API 名称**）
2. 分类是否合理（不满意维护者会直接改，**不会因此打回**）
3. 是否真实可用（非占位）
4. **是否与现有条目重复** —— 分叉**可以**被收录，只要「维护得更好，或确实做了新东西」
5. 源码有无可疑之处（混淆、凭据外传、异常安装期行为）
6. PR 是否动了无关条目

> **对你的实战含义**：若你的插件是某已收录插件的 fork，
> **描述里要把差异化讲明白**（替换了什么、新增了什么能力）。

### 5.9 合并之后

- 网站与 dsh-market 自动收录（通常 1 天内）
- **市场不依赖网站**：市场实时拉目录，所以合并后通常**立刻**就能搜到
- 网站是静态构建，可能滞后几轮（本次实测：合并后线上仍是旧快照，属正常）

---

## 六、坑位速查表

### 6.1 按症状查

| 症状 | 根因 | 见 |
|---|---|---|
| `profile package identity is invalid for <name>` | 包名改动后 profile 里有旧身份残留 / `node_modules` 孤儿目录 | §1.3, §2.3 |
| `npm error code E403` | token 权限不足（包范围选成了 scope / 类型错） | §3.1 |
| `npm error code E401` | token 值错误或未设置 | §3.2 |
| CI 全绿但 npm 上什么都没有 | semantic-release 静默空操作（无 `feat`/`fix` 提交） | §3.3-A |
| 重跑永远不发版 | tag 已存在，改动被「预支」 | §3.3-B |
| 版本号比预期高一个大版本 | 历史里有 `feat!` | §3.3-C |
| `success` 步骤 `Could not resolve to an issue` | CHANGELOG 引用上游 issue 号 | §3.4 |
| Release 缺某个平台二进制 | 构建矩阵用了 `localGoos` | §4.2 |
| PR 上游看不到 | base 提到了自己的 fork | §5.4 |
| `no added-date derivable` | 浅克隆 / 条目未提交 | §5.5 |
| `ERESOLVE`（用户侧） | peer 范围未带显式预发布分支 | §1.4 |
| PR 被拒：`dsh.client` only | 缺 `dsh.bundle` | §1.2, §5.3 |

### 6.2 命令速查

```powershell
# 验证 profile 配置（不启动服务）
dsh --profile desktop --dump-config

# 验证 npm token 身份
npm whoami --registry=https://registry.npmjs.org/ --//registry.npmjs.org/:_authToken=$env:NPM_TOKEN

# 查 npm 包状态（404 = 可用/不存在）
curl.exe -s -o NUL -w "%{http_code}\n" https://registry.npmjs.org/<pkg>

# 删远端 tag（发版基线回退）
git push origin :refs/tags/v1.0.0

# 查 semantic-release 插件真实读取的配置键
Select-String -Path "node_modules\@semantic-release\github\index.js" -Pattern "pluginConfig\.\w+\s*="

# 查远端 tag 指向
git ls-remote --tags origin
```

> ⚠️ **别执行 `git push --tags`**。fork 来的仓库常带一堆上游 tag，
> 推上去会让 semantic-release 的版本基线直接跳到上游的高版本（如 `v2.10.6`）。

### 6.3 环境注意事项（Windows）

- **不要用 PowerShell 处理 CJK 文本**（`Get-Content | Set-Content` 会损坏编码）。
  用编辑器或专用文件工具。**显示乱码不一定是文件坏了** —— 用 .NET 显式 UTF-8
  读取可以区分「显示问题」和「实际损坏」：
  ```powershell
  [System.IO.File]::ReadAllLines($path, [System.Text.Encoding]::UTF8)
  ```
- `pwsh` **没有 heredoc**，多行文本先写临时文件（`git commit -F file`）
- `Start-Process -ArgumentList` 会把含空格的路径拆开
- `($json | ConvertFrom-Json).name` 常失败，改用 `node -p`

---

## 七、新插件启动清单

复制这份，逐项打勾。

### 阶段 1：骨架

- [ ] `package.json` 的 `name` 定好（**此后不再改**）
- [ ] 声明 `dsh.bundle.patch` 指向 `cordis.patch.yml`
- [ ] `cordis.patch.yml` 的 `name` 与 `package.json` 的 `name` **完全一致**
- [ ] `id` 选定（若从旧结构升级，保留历史 `id`）
- [ ] 官方 `@deepseek-ai/*` 放 **peerDependencies**
- [ ] `repository` 字段指回本仓库
- [ ] `files` 只含运行时需要的目录

### 阶段 2：本地开发

- [ ] 用 junction 接入 profile，确认能加载
- [ ] `dsh --profile desktop --dump-config` → exit=0
- [ ] 有测试，`npm test` 通过
- [ ] 改名/重构后**清理 `node_modules` 旧残留**

### 阶段 3：发布准备

- [ ] GitHub 仓库：添加 `dsh-plugin` topic
- [ ] 等待仓库满 **1 天**
- [ ] npm 账号邮箱已验证
- [ ] 生成 **Granular token**：勾 2FA bypass、包范围 `All packages`、权限 Read and write
- [ ] 存为 **Repository** secret `NPM_TOKEN`
- [ ] 本地 `npm whoami` 验证 token

### 阶段 4：CI

- [ ] `test.yml`：push/PR 跑测试
- [ ] `release.yml`：`workflow_dispatch` 手动发版
- [ ] `.releaserc.cjs`：关闭 `@semantic-release/github` 的自动评论
- [ ] 二进制/预构建走 Release 资产（带 `needs: release`）
- [ ] 构建矩阵**固定写死**，不用 `localGoos` 兜底
- [ ] 构建时**显式传版本号**

### 阶段 5：首次发布

- [ ] **dry-run 验证**版本号会算成什么
- [ ] 确认要发的版本（必要时调 `package.json` 的 version）
- [ ] 触发 release，确认 npm 上真的有了（**别只看 CI 绿**）
- [ ] 验证 Release 资产齐全 + 哈希正确 + 内嵌版本号正确

### 阶段 6：上架

- [ ] 写条目 YAML（`url`/`name`/`category`/`description`）
- [ ] 本地预演：`generate-readme --check` + `build-site.mjs`
- [ ] Fork 上游 → 新建 `data/plugins/<owner>__<repo>.yml`
- [ ] 提 PR 时**确认 base 是上游仓库**
- [ ] （可选）加 `screenshots.json`
- [ ] 合并后从市场安装验证

---

## 附：本次实践的时间线（参考）

| 阶段 | 主要问题 | 解法 |
|---|---|---|
| 发布 | npm `E403` 反复出现 | token 包范围从 `@kinderao` 改为 `All packages` |
| 发布 | CI 绿但 npm 无包 | 删 tag 回退基线 + 修正版本号至 `0.9.0` |
| 发布 | Release 缺全部二进制 | 关闭 `@semantic-release/github` 自动评论 |
| 本地 | 客户端启动报身份非法 | 清理 `node_modules` 孤儿目录 |
| 上架 | PR 提到自己的 fork | 用 compare 直达链接重建 PR |
| 上架 | CI 全绿 | 直接合并，无评审意见 |
