# 提 PR 到 awesome-dsh-plugin —— 照这份做

> 这份是把 `dsh-pocket-relay` 收录进 DSH 插件目录的**唯一**入口。dsh-market 里的插件列表
> 就是从这个精选列表生成的，**不要**往 dsh-market 仓库提插件条目（那是市场应用本身）。
>
> 数据来源：[`awesome-dsh-plugin/contributing.md`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)（已按其现行规则核对）。

---

## 一、提交物：一个 YAML 文件

**不是** `plugins.json` 条目，也**不要**手改 README（那两个 README 是脚本生成的）。

在 `awesome-dsh-plugin` 仓库里新增**一个**文件，文件名按 `<owner>__<repo>.yml`：

```
data/plugins/kinderao__dsh-pocket-relay.yml
```

内容（已备好，见本仓库 `docs/awesome-dsh-plugin-entry.yml`，直接复制）：

```yaml
url: https://github.com/kinderao/dsh-pocket-relay
name: kinderao/dsh-pocket-relay
category: remote
description:
  en: 'Mobile and remote access for DSH: scan a LAN QR code, or reach your PC from anywhere through a self-hosted relay on your own server. Per-device credentials that can be revoked individually, and multiple PCs with automatic failover.'
  zh: 'DSH 的手机与远程访问：局域网扫码即用，或用自建中继服务端随时随地连回电脑。每台设备独立凭据、可单独撤销；多台电脑共存并自动热备。'
```

要点：

- **`url` 必须是纯 `https://github.com/owner/repo`** —— 带 `.git`、带路径、用别的域名会被 CI 直接拒。
- **`name`** 是列表里显示的链接文字，用 `owner/repo` 形态。
- **`category: remote`**（远程与移动端）。这是最贴合的分类；选得不够准维护者会直接改，不会打回。
- **`description.en` 必填**，`zh` 可选（不写维护者会补）。**含 `: `（冒号+空格）时必须加引号**，否则 YAML 解析失败——上面已加。
- **不要写 `npm:` 字段**：yml 里手写 `npm:` 会被校验拒绝。npm 映射由 registry 自动采集，前提是**包里的 `repository` 字段指回这个仓库**（我们的 `package.json` 已经指好了）。

---

## 二、提交前自检（CI 会查这些）

| CI 检查项 | 我们的状态 |
| --- | --- |
| `dsh.bundle` manifest（**最常见的被拒原因**：只声明 `dsh.client` 是不可安装的） | ✅ 已声明 `dsh.bundle.patch: ./cordis.patch.yml`，且文件存在 |
| 仓库创建满 **1 天** | ⏳ 你的仓库刚建，**等满 1 天再提**，否则 CI 会拒（不记仇，达标后重提即可） |
| 仓库有真实可用代码（非占位/纯 README） | ✅ |
| 添加 **`dsh-plugin` topic** | ⏳ 去仓库首页 About ⚙️ → Topics 加上 `dsh-plugin` |
| `@deepseek-ai/*` 用 `peerDependencies` 而非 `dependencies` | ✅ 只有 `@deepseek-ai/cordis`，且在 peer |
| 描述属实、无营销词、与代码一致 | ✅ 已逐条对过源码 |
| 一个 PR 最多 3 条 | ✅ 只有 1 条 |

**description 的每条声明都对得上代码**（这条是维护者会实际核对的重点）：

| 声明 | 代码依据 |
| --- | --- |
| 局域网扫码 | `lib/index.js` 生成局域网二维码 |
| 自建中继服务端 | `relay/main.go`（Go 单二进制） |
| 每台设备独立凭据、可单独撤销 | `lib/device-auth.mjs` 的 `authenticate` / `approve` / `reject` / `revoke` |
| 多台电脑共存 + 自动热备 | `relay/internal/hub/hub.go` 的 `pickAgentLocked` |

---

## 三、截图（你选了「先不策展」）

不声明截图时，**市场会自动从 README 抽图**——机制是把 README 里的相对路径重写成
`https://raw.githubusercontent.com/<owner>/<repo>/HEAD/<path>`，并只接受 GitHub 域（第三方图床会被丢弃）。

于是现在的情况是：

- README 里会被抽到的图是 `docs/interface.jpg` 与 `docs/entry.jpg`；
- 但这两张是**上游 cloudflared 时代的旧界面**（上面写着「公网（人在外面）· 开启公网访问」），
  `docs/interface.jpg` 还是一张**实拍照片**（手机+笔记本，屏幕上是 `trycloudflare.com`）；
- 也就是说：**市场卡片会展示与你实际功能不符的过时截图。**

想换掉，两种做法（任选）：

**做法 A（推荐，无需再来提 PR）**：在你仓库根放一个 `screenshots.json`，列出 1–8 张：

```jsonc
// <你的仓库>/screenshots.json
[
  "docs/shot-relay-config.jpg",
  "docs/shot-devices.jpg",
  "docs/shot-admin-agents.jpg"
]
```

- 路径相对于该文件，**不能**以 `/` 开头、不能含 `..`；
- 也接受绝对 URL，但必须是 GitHub 托管的 https（`raw.githubusercontent.com` 等）；
- 之后想换图，推自己的仓库即可，下一次夜间构建自动生效，不用再提 PR。

要截的三张（对应你真正新增的能力）：

1. **设置页 → 手机访问 → 中继** 配置区（服务器地址/端口/对外地址/本机名称）
2. **设备管理**区（已配对设备列表 + 配对二维码）
3. **Go 管理端**的「电脑（PC 端）」表格（名称/来源/已连接/最后活动 + 设为首选/断开/禁止接入）

**做法 B**：什么都不做，接受旧 UI 截图。收录不受影响。

> 注意文件名避开这些词（会被当品牌图过滤掉）：
> `badge` `shield` `logo` `icon` `avatar` `sponsor` `qr` `wechat` `qq` `npm` `coverage` `license` `status` `banner` `favicon`。
> 顺带一提：`docs/pocket-settings-{zh,en}.png` 原本挂着 `.png` 扩展名但实际是 JPEG，已在本仓库改成 `.jpg`。

---

## 四、预构建 tarball（可选，但建议）

市场安装的优先级是 **npm 包 → GitHub Release 预构建 tarball → 整仓源码**。你已经决定发 npm，
所以这一项**可以不做**；但如果仓库从源码装不顺（例如要本地跑构建脚本），它是必需的。

要做的话，注意 contributing.md 明确警告的坑：

```yaml
# ⚠️ latest/download/ 只解析 latest，文件名是照字面取的。
# 资产名里带版本号的话，提交当天有效，你下次发版就 404（而且没人会发现）。
tarball: https://github.com/kinderao/dsh-pocket-relay/releases/latest/download/your-plugin.tgz
```

要么让资产名**不带版本号**，要么钉住 tag：

```yaml
# 钉住 tag：永不腐烂，此时文件名带版本号是正常写法
tarball: https://github.com/kinderao/dsh-pocket-relay/releases/download/v1.0.0/dsh-pocket-relay-1.0.0.tgz
```

必须是 GitHub Release 托管的 `https` `.tgz`，第三方托管不收。

> 我们目前的 Release 资产是**服务端二进制**（`dsh-pocket-relay-linux-amd64` 等），
> 不是插件本身的 tarball。要走这条快车道，得额外上传插件包（`npm pack` 产物）。

---

## 五、执行步骤

```powershell
# 1) 前置：仓库满 1 天 + 加 dsh-plugin topic（GitHub 网页操作）

# 2) fork 并克隆 awesome-dsh-plugin
git clone https://github.com/<你的 GitHub>/awesome-dsh-plugin.git
cd awesome-dsh-plugin
git checkout -b add-dsh-pocket-relay

# 3) 新增那一个文件（内容见上/见本仓库 docs/awesome-dsh-plugin-entry.yml）
#    data/plugins/kinderao__dsh-pocket-relay.yml

# 4) 可选：本地预览生成后的那一行（不要提交 README，它与数据源不一致会被 CI 拦）
npm ci
node scripts/generate-readme.mjs

# 5) 提交 PR
git add data/plugins/kinderao__dsh-pocket-relay.yml
git commit -m "Add kinderao/dsh-pocket-relay"
git push origin add-dsh-pocket-relay
```

然后在 GitHub 上开 PR。**一个文件就是全部投稿。**

CI 失败会在 PR 上明确指出要改什么——**在同一分支推修复即可，不用重开 PR**。

---

## 六、评审会看什么（心里有数）

1. **代码是否名副其实** —— 包括描述里的数字与 API 名称；
2. **分类是否合理** —— 不会因为分类被打回，维护者直接改；
3. **是不是真实可用的代码** —— 占位/空壳不收；
4. **是否与现有条目重复** —— 两个插件做同一件事时「谁更好」而非「谁先来」；
   分叉**可以**被收录，只要维护得更好或确实做了新东西；
5. **源码有无可疑之处** —— 混淆代码、凭据外传、异常安装期行为（注意：收录**不等于**安全审查）；
6. **PR 是否动了无关条目** —— 只改自己那一条。

关于第 4 条的实话：`dsh-pocket` 上游**已经在列表里**（本项目是它的 fork）。我们
能站住脚的地方是**确实做了新东西**——自建 relay 中继替代 cloudflared、设备级认证、
多 PC 端共存与热备。描述里已经把这几点讲明白了，评审时也是靠这几点区分。
如果被判定为「与上游覆盖重复」，那也不是对代码的否定，可以按反馈再补充或调整定位。

---

## 七、合并之后

- 网站与 **dsh-market 会自动收录**（通常 1 天内生效，市场每次打开都实时拉目录）；
- 收录不影响 npm 是否发布，但**发了 npm 才会显示下载量**并能被「只能装 npm 插件」的桌面端安装（见下）。

### 为什么你**必须**发 npm

我们查过你本机 DSH Desktop 的安装边界（`dsh-desktop-market-installer`）：它只接受
**`name@exact.version` 形式的 registry 包**，不接受 `github:` 源。也就是说：

> 只挂 GitHub、不发 npm 的插件，**在你自己的桌面端上根本装不了**
> （contributing.md 也提到目录里 57% 的条目没有 npm 包，在部分桌面客户端上装不上）。

所以「注册 npm 并发一个 `1.0.0`」不是可选项，而是让插件能在你自己的客户端里一键安装的前提。
