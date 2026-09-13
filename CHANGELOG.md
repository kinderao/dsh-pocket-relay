## [1.0.1](https://github.com/kinderao/dsh-pocket-relay/compare/v1.0.0...v1.0.1) (2026-09-13)


### Bug Fixes

* **release:** 关闭 semantic-release 的自动评论，避免二进制产物被连带跳过 ([f1af780](https://github.com/kinderao/dsh-pocket-relay/commit/f1af780d8d66488cca0257aa9060f993c4cdf2e7)), closes [#117](https://github.com/kinderao/dsh-pocket-relay/issues/117) [#99](https://github.com/kinderao/dsh-pocket-relay/issues/99)

# 1.0.0 (2026-09-13)


* feat!: redesign settings page layout into structured cards ([1b7d494](https://github.com/kinderao/dsh-pocket-relay/commit/1b7d494554ed80eadd701c1e2574760ff130580c))
* feat!: 自建 Go relay 中继（替代 cloudflared）+ 设备认证 + 多 PC 端共存/热备 ([b282e1d](https://github.com/kinderao/dsh-pocket-relay/commit/b282e1d9497e9c0c9ad21ea64075629f9c8e5605))


### Bug Fixes

* **audit:** full review round — push state, proxy gzip/WS, tunnel single-flight, restart port-wait ([eb9ad5e](https://github.com/kinderao/dsh-pocket-relay/commit/eb9ad5e4bd651d008fd4da862f77b799edf37d2e))
* **auth:** login page copy adapts to LAN vs public source ([e31f022](https://github.com/kinderao/dsh-pocket-relay/commit/e31f022053c8ffa7205b569c99bbfb0e74b34b3b))
* **auth:** login rate limiting — anti brute-force (issue [#40](https://github.com/kinderao/dsh-pocket-relay/issues/40)) ([8f685d5](https://github.com/kinderao/dsh-pocket-relay/commit/8f685d556f2b58ee3d963643b2d2c9b38c8717fa))
* **auth:** Tailscale/CGNAT(100.64/10) 与手动局域网地址覆盖走局域网密码（issue [#79](https://github.com/kinderao/dsh-pocket-relay/issues/79)） ([e3c2e7b](https://github.com/kinderao/dsh-pocket-relay/commit/e3c2e7b97700b375bdc17a68ed3523588796ba21)), closes [#66](https://github.com/kinderao/dsh-pocket-relay/issues/66)
* **build:** --all 的发布矩阵必须是固定三平台，不能拿 localGoos 顶替 ([d38a9ec](https://github.com/kinderao/dsh-pocket-relay/commit/d38a9ec13daf14102d2723bb2874897dfea10848)), closes [#2](https://github.com/kinderao/dsh-pocket-relay/issues/2)
* **build,test:** --all 同步产出本机无后缀二进制；版本断言不再写死 ([77a6cc0](https://github.com/kinderao/dsh-pocket-relay/commit/77a6cc036ed0e5706b8fc57792b397edda52f065))
* **ci:** drop setup-node registry-url to avoid .npmrc conflict with semantic-release ([bb41482](https://github.com/kinderao/dsh-pocket-relay/commit/bb41482cf499533741cd22a28b5004be253d4f4f))
* **cli:** Ctrl+C now fully exits (kill tunnel + close proxy + process.exit) — previously it only stopped the tunnel and hung ([6d11f1f](https://github.com/kinderao/dsh-pocket-relay/commit/6d11f1f3d14fa8ea66e045fb9fe7d19b5251edf5))
* **client:** bind React in the client bundle so mobile components render ([1838fb9](https://github.com/kinderao/dsh-pocket-relay/commit/1838fb9ec2442f5eb2cdd4ebf0eaac6cc1565451))
* **client:** LAN switch row crashed on first render (status=null) — 1.9.0 white screen ([9cffedd](https://github.com/kinderao/dsh-pocket-relay/commit/9cffedd6ed0986fecead77ce13641f9cf357f291))
* **client:** prevent iOS Safari input auto-zoom on mobile ([8d5b3fa](https://github.com/kinderao/dsh-pocket-relay/commit/8d5b3fa1a14385816e61f92bd83fb239f7d8e74f)), closes [#114](https://github.com/kinderao/dsh-pocket-relay/issues/114)
* **client:** 修复深色主题下主按钮文字看不清的问题 ([dd61530](https://github.com/kinderao/dsh-pocket-relay/commit/dd615307901b258afca45e242360f89beadd8903)), closes [#fff](https://github.com/kinderao/dsh-pocket-relay/issues/fff)
* **client:** 补上 MobileComposerFullscreen 缺的 import（P0） ([a71319d](https://github.com/kinderao/dsh-pocket-relay/commit/a71319dd66f6b3e70a8f904ce3dca236e6615dbd))
* **desktop:** inject dsh-desktop-mode/platform into proxied HTML when host runs in DSH Desktop — phone scanning a desktop profile crashed with 'invalid or missing dsh-desktop-mode null' (issue [#3](https://github.com/kinderao/dsh-pocket-relay/issues/3)/[#4](https://github.com/kinderao/dsh-pocket-relay/issues/4)) ([a9cb5a3](https://github.com/kinderao/dsh-pocket-relay/commit/a9cb5a3eff0545409d0060f25b8744ec1c559fa3))
* **desktop:** stop injecting dsh-desktop-* markers into proxied pages ([17c2d97](https://github.com/kinderao/dsh-pocket-relay/commit/17c2d97e6c2da5951a11e171efdd1e436184b04c)), closes [3/#4](https://github.com/kinderao/dsh-pocket-relay/issues/4)
* **docs:** 在 README 中添加 Trendshift badge ([ffe894e](https://github.com/kinderao/dsh-pocket-relay/commit/ffe894e842867d4ef297e80d47011c6377d583e7))
* ESM require is not defined in push.mjs — use createRequire (boot crash); regression test with real web-push ([c6b824e](https://github.com/kinderao/dsh-pocket-relay/commit/c6b824e94fb770a12ee5e9a0a7b1efc09eab6e41))
* forward WS upgrade head with the request + schema-compliant RPC errors ([62138ba](https://github.com/kinderao/dsh-pocket-relay/commit/62138baae76e94c05cd7f6c1a0275f4e5d3849af))
* LAN QR code should prefer a phone-reachable private IPv4 ([da7c642](https://github.com/kinderao/dsh-pocket-relay/commit/da7c6428c7a5628f61b5a2c5ca43c511dd48af19))
* **lan:** drop WSLENV from WSL detection (PR [#62](https://github.com/kinderao/dsh-pocket-relay/issues/62)) ([383f2d2](https://github.com/kinderao/dsh-pocket-relay/commit/383f2d24a62cc79ce0ccb42b1035a796a1ddc972))
* **lan:** Easytier vs renamed physical NIC tie-break (issue [#43](https://github.com/kinderao/dsh-pocket-relay/issues/43)) ([d0c7fba](https://github.com/kinderao/dsh-pocket-relay/commit/d0c7fbab8893a0ffa568fb2205c91511701fa0e5))
* **lan:** WSL LAN IP detection (issue [#39](https://github.com/kinderao/dsh-pocket-relay/issues/39)) ([52b5c94](https://github.com/kinderao/dsh-pocket-relay/commit/52b5c949d5b861229920e6f22e102e117f2f0354))
* **mobile:** center column pulled back to track 1 — phone showed only the background (issue [#5](https://github.com/kinderao/dsh-pocket-relay/issues/5)) ([fc04b20](https://github.com/kinderao/dsh-pocket-relay/commit/fc04b201341e37bcbacc59c8f4ff10946a1c3339))
* **mobile:** drawer backdrop steals taps on session rows (issue [#38](https://github.com/kinderao/dsh-pocket-relay/issues/38)) ([ca0d8ab](https://github.com/kinderao/dsh-pocket-relay/commit/ca0d8ab0fefdcc06420ddbb7b4ffe936c79d98c2))
* **mobile:** drawer z-index 40 -> 600 (PR [#42](https://github.com/kinderao/dsh-pocket-relay/issues/42)) + release v1.11.3 ([f3560a4](https://github.com/kinderao/dsh-pocket-relay/commit/f3560a4db7990042cc9300a3030e62fe527d980a)), closes [#38](https://github.com/kinderao/dsh-pocket-relay/issues/38)
* **mobile:** hide Files entries when host lacks aionui explorer (issue [#48](https://github.com/kinderao/dsh-pocket-relay/issues/48)) ([60abc12](https://github.com/kinderao/dsh-pocket-relay/commit/60abc121e91af1a2412eb1a061c878c24ab13aa2))
* **mobile:** raise drawer above shell overlay raised by third-party plugins (PR [#42](https://github.com/kinderao/dsh-pocket-relay/issues/42)) ([cbd6822](https://github.com/kinderao/dsh-pocket-relay/commit/cbd68227975848a329a56dee721d702ee18c2441))
* **mobile:** restore compact usable composer ([#89](https://github.com/kinderao/dsh-pocket-relay/issues/89)) ([#93](https://github.com/kinderao/dsh-pocket-relay/issues/93)) ([5c56d24](https://github.com/kinderao/dsh-pocket-relay/commit/5c56d24c2953022c4300973627dae4d3aebcfbb2))
* **mobile:** snap composer popups to viewport sheet; scroll containers clipped them half-visible on phones ([#88](https://github.com/kinderao/dsh-pocket-relay/issues/88)) ([7209de8](https://github.com/kinderao/dsh-pocket-relay/commit/7209de8540cf324dd578b18f10bec6b1ff8ea3c4))
* **mobile:** 侧边栏先开后弹出 aria-modal 弹窗时自动收起，修复卡死 ([#99](https://github.com/kinderao/dsh-pocket-relay/issues/99)) ([f2e60b0](https://github.com/kinderao/dsh-pocket-relay/commit/f2e60b0eb03ac1b065788e231590a56316a7cfcf))
* **mobile:** 去掉 isInsidePocket 误杀，让对话文件链接在手机上弹提示并注入复制按钮（issue [#17](https://github.com/kinderao/dsh-pocket-relay/issues/17)） ([5fca020](https://github.com/kinderao/dsh-pocket-relay/commit/5fca0202623df513e11b4654868210f287ea6ffd))
* **mobile:** 抽屉层级压过 dsh-web-ui-all 的全屏遮罩 (issue [#67](https://github.com/kinderao/dsh-pocket-relay/issues/67)) ([88605d9](https://github.com/kinderao/dsh-pocket-relay/commit/88605d93a145af61e345f91b96db2850bb8f1e56))
* **mobile:** 抽屉里的工作区菜单点不动，并给 iOS 触摸加自愈 (issue [#72](https://github.com/kinderao/dsh-pocket-relay/issues/72)) ([9f7c427](https://github.com/kinderao/dsh-pocket-relay/commit/9f7c4279049c499f2f33b6ded45f2bd92625b476))
* **mobile:** 替换手机端模型设置加载失败提示为引导信息，增加本地真机冒烟测试 ([5ab2ad4](https://github.com/kinderao/dsh-pocket-relay/commit/5ab2ad444ba276c5df2bf87fa104c4b16b2081f9))
* **mobile:** 移动端拦截文件链接点击改提示、隐藏添加工作区，移除冗余复制按钮（issue [#17](https://github.com/kinderao/dsh-pocket-relay/issues/17)） ([96ed896](https://github.com/kinderao/dsh-pocket-relay/commit/96ed896201045b009068b198e6f5f444a43cfb23))
* **mobile:** 触摸切换会话等宿主完成导航后再关抽屉 ([#85](https://github.com/kinderao/dsh-pocket-relay/issues/85)) ([80b9d16](https://github.com/kinderao/dsh-pocket-relay/commit/80b9d16369e3e33457afe8d9c1a48dfa42dc4397)), closes [#84](https://github.com/kinderao/dsh-pocket-relay/issues/84)
* **proxy:** attach error handler to upstream WS socket (PR [#49](https://github.com/kinderao/dsh-pocket-relay/issues/49)) ([a1d92c0](https://github.com/kinderao/dsh-pocket-relay/commit/a1d92c081b471c48f68e0493a6b3aedfa0ded3a3))
* **proxy:** auto-fallback port on EADDRINUSE (desktop + web both bind 3081); drop the desktop hint line ([12b74d0](https://github.com/kinderao/dsh-pocket-relay/commit/12b74d0d421bd8000a135c8b18bc2b5242b90ab7))
* **proxy:** complete the dsh web browser-session handshake (issue [#77](https://github.com/kinderao/dsh-pocket-relay/issues/77)) ([ffc12dd](https://github.com/kinderao/dsh-pocket-relay/commit/ffc12ddfcd2113ee4ba80424b2346efee85c0c0f))
* **proxy:** destroy WS peers on FIN to avoid half-open slot leak (PR [#56](https://github.com/kinderao/dsh-pocket-relay/issues/56)) ([4ba5bd7](https://github.com/kinderao/dsh-pocket-relay/commit/4ba5bd7d8584a8d73df396d8fcbf92ab2876229d))
* **proxy:** location shim Proxy binds all methods (issue: session display regression) ([db7763d](https://github.com/kinderao/dsh-pocket-relay/commit/db7763d923295d039668870eeca066c538e89e73))
* **proxy:** location.hostname shim — LAN settings unavailable (issue [#58](https://github.com/kinderao/dsh-pocket-relay/issues/58)) ([cc5a2ea](https://github.com/kinderao/dsh-pocket-relay/commit/cc5a2eaa6bd4df0641bac856bc6243bc4fa9496d))
* **proxy:** loopback trust patch so remote browsers can load settings (issue [#58](https://github.com/kinderao/dsh-pocket-relay/issues/58)) ([#87](https://github.com/kinderao/dsh-pocket-relay/issues/87)) ([1d67152](https://github.com/kinderao/dsh-pocket-relay/commit/1d67152a8a1808d36743162ff24abe3a061cedcd))
* **proxy:** polyfill AbortSignal.any for Android WebView (issue [#53](https://github.com/kinderao/dsh-pocket-relay/issues/53)) ([472524a](https://github.com/kinderao/dsh-pocket-relay/commit/472524a45ef7b1ff6fbd9c3bf50787680a5497c3))
* **proxy:** revert location.hostname shim (session list regression) ([13e52db](https://github.com/kinderao/dsh-pocket-relay/commit/13e52db3ece072a17ee76fcd5125cebd66c809eb))
* **proxy:** shim transport.createApiClient for dsh 0.1.1-rc.2 (issue [#96](https://github.com/kinderao/dsh-pocket-relay/issues/96)) ([61cadf8](https://github.com/kinderao/dsh-pocket-relay/commit/61cadf871ec817f51135277b7fb3085d9492959e))
* **proxy:** support `?token=<raw pin>` and seed the auth cookie (issue [#35](https://github.com/kinderao/dsh-pocket-relay/issues/35)) ([734afbd](https://github.com/kinderao/dsh-pocket-relay/commit/734afbdb800ed4b2a1d4dff085cdf2ef074917db))
* **proxy:** upstream WS socket error handler (PR [#49](https://github.com/kinderao/dsh-pocket-relay/issues/49)) ([298aff6](https://github.com/kinderao/dsh-pocket-relay/commit/298aff60abab16f1e841d141534c53c81ca7b3e8))
* **proxy:** WebSocket heartbeat keep-alive (PR [#41](https://github.com/kinderao/dsh-pocket-relay/issues/41), issue [#29](https://github.com/kinderao/dsh-pocket-relay/issues/29)) ([5328159](https://github.com/kinderao/dsh-pocket-relay/commit/53281595d6d8a7a47a0384e212bf9bd1f44f1fdc))
* **proxy:** WS half-open leak — teardown on end + end:false + upstream resetAndDestroy (PR [#56](https://github.com/kinderao/dsh-pocket-relay/issues/56)) ([4c2c358](https://github.com/kinderao/dsh-pocket-relay/commit/4c2c3585857e238f0c1dbbe14a4daf68263744fd))
* **proxy:** 打断 Safari 局域网入口的 303 无限重定向（issue [#91](https://github.com/kinderao/dsh-pocket-relay/issues/91)） ([4dd4c01](https://github.com/kinderao/dsh-pocket-relay/commit/4dd4c017d5ad4b11ac003058dbda1d8d6507f079))
* **proxy:** 移除与 DSH Desktop 2.0.4+ 不兼容的 LOOPBACK_ENV_PATCH，修复远程/手机访问白屏 ([#105](https://github.com/kinderao/dsh-pocket-relay/issues/105)) ([a1b813d](https://github.com/kinderao/dsh-pocket-relay/commit/a1b813d854da5900b55c5893f3190a272cd4a0fc)), closes [#100](https://github.com/kinderao/dsh-pocket-relay/issues/100) [#58](https://github.com/kinderao/dsh-pocket-relay/issues/58)
* **proxy:** 转发前清掉历史遗留的 dsh-desktop-* 参数 (issue [#75](https://github.com/kinderao/dsh-pocket-relay/issues/75)) ([8979594](https://github.com/kinderao/dsh-pocket-relay/commit/89795940e2aeb28675b79a1541862331fe3aef5f))
* **release:** restore fixes missing from 1.0.21-1.0.25 npm tarballs + merge PR [#1](https://github.com/kinderao/dsh-pocket-relay/issues/1) React binding ([f9031a4](https://github.com/kinderao/dsh-pocket-relay/commit/f9031a47f8ab501c80efb40fc1ffbe56d4afa087))
* **release:** 版本基线改为 0.9.0，让首次 npm 发布落到 1.0.0 ([3870380](https://github.com/kinderao/dsh-pocket-relay/commit/3870380f0a4bdeabb6dd7f5d9e6ab920dfd07c5a))
* **release:** 补发 npm 包并修正 Windows 发布资产 ([3d25a9b](https://github.com/kinderao/dsh-pocket-relay/commit/3d25a9bc59de581a58670de5ca40cb9de752f127)), closes [#1](https://github.com/kinderao/dsh-pocket-relay/issues/1) [#2](https://github.com/kinderao/dsh-pocket-relay/issues/2)
* **restart:** await readFile in readRestartNotice — missing await caused unhandled rejection crashing dsh web on boot (ENOENT restarted.json) ([3267ef2](https://github.com/kinderao/dsh-pocket-relay/commit/3267ef224b79bc7acb991bdb8879549ee1b9b1e9))
* **restart:** consume restarted.json after first read — '已重启' banner shows once, not on every page load (stale marker kept re-showing it) ([82cebd6](https://github.com/kinderao/dsh-pocket-relay/commit/82cebd6bd3e5c84abee4ea5dee794d43bab655f8))
* **restart:** pocketRestart referenced apply's internals — ReferenceError on restart button (showed as 'update failed') ([b4c54e9](https://github.com/kinderao/dsh-pocket-relay/commit/b4c54e96fec9afbe16c30f70ea92e36c3acbd53e))
* **rpc:** lan.setOverride returns full status (PR [#47](https://github.com/kinderao/dsh-pocket-relay/issues/47)) ([a328f8b](https://github.com/kinderao/dsh-pocket-relay/commit/a328f8bb69146a03ae97d6b56422b37cb489af5d))
* **rpc:** 以方法形式调用 requestRejection 保留 this 绑定，修复 /dsh-pocket/* 全部 403（issue [#117](https://github.com/kinderao/dsh-pocket-relay/issues/117)） ([282f71c](https://github.com/kinderao/dsh-pocket-relay/commit/282f71c1d844b0e6123b9c976ad0401c3c4a84e7))
* **rpc:** 适配 dsh v0.1.5-alpha.1 的 webServer inject 收缩，堵住启动崩溃 ([#112](https://github.com/kinderao/dsh-pocket-relay/issues/112)) ([2ac8efd](https://github.com/kinderao/dsh-pocket-relay/commit/2ac8efdb46de19959c1fc59eeddf2f12b42cb909)), closes [#109](https://github.com/kinderao/dsh-pocket-relay/issues/109) [#113](https://github.com/kinderao/dsh-pocket-relay/issues/113) [#111](https://github.com/kinderao/dsh-pocket-relay/issues/111)
* **security:** CLI 模式默认开启访问密码，堵住 0.0.0.0 上的无认证访问（issue [#90](https://github.com/kinderao/dsh-pocket-relay/issues/90) [#8](https://github.com/kinderao/dsh-pocket-relay/issues/8)） ([5d3a6d0](https://github.com/kinderao/dsh-pocket-relay/commit/5d3a6d03e4e1c4fe84626fd3dfd7a4fec28641cc))
* **security:** 堵住 ?token=/WS 的限速旁路，PIN 改 CSPRNG，Host 头伪造按源地址收紧（issue [#90](https://github.com/kinderao/dsh-pocket-relay/issues/90)） ([0bfe15a](https://github.com/kinderao/dsh-pocket-relay/commit/0bfe15a56c2063e14f1eea5de2ef0cd4e1e54b0d))
* **security:** 收紧限速身份键与登录比较，修隧道失败态残留，移除已删功能的 README 残留 ([517eb00](https://github.com/kinderao/dsh-pocket-relay/commit/517eb004ce869f5e140159dfa118ab833a37fd6c)), closes [#69](https://github.com/kinderao/dsh-pocket-relay/issues/69)
* **security:** 防钓鱼校验只在公网启用，局域网不再误报（issue [#83](https://github.com/kinderao/dsh-pocket-relay/issues/83)） ([059163e](https://github.com/kinderao/dsh-pocket-relay/commit/059163e26457a15a9f9ce1b21aea539db9ecb803))
* **tunnel:** force HTTP/2 protocol (TCP 443) — QUIC UDP 7844 is blocked on CN/enterprise networks causing error 1033 ([c5d4814](https://github.com/kinderao/dsh-pocket-relay/commit/c5d48147832dcdb2681890516be3a88b133e0553))
* **tunnel:** include cloudflared stderr tail in exit error (issue [#65](https://github.com/kinderao/dsh-pocket-relay/issues/65)) ([a491eb0](https://github.com/kinderao/dsh-pocket-relay/commit/a491eb03d5302d1a9047ffa97037d595447dbc74))
* **tunnel:** Linux must skip Tsinghua Homebrew bottles — ELF interpreter is @@HOMEBREW_PREFIX@@ placeholder, spawn ENOENT without Homebrew (issue [#22](https://github.com/kinderao/dsh-pocket-relay/issues/22)) ([523d82a](https://github.com/kinderao/dsh-pocket-relay/commit/523d82afa3eea2dc3cdeee584ec820deac0a140b))
* **tunnel:** linux 改用裸二进制，不再下载上游已下架的 .tgz (issue [#45](https://github.com/kinderao/dsh-pocket-relay/issues/45)) ([26bdb69](https://github.com/kinderao/dsh-pocket-relay/commit/26bdb69a9dc8480c67d99bc4dba76fcdc79052e0))
* **tunnel:** resolveCloudflared also matches the manual asset filename (issue [#15](https://github.com/kinderao/dsh-pocket-relay/issues/15)) ([2359e01](https://github.com/kinderao/dsh-pocket-relay/commit/2359e01fe0a852d62b0eb9aa18e2f6acab088745))
* **tunnel:** URL regex must not match api.trycloudflare.com (issue [#32](https://github.com/kinderao/dsh-pocket-relay/issues/32)) ([3109e1b](https://github.com/kinderao/dsh-pocket-relay/commit/3109e1ba20e17a790e4eb5356ec270d9c70d0770))
* **tunnel:** 把 --no-autoupdate 移到全局位置，兼容 cloudflared 2026.x（issue [#78](https://github.com/kinderao/dsh-pocket-relay/issues/78)） ([4abc6b9](https://github.com/kinderao/dsh-pocket-relay/commit/4abc6b9f9400443bc691d52e7e13c2f7b93aee58))
* **tunnel:** 进程退出不再清除自动恢复标记，修复重启后公网隧道不自动恢复 ([#107](https://github.com/kinderao/dsh-pocket-relay/issues/107)) ([db1e5c4](https://github.com/kinderao/dsh-pocket-relay/commit/db1e5c418cae91ae1e56f4d6c5c05413ddea02c2)), closes [#11](https://github.com/kinderao/dsh-pocket-relay/issues/11) [#106](https://github.com/kinderao/dsh-pocket-relay/issues/106)
* **ui:** center the toast and narrow it to 280px ([2bcaff0](https://github.com/kinderao/dsh-pocket-relay/commit/2bcaff0a3db7847f4cc9941293026ab78b1398c4))
* **ui:** mode selector only after public access enabled; selected-state highlight; drop lan address hint ([cf6abc0](https://github.com/kinderao/dsh-pocket-relay/commit/cf6abc091ac398158e9e8213d9bddcf554b8f87a)), closes [#66](https://github.com/kinderao/dsh-pocket-relay/issues/66)
* **ui:** show only the current language half of backend error messages ([bd79283](https://github.com/kinderao/dsh-pocket-relay/commit/bd79283d5bad1888933a9fceda886204f59d450c))
* **update:** keep banner when disk updated but process not restarted (current vs loaded) ([dd8a90e](https://github.com/kinderao/dsh-pocket-relay/commit/dd8a90e1e4b9e575d5a5139a266daaad4708e5f3))
* **update:** re-check registry every 5min — CDN edge cache can serve the old 'latest' right after a release, so a page opened in that window never shows the banner ([3c60bfd](https://github.com/kinderao/dsh-pocket-relay/commit/3c60bfde5026de102e58d25a2afbc3b43fd74bf7))
* **update:** version check fetch with cache:no-store — browser was caching the registry 'latest' response, so small releases never showed the banner ([cb25fc0](https://github.com/kinderao/dsh-pocket-relay/commit/cb25fc0838376a805151e710b7b5884582e5dcdc))
* **update:** Windows spawn dsh ENOENT — shell:true (PR [#54](https://github.com/kinderao/dsh-pocket-relay/issues/54)) ([01baadd](https://github.com/kinderao/dsh-pocket-relay/commit/01baadd3ffeb1d36e53b989c80654757dfc8dbac))
* **update:** Windows spawn dsh ENOENT — use shell (PR [#54](https://github.com/kinderao/dsh-pocket-relay/issues/54)) ([82bad94](https://github.com/kinderao/dsh-pocket-relay/commit/82bad949b0a0a793e5185e6c2264e9f54d06e523))
* 移除临时访问 PIN 功能并修复撤销时的崩溃 ([238864c](https://github.com/kinderao/dsh-pocket-relay/commit/238864c92999f73b2a42c103163180053fd10c49)), closes [#69](https://github.com/kinderao/dsh-pocket-relay/issues/69)


### Features

* **auth:** custom PINs + session persistence (issue [#33](https://github.com/kinderao/dsh-pocket-relay/issues/33)) ([2830d44](https://github.com/kinderao/dsh-pocket-relay/commit/2830d44b33372ae7923a7d88b347a2c11811dce4))
* **auth:** LAN access-PIN switch, on by default (issue [#24](https://github.com/kinderao/dsh-pocket-relay/issues/24)) ([b3f33d0](https://github.com/kinderao/dsh-pocket-relay/commit/b3f33d0be8f88e7d3ba3969886c48be3916228e8))
* **auth:** mandatory security disclaimer before enabling public access (issue [#31](https://github.com/kinderao/dsh-pocket-relay/issues/31)) ([e26d5f2](https://github.com/kinderao/dsh-pocket-relay/commit/e26d5f2f6d7054df5b16b38b19128027c089d0a1))
* **auth:** optional 8-digit PIN for public tunnel access (issue [#13](https://github.com/kinderao/dsh-pocket-relay/issues/13)) ([2cbd9b8](https://github.com/kinderao/dsh-pocket-relay/commit/2cbd9b88bb31fdf88eac8fb27b202768d1f0545d))
* **auth:** separate LAN PIN with refresh button (issue [#18](https://github.com/kinderao/dsh-pocket-relay/issues/18)) ([12d5c2e](https://github.com/kinderao/dsh-pocket-relay/commit/12d5c2e17c6f2308e034cdebb23be4f9136fd52e))
* **auth:** temporary access PINs with auto-expiry (issue [#69](https://github.com/kinderao/dsh-pocket-relay/issues/69)) ([965195e](https://github.com/kinderao/dsh-pocket-relay/commit/965195e21841e3cfba719e6d6bf6424036e149ad))
* **desktop:** advanced-mode notice overlay for phone access (issue [#19](https://github.com/kinderao/dsh-pocket-relay/issues/19)) ([a3b11cd](https://github.com/kinderao/dsh-pocket-relay/commit/a3b11cd65ec8e3e542646e03369abe080378548b))
* **desktop:** detect DSH Desktop (Electron) — disable update & self-restart there, keep everything else ([40f9aae](https://github.com/kinderao/dsh-pocket-relay/commit/40f9aae5eea8c726c5e4b3f3bdef8a5b6d727062))
* dsh-pocket v0.1 — phone access to DeepSeek Harness via QR (LAN + public tunnel) ([d6dc160](https://github.com/kinderao/dsh-pocket-relay/commit/d6dc160b54592a761031efe3c7f2290a038ec66c))
* **i18n:** localize the Phone access settings tab (PR [#36](https://github.com/kinderao/dsh-pocket-relay/issues/36)) ([c3a65b2](https://github.com/kinderao/dsh-pocket-relay/commit/c3a65b2995ac570dd5eb836aadcc35804726a8f6))
* **lan:** LAN access on/off switch, on by default (PR [#61](https://github.com/kinderao/dsh-pocket-relay/issues/61)) ([2373f4b](https://github.com/kinderao/dsh-pocket-relay/commit/2373f4bcb3f93b8e8fd037919cc9d91fdeda37dd))
* **mobile:** 'expand composer' button on phone (issue [#23](https://github.com/kinderao/dsh-pocket-relay/issues/23)) ([ec6f115](https://github.com/kinderao/dsh-pocket-relay/commit/ec6f115655964fca882df1e99171cbb5fc59efab))
* **mobile:** add layout mode switch for wide-screen phones (issue [#74](https://github.com/kinderao/dsh-pocket-relay/issues/74)) ([018aef0](https://github.com/kinderao/dsh-pocket-relay/commit/018aef0db644093a13d6cb1db427655138c86799))
* **mobile:** mobile adaptation injected via proxy (rail→drawer, touch, safe-area) — only affects phone clients, desktop 3080 untouched; CSS adapted from MIT dsh-web-mobile ([22c17a7](https://github.com/kinderao/dsh-pocket-relay/commit/22c17a73c22123d9cbd025866568893aee50a8f5))
* **mobile:** port dsh-web-mobile (MIT) into the client — rail→drawer on narrow screens via ctx.layout.toggleSidebar ([15d04f2](https://github.com/kinderao/dsh-pocket-relay/commit/15d04f2910b396941dc1dc7bbdc9d216f957a44e))
* **mobile:** 文件块支持「复制内容」按钮（issue [#17](https://github.com/kinderao/dsh-pocket-relay/issues/17)），移除放大输入 ([c7351ac](https://github.com/kinderao/dsh-pocket-relay/commit/c7351acefb8f78b2c26218d812d59a648cd22c7d))
* **mobile:** 文件链接旁「复制」按钮经主机 RPC 读取正文（issue [#17](https://github.com/kinderao/dsh-pocket-relay/issues/17) 内容复制） ([06f69fd](https://github.com/kinderao/dsh-pocket-relay/commit/06f69fdef5fd1706846d433ece8bc10944549563))
* **pin:** allow 8-char alphanumeric custom PINs (letters + digits) ([527abba](https://github.com/kinderao/dsh-pocket-relay/commit/527abbac7097a4b7748180ec093f6d5f48a8ce39)), closes [#33](https://github.com/kinderao/dsh-pocket-relay/issues/33)
* **pocket:** factory reset entry at the bottom of the settings page ([672b31b](https://github.com/kinderao/dsh-pocket-relay/commit/672b31ba04083e4223c15ef1f326fab9a6e5faf7))
* **proxy:** make the proxy port configurable from settings.json (issue [#70](https://github.com/kinderao/dsh-pocket-relay/issues/70)) ([20bb1b5](https://github.com/kinderao/dsh-pocket-relay/commit/20bb1b50eaa06a0d7070e97f516cc44d3cdc475b))
* **proxy:** stream gzip/brotli for large JSON/text responses (issue [#12](https://github.com/kinderao/dsh-pocket-relay/issues/12)) ([e4172ee](https://github.com/kinderao/dsh-pocket-relay/commit/e4172eed4d6c4668fc31a2355f1515111f538a2b))
* **proxy:** 上游桌面门禁 403 forbidden 对导航请求返回可操作提示页（issue [#81](https://github.com/kinderao/dsh-pocket-relay/issues/81)） ([ff003b6](https://github.com/kinderao/dsh-pocket-relay/commit/ff003b66a63f55eebc10b4b96f06b2b1984fdc8c))
* **push:** on/off toggle — settings tab switch, persisted; notify no-op when disabled; 13 tests ([1c356be](https://github.com/kinderao/dsh-pocket-relay/commit/1c356be95ff3b7086253d0a2e3de9fbcffe7fbdc))
* **push:** Web Push notifications via web-push (VAPID) — agent done/failed → phone notification; sw route + RPC + client subscribe; 12 tests ([67f9f70](https://github.com/kinderao/dsh-pocket-relay/commit/67f9f70da5ec55c58d36a480ca0348a314fda252))
* **restart:** after self-restart show how to stop the background process ([ed0c8d5](https://github.com/kinderao/dsh-pocket-relay/commit/ed0c8d5374be41e4f7e9ab95ece7f1c3e9d19726))
* **security:** 公网会话指纹 + 链接 ephemeral 提示，防快速隧道子域复用跳陌生站点（issue [#82](https://github.com/kinderao/dsh-pocket-relay/issues/82)） ([5bfc039](https://github.com/kinderao/dsh-pocket-relay/commit/5bfc0399a1c4d6765fdc815043b6861b08ad5267))
* **security:** 移除会话指纹防钓鱼机制（issue [#82](https://github.com/kinderao/dsh-pocket-relay/issues/82)/[#83](https://github.com/kinderao/dsh-pocket-relay/issues/83) 后续） ([8f91960](https://github.com/kinderao/dsh-pocket-relay/commit/8f91960a8379ac7ec16a7c3577ff0134cb2f6204))
* **settings:** optional LAN IP override for Tailscale/VPN access (PR [#47](https://github.com/kinderao/dsh-pocket-relay/issues/47)) ([f84c136](https://github.com/kinderao/dsh-pocket-relay/commit/f84c13636b92ca20b42794babe109a60948f6104))
* **tunnel:** auto-restore public tunnel after DSH restart (issue [#11](https://github.com/kinderao/dsh-pocket-relay/issues/11)) ([93a4932](https://github.com/kinderao/dsh-pocket-relay/commit/93a49328ae7c5e074fb634174e6144c6514504ad))
* **tunnel:** honor a custom cloudflared path (issue [#45](https://github.com/kinderao/dsh-pocket-relay/issues/45)) ([b9c0c9f](https://github.com/kinderao/dsh-pocket-relay/commit/b9c0c9f0ea37aecdcf004fccfb9e0f5bfc1fd381)), closes [#proxy](https://github.com/kinderao/dsh-pocket-relay/issues/proxy)
* **tunnel:** multi-mirror cloudflared download for mainland China + Windows stop commands ([6bc558c](https://github.com/kinderao/dsh-pocket-relay/commit/6bc558cf18ab3e1cbb7cd1eeaec2f5dc8c56fab3))
* **tunnel:** named tunnel mode (fixed public hostname) + fail-closed host trust boundary ([a7bf98e](https://github.com/kinderao/dsh-pocket-relay/commit/a7bf98e54b25e59d03c6dc03c08bc2b4a74d84f5))
* **tunnel:** persistent cloudflared cache + progress phases + countdown UI; 16 tests ([3cf4f09](https://github.com/kinderao/dsh-pocket-relay/commit/3cf4f097a7758867b03acd270d0f0fa783755776))
* **tunnel:** Tsinghua mirror as fastest cloudflared source (macOS/Linux) + Windows exe path ([015a4b4](https://github.com/kinderao/dsh-pocket-relay/commit/015a4b49e3d2ddff02ebc06e9bf02145231faa5d))
* **ui:** align with official DeepSeek Harness design system + elapsed-time countdowns ([6a881b6](https://github.com/kinderao/dsh-pocket-relay/commit/6a881b6e20cea0a56e6032cf1086231f970f831a))
* **ui:** Phone access as top-level settings section (order 1, same level as General/Models/Plugins) ([bf9470a](https://github.com/kinderao/dsh-pocket-relay/commit/bf9470a1eaf587515c529ffeeb2207f1cdbff533))
* **ui:** Star-on-GitHub link under the dev credit (free star request) ([722eea4](https://github.com/kinderao/dsh-pocket-relay/commit/722eea4254b31ea49b6b57e50c1a69d4e7ca6311))
* **ui:** toast feedback after factory reset ([074744d](https://github.com/kinderao/dsh-pocket-relay/commit/074744d2524584e48de19fdc1b301e85cbd7623e))
* **update:** auto-refresh page after restart completes — no manual refresh needed ([d8bb27d](https://github.com/kinderao/dsh-pocket-relay/commit/d8bb27d3fdf301e4bb8ca041cf69c60ca7aefd65))
* **update:** in-page self-restart (dshmarket-style detached relaunch) — updates take effect without leaving the UI; credit text only; issues entry at page bottom ([2d44d68](https://github.com/kinderao/dsh-pocket-relay/commit/2d44d68340d2731c4a5a9e48e3e6ea9080a96953))
* **update:** one-click update now auto-restarts + single-state UI; apply runtime review H1/M1/M3/M4/M5 ([6afe6a2](https://github.com/kinderao/dsh-pocket-relay/commit/6afe6a2ab621759039c5a7800d75fe95bd47d662))
* **update:** refresh-page button after update completes ([e4c82b6](https://github.com/kinderao/dsh-pocket-relay/commit/e4c82b673759e4ee4674848ec5135549f5d703be))
* **update:** update banner + one-click update button (registry latest vs installed, dsh plugin update --latest); 14 tests ([4cf72ce](https://github.com/kinderao/dsh-pocket-relay/commit/4cf72ce6c8a2bc21652c8da054254c113033c795))
* v1.1.0 — minor bump for mirror-source feature; README notes Windows slow download ([2cf4375](https://github.com/kinderao/dsh-pocket-relay/commit/2cf43750e95f74c8070fd35ec9bdaf385f4ca3ca))
* web plugin — settings tab '手机访问' with in-page QR (LAN auto + public tunnel button) ([a31a04d](https://github.com/kinderao/dsh-pocket-relay/commit/a31a04dd37183a75c45a90e2ba3da5d649f8ed1d))


### Performance Improvements

* **proxy:** brotli quality 11 -> 6, 17MB JSON 41s -> ~130ms (fixes [#25](https://github.com/kinderao/dsh-pocket-relay/issues/25)) ([77b94f2](https://github.com/kinderao/dsh-pocket-relay/commit/77b94f266632248e476555ea19aab6fc6cf76fb8))


### BREAKING CHANGES

* 公网通道从 cloudflared 隧道改为自建 relay 中继；插件更名为
dsh-pocket-relay，npm 包名与 Go module 路径同步变更。

中继（新增 relay/，Go 单二进制服务端）
- 服务端从 Node 重写为 Go，静态单文件；内置 TLS、lego ACME DNS-01（腾讯云 DNSPod）、
  证书热加载与自动续期
- Web 管理端：状态、证书续期、访客 IP 白名单、按需查看 agent token
- 三监听口（agent/visitor/admin），支持 PROXY protocol

设备认证（替代共享 PIN 的远程通道）
- 每台设备独立凭据，可单独撤销；token 只存 SHA-256，设备密码用 scrypt
- 内存态一次性配对码、渐进式锁定、空闲会话仅由真实用户输入续期

多 PC 端共存与热备
- 按 agent 名区分机器；首选优先，掉线/假死时兜底到注册最早的备机
- 管理端可切首选、断开（自动重连）、禁止接入（agent-blocked）
- 修复：PC 侧 agent 名此前固定为 default，导致两台电脑互相顶下线

其他
- 客户端设置页新增「本机名称」，留空按主机名派生
- npm 包瘦身：files 移除 relay/（31MB 服务端二进制不属于插件运行时），
  17.40 MB -> 0.20 MB
- 更名 dsh-pocket-relay：package/cordis patch/bin/Go module/README/文档；
  保留 dsh-pocket bin 别名与 $DSH_HOME/dsh-pocket 数据目录以兼容既有安装
- 新增发布与上架指南（docs/发布与上架指南.md）

测试：npm 259 用例（257 通过，2 个为既有 Windows 环境问题）；Go 4 包全绿
* the settings page DOM structure and locale keys changed
(lanAddressHint removed; wanAccess/pinLabel/modeLabel/advAddress/
wanOffHint added). Custom styles or scripts targeting the old settings
DOM/keys need updating.

## [1.0.1](https://github.com/kinderao/dsh-pocket-relay/compare/v1.0.0...v1.0.1) (2026-09-13)


### Bug Fixes

* **build:** --all 的发布矩阵必须是固定三平台，不能拿 localGoos 顶替 ([d38a9ec](https://github.com/kinderao/dsh-pocket-relay/commit/d38a9ec13daf14102d2723bb2874897dfea10848)), closes [#2](https://github.com/kinderao/dsh-pocket-relay/issues/2)
* **release:** 补发 npm 包并修正 Windows 发布资产 ([3d25a9b](https://github.com/kinderao/dsh-pocket-relay/commit/3d25a9bc59de581a58670de5ca40cb9de752f127)), closes [#1](https://github.com/kinderao/dsh-pocket-relay/issues/1) [#2](https://github.com/kinderao/dsh-pocket-relay/issues/2)

# 1.0.0 (2026-09-13)


* feat!: redesign settings page layout into structured cards ([1b7d494](https://github.com/kinderao/dsh-pocket-relay/commit/1b7d494554ed80eadd701c1e2574760ff130580c))
* feat!: 自建 Go relay 中继（替代 cloudflared）+ 设备认证 + 多 PC 端共存/热备 ([b282e1d](https://github.com/kinderao/dsh-pocket-relay/commit/b282e1d9497e9c0c9ad21ea64075629f9c8e5605))


### Bug Fixes

* **audit:** full review round — push state, proxy gzip/WS, tunnel single-flight, restart port-wait ([eb9ad5e](https://github.com/kinderao/dsh-pocket-relay/commit/eb9ad5e4bd651d008fd4da862f77b799edf37d2e))
* **auth:** login page copy adapts to LAN vs public source ([e31f022](https://github.com/kinderao/dsh-pocket-relay/commit/e31f022053c8ffa7205b569c99bbfb0e74b34b3b))
* **auth:** login rate limiting — anti brute-force (issue [#40](https://github.com/kinderao/dsh-pocket-relay/issues/40)) ([8f685d5](https://github.com/kinderao/dsh-pocket-relay/commit/8f685d556f2b58ee3d963643b2d2c9b38c8717fa))
* **auth:** Tailscale/CGNAT(100.64/10) 与手动局域网地址覆盖走局域网密码（issue [#79](https://github.com/kinderao/dsh-pocket-relay/issues/79)） ([e3c2e7b](https://github.com/kinderao/dsh-pocket-relay/commit/e3c2e7b97700b375bdc17a68ed3523588796ba21)), closes [#66](https://github.com/kinderao/dsh-pocket-relay/issues/66)
* **build,test:** --all 同步产出本机无后缀二进制；版本断言不再写死 ([77a6cc0](https://github.com/kinderao/dsh-pocket-relay/commit/77a6cc036ed0e5706b8fc57792b397edda52f065))
* **ci:** drop setup-node registry-url to avoid .npmrc conflict with semantic-release ([bb41482](https://github.com/kinderao/dsh-pocket-relay/commit/bb41482cf499533741cd22a28b5004be253d4f4f))
* **cli:** Ctrl+C now fully exits (kill tunnel + close proxy + process.exit) — previously it only stopped the tunnel and hung ([6d11f1f](https://github.com/kinderao/dsh-pocket-relay/commit/6d11f1f3d14fa8ea66e045fb9fe7d19b5251edf5))
* **client:** bind React in the client bundle so mobile components render ([1838fb9](https://github.com/kinderao/dsh-pocket-relay/commit/1838fb9ec2442f5eb2cdd4ebf0eaac6cc1565451))
* **client:** LAN switch row crashed on first render (status=null) — 1.9.0 white screen ([9cffedd](https://github.com/kinderao/dsh-pocket-relay/commit/9cffedd6ed0986fecead77ce13641f9cf357f291))
* **client:** prevent iOS Safari input auto-zoom on mobile ([8d5b3fa](https://github.com/kinderao/dsh-pocket-relay/commit/8d5b3fa1a14385816e61f92bd83fb239f7d8e74f)), closes [#114](https://github.com/kinderao/dsh-pocket-relay/issues/114)
* **client:** 修复深色主题下主按钮文字看不清的问题 ([dd61530](https://github.com/kinderao/dsh-pocket-relay/commit/dd615307901b258afca45e242360f89beadd8903)), closes [#fff](https://github.com/kinderao/dsh-pocket-relay/issues/fff)
* **client:** 补上 MobileComposerFullscreen 缺的 import（P0） ([a71319d](https://github.com/kinderao/dsh-pocket-relay/commit/a71319dd66f6b3e70a8f904ce3dca236e6615dbd))
* **desktop:** inject dsh-desktop-mode/platform into proxied HTML when host runs in DSH Desktop — phone scanning a desktop profile crashed with 'invalid or missing dsh-desktop-mode null' (issue [#3](https://github.com/kinderao/dsh-pocket-relay/issues/3)/[#4](https://github.com/kinderao/dsh-pocket-relay/issues/4)) ([a9cb5a3](https://github.com/kinderao/dsh-pocket-relay/commit/a9cb5a3eff0545409d0060f25b8744ec1c559fa3))
* **desktop:** stop injecting dsh-desktop-* markers into proxied pages ([17c2d97](https://github.com/kinderao/dsh-pocket-relay/commit/17c2d97e6c2da5951a11e171efdd1e436184b04c)), closes [3/#4](https://github.com/kinderao/dsh-pocket-relay/issues/4)
* **docs:** 在 README 中添加 Trendshift badge ([ffe894e](https://github.com/kinderao/dsh-pocket-relay/commit/ffe894e842867d4ef297e80d47011c6377d583e7))
* ESM require is not defined in push.mjs — use createRequire (boot crash); regression test with real web-push ([c6b824e](https://github.com/kinderao/dsh-pocket-relay/commit/c6b824e94fb770a12ee5e9a0a7b1efc09eab6e41))
* forward WS upgrade head with the request + schema-compliant RPC errors ([62138ba](https://github.com/kinderao/dsh-pocket-relay/commit/62138baae76e94c05cd7f6c1a0275f4e5d3849af))
* LAN QR code should prefer a phone-reachable private IPv4 ([da7c642](https://github.com/kinderao/dsh-pocket-relay/commit/da7c6428c7a5628f61b5a2c5ca43c511dd48af19))
* **lan:** drop WSLENV from WSL detection (PR [#62](https://github.com/kinderao/dsh-pocket-relay/issues/62)) ([383f2d2](https://github.com/kinderao/dsh-pocket-relay/commit/383f2d24a62cc79ce0ccb42b1035a796a1ddc972))
* **lan:** Easytier vs renamed physical NIC tie-break (issue [#43](https://github.com/kinderao/dsh-pocket-relay/issues/43)) ([d0c7fba](https://github.com/kinderao/dsh-pocket-relay/commit/d0c7fbab8893a0ffa568fb2205c91511701fa0e5))
* **lan:** WSL LAN IP detection (issue [#39](https://github.com/kinderao/dsh-pocket-relay/issues/39)) ([52b5c94](https://github.com/kinderao/dsh-pocket-relay/commit/52b5c949d5b861229920e6f22e102e117f2f0354))
* **mobile:** center column pulled back to track 1 — phone showed only the background (issue [#5](https://github.com/kinderao/dsh-pocket-relay/issues/5)) ([fc04b20](https://github.com/kinderao/dsh-pocket-relay/commit/fc04b201341e37bcbacc59c8f4ff10946a1c3339))
* **mobile:** drawer backdrop steals taps on session rows (issue [#38](https://github.com/kinderao/dsh-pocket-relay/issues/38)) ([ca0d8ab](https://github.com/kinderao/dsh-pocket-relay/commit/ca0d8ab0fefdcc06420ddbb7b4ffe936c79d98c2))
* **mobile:** drawer z-index 40 -> 600 (PR [#42](https://github.com/kinderao/dsh-pocket-relay/issues/42)) + release v1.11.3 ([f3560a4](https://github.com/kinderao/dsh-pocket-relay/commit/f3560a4db7990042cc9300a3030e62fe527d980a)), closes [#38](https://github.com/kinderao/dsh-pocket-relay/issues/38)
* **mobile:** hide Files entries when host lacks aionui explorer (issue [#48](https://github.com/kinderao/dsh-pocket-relay/issues/48)) ([60abc12](https://github.com/kinderao/dsh-pocket-relay/commit/60abc121e91af1a2412eb1a061c878c24ab13aa2))
* **mobile:** raise drawer above shell overlay raised by third-party plugins (PR [#42](https://github.com/kinderao/dsh-pocket-relay/issues/42)) ([cbd6822](https://github.com/kinderao/dsh-pocket-relay/commit/cbd68227975848a329a56dee721d702ee18c2441))
* **mobile:** restore compact usable composer ([#89](https://github.com/kinderao/dsh-pocket-relay/issues/89)) ([#93](https://github.com/kinderao/dsh-pocket-relay/issues/93)) ([5c56d24](https://github.com/kinderao/dsh-pocket-relay/commit/5c56d24c2953022c4300973627dae4d3aebcfbb2))
* **mobile:** snap composer popups to viewport sheet; scroll containers clipped them half-visible on phones ([#88](https://github.com/kinderao/dsh-pocket-relay/issues/88)) ([7209de8](https://github.com/kinderao/dsh-pocket-relay/commit/7209de8540cf324dd578b18f10bec6b1ff8ea3c4))
* **mobile:** 侧边栏先开后弹出 aria-modal 弹窗时自动收起，修复卡死 ([#99](https://github.com/kinderao/dsh-pocket-relay/issues/99)) ([f2e60b0](https://github.com/kinderao/dsh-pocket-relay/commit/f2e60b0eb03ac1b065788e231590a56316a7cfcf))
* **mobile:** 去掉 isInsidePocket 误杀，让对话文件链接在手机上弹提示并注入复制按钮（issue [#17](https://github.com/kinderao/dsh-pocket-relay/issues/17)） ([5fca020](https://github.com/kinderao/dsh-pocket-relay/commit/5fca0202623df513e11b4654868210f287ea6ffd))
* **mobile:** 抽屉层级压过 dsh-web-ui-all 的全屏遮罩 (issue [#67](https://github.com/kinderao/dsh-pocket-relay/issues/67)) ([88605d9](https://github.com/kinderao/dsh-pocket-relay/commit/88605d93a145af61e345f91b96db2850bb8f1e56))
* **mobile:** 抽屉里的工作区菜单点不动，并给 iOS 触摸加自愈 (issue [#72](https://github.com/kinderao/dsh-pocket-relay/issues/72)) ([9f7c427](https://github.com/kinderao/dsh-pocket-relay/commit/9f7c4279049c499f2f33b6ded45f2bd92625b476))
* **mobile:** 替换手机端模型设置加载失败提示为引导信息，增加本地真机冒烟测试 ([5ab2ad4](https://github.com/kinderao/dsh-pocket-relay/commit/5ab2ad444ba276c5df2bf87fa104c4b16b2081f9))
* **mobile:** 移动端拦截文件链接点击改提示、隐藏添加工作区，移除冗余复制按钮（issue [#17](https://github.com/kinderao/dsh-pocket-relay/issues/17)） ([96ed896](https://github.com/kinderao/dsh-pocket-relay/commit/96ed896201045b009068b198e6f5f444a43cfb23))
* **mobile:** 触摸切换会话等宿主完成导航后再关抽屉 ([#85](https://github.com/kinderao/dsh-pocket-relay/issues/85)) ([80b9d16](https://github.com/kinderao/dsh-pocket-relay/commit/80b9d16369e3e33457afe8d9c1a48dfa42dc4397)), closes [#84](https://github.com/kinderao/dsh-pocket-relay/issues/84)
* **proxy:** attach error handler to upstream WS socket (PR [#49](https://github.com/kinderao/dsh-pocket-relay/issues/49)) ([a1d92c0](https://github.com/kinderao/dsh-pocket-relay/commit/a1d92c081b471c48f68e0493a6b3aedfa0ded3a3))
* **proxy:** auto-fallback port on EADDRINUSE (desktop + web both bind 3081); drop the desktop hint line ([12b74d0](https://github.com/kinderao/dsh-pocket-relay/commit/12b74d0d421bd8000a135c8b18bc2b5242b90ab7))
* **proxy:** complete the dsh web browser-session handshake (issue [#77](https://github.com/kinderao/dsh-pocket-relay/issues/77)) ([ffc12dd](https://github.com/kinderao/dsh-pocket-relay/commit/ffc12ddfcd2113ee4ba80424b2346efee85c0c0f))
* **proxy:** destroy WS peers on FIN to avoid half-open slot leak (PR [#56](https://github.com/kinderao/dsh-pocket-relay/issues/56)) ([4ba5bd7](https://github.com/kinderao/dsh-pocket-relay/commit/4ba5bd7d8584a8d73df396d8fcbf92ab2876229d))
* **proxy:** location shim Proxy binds all methods (issue: session display regression) ([db7763d](https://github.com/kinderao/dsh-pocket-relay/commit/db7763d923295d039668870eeca066c538e89e73))
* **proxy:** location.hostname shim — LAN settings unavailable (issue [#58](https://github.com/kinderao/dsh-pocket-relay/issues/58)) ([cc5a2ea](https://github.com/kinderao/dsh-pocket-relay/commit/cc5a2eaa6bd4df0641bac856bc6243bc4fa9496d))
* **proxy:** loopback trust patch so remote browsers can load settings (issue [#58](https://github.com/kinderao/dsh-pocket-relay/issues/58)) ([#87](https://github.com/kinderao/dsh-pocket-relay/issues/87)) ([1d67152](https://github.com/kinderao/dsh-pocket-relay/commit/1d67152a8a1808d36743162ff24abe3a061cedcd))
* **proxy:** polyfill AbortSignal.any for Android WebView (issue [#53](https://github.com/kinderao/dsh-pocket-relay/issues/53)) ([472524a](https://github.com/kinderao/dsh-pocket-relay/commit/472524a45ef7b1ff6fbd9c3bf50787680a5497c3))
* **proxy:** revert location.hostname shim (session list regression) ([13e52db](https://github.com/kinderao/dsh-pocket-relay/commit/13e52db3ece072a17ee76fcd5125cebd66c809eb))
* **proxy:** shim transport.createApiClient for dsh 0.1.1-rc.2 (issue [#96](https://github.com/kinderao/dsh-pocket-relay/issues/96)) ([61cadf8](https://github.com/kinderao/dsh-pocket-relay/commit/61cadf871ec817f51135277b7fb3085d9492959e))
* **proxy:** support `?token=<raw pin>` and seed the auth cookie (issue [#35](https://github.com/kinderao/dsh-pocket-relay/issues/35)) ([734afbd](https://github.com/kinderao/dsh-pocket-relay/commit/734afbdb800ed4b2a1d4dff085cdf2ef074917db))
* **proxy:** upstream WS socket error handler (PR [#49](https://github.com/kinderao/dsh-pocket-relay/issues/49)) ([298aff6](https://github.com/kinderao/dsh-pocket-relay/commit/298aff60abab16f1e841d141534c53c81ca7b3e8))
* **proxy:** WebSocket heartbeat keep-alive (PR [#41](https://github.com/kinderao/dsh-pocket-relay/issues/41), issue [#29](https://github.com/kinderao/dsh-pocket-relay/issues/29)) ([5328159](https://github.com/kinderao/dsh-pocket-relay/commit/53281595d6d8a7a47a0384e212bf9bd1f44f1fdc))
* **proxy:** WS half-open leak — teardown on end + end:false + upstream resetAndDestroy (PR [#56](https://github.com/kinderao/dsh-pocket-relay/issues/56)) ([4c2c358](https://github.com/kinderao/dsh-pocket-relay/commit/4c2c3585857e238f0c1dbbe14a4daf68263744fd))
* **proxy:** 打断 Safari 局域网入口的 303 无限重定向（issue [#91](https://github.com/kinderao/dsh-pocket-relay/issues/91)） ([4dd4c01](https://github.com/kinderao/dsh-pocket-relay/commit/4dd4c017d5ad4b11ac003058dbda1d8d6507f079))
* **proxy:** 移除与 DSH Desktop 2.0.4+ 不兼容的 LOOPBACK_ENV_PATCH，修复远程/手机访问白屏 ([#105](https://github.com/kinderao/dsh-pocket-relay/issues/105)) ([a1b813d](https://github.com/kinderao/dsh-pocket-relay/commit/a1b813d854da5900b55c5893f3190a272cd4a0fc)), closes [#100](https://github.com/kinderao/dsh-pocket-relay/issues/100) [#58](https://github.com/kinderao/dsh-pocket-relay/issues/58)
* **proxy:** 转发前清掉历史遗留的 dsh-desktop-* 参数 (issue [#75](https://github.com/kinderao/dsh-pocket-relay/issues/75)) ([8979594](https://github.com/kinderao/dsh-pocket-relay/commit/89795940e2aeb28675b79a1541862331fe3aef5f))
* **release:** restore fixes missing from 1.0.21-1.0.25 npm tarballs + merge PR [#1](https://github.com/kinderao/dsh-pocket-relay/issues/1) React binding ([f9031a4](https://github.com/kinderao/dsh-pocket-relay/commit/f9031a47f8ab501c80efb40fc1ffbe56d4afa087))
* **restart:** await readFile in readRestartNotice — missing await caused unhandled rejection crashing dsh web on boot (ENOENT restarted.json) ([3267ef2](https://github.com/kinderao/dsh-pocket-relay/commit/3267ef224b79bc7acb991bdb8879549ee1b9b1e9))
* **restart:** consume restarted.json after first read — '已重启' banner shows once, not on every page load (stale marker kept re-showing it) ([82cebd6](https://github.com/kinderao/dsh-pocket-relay/commit/82cebd6bd3e5c84abee4ea5dee794d43bab655f8))
* **restart:** pocketRestart referenced apply's internals — ReferenceError on restart button (showed as 'update failed') ([b4c54e9](https://github.com/kinderao/dsh-pocket-relay/commit/b4c54e96fec9afbe16c30f70ea92e36c3acbd53e))
* **rpc:** lan.setOverride returns full status (PR [#47](https://github.com/kinderao/dsh-pocket-relay/issues/47)) ([a328f8b](https://github.com/kinderao/dsh-pocket-relay/commit/a328f8bb69146a03ae97d6b56422b37cb489af5d))
* **rpc:** 以方法形式调用 requestRejection 保留 this 绑定，修复 /dsh-pocket/* 全部 403（issue [#117](https://github.com/kinderao/dsh-pocket-relay/issues/117)） ([282f71c](https://github.com/kinderao/dsh-pocket-relay/commit/282f71c1d844b0e6123b9c976ad0401c3c4a84e7))
* **rpc:** 适配 dsh v0.1.5-alpha.1 的 webServer inject 收缩，堵住启动崩溃 ([#112](https://github.com/kinderao/dsh-pocket-relay/issues/112)) ([2ac8efd](https://github.com/kinderao/dsh-pocket-relay/commit/2ac8efdb46de19959c1fc59eeddf2f12b42cb909)), closes [#109](https://github.com/kinderao/dsh-pocket-relay/issues/109) [#113](https://github.com/kinderao/dsh-pocket-relay/issues/113) [#111](https://github.com/kinderao/dsh-pocket-relay/issues/111)
* **security:** CLI 模式默认开启访问密码，堵住 0.0.0.0 上的无认证访问（issue [#90](https://github.com/kinderao/dsh-pocket-relay/issues/90) [#8](https://github.com/kinderao/dsh-pocket-relay/issues/8)） ([5d3a6d0](https://github.com/kinderao/dsh-pocket-relay/commit/5d3a6d03e4e1c4fe84626fd3dfd7a4fec28641cc))
* **security:** 堵住 ?token=/WS 的限速旁路，PIN 改 CSPRNG，Host 头伪造按源地址收紧（issue [#90](https://github.com/kinderao/dsh-pocket-relay/issues/90)） ([0bfe15a](https://github.com/kinderao/dsh-pocket-relay/commit/0bfe15a56c2063e14f1eea5de2ef0cd4e1e54b0d))
* **security:** 收紧限速身份键与登录比较，修隧道失败态残留，移除已删功能的 README 残留 ([517eb00](https://github.com/kinderao/dsh-pocket-relay/commit/517eb004ce869f5e140159dfa118ab833a37fd6c)), closes [#69](https://github.com/kinderao/dsh-pocket-relay/issues/69)
* **security:** 防钓鱼校验只在公网启用，局域网不再误报（issue [#83](https://github.com/kinderao/dsh-pocket-relay/issues/83)） ([059163e](https://github.com/kinderao/dsh-pocket-relay/commit/059163e26457a15a9f9ce1b21aea539db9ecb803))
* **tunnel:** force HTTP/2 protocol (TCP 443) — QUIC UDP 7844 is blocked on CN/enterprise networks causing error 1033 ([c5d4814](https://github.com/kinderao/dsh-pocket-relay/commit/c5d48147832dcdb2681890516be3a88b133e0553))
* **tunnel:** include cloudflared stderr tail in exit error (issue [#65](https://github.com/kinderao/dsh-pocket-relay/issues/65)) ([a491eb0](https://github.com/kinderao/dsh-pocket-relay/commit/a491eb03d5302d1a9047ffa97037d595447dbc74))
* **tunnel:** Linux must skip Tsinghua Homebrew bottles — ELF interpreter is @@HOMEBREW_PREFIX@@ placeholder, spawn ENOENT without Homebrew (issue [#22](https://github.com/kinderao/dsh-pocket-relay/issues/22)) ([523d82a](https://github.com/kinderao/dsh-pocket-relay/commit/523d82afa3eea2dc3cdeee584ec820deac0a140b))
* **tunnel:** linux 改用裸二进制，不再下载上游已下架的 .tgz (issue [#45](https://github.com/kinderao/dsh-pocket-relay/issues/45)) ([26bdb69](https://github.com/kinderao/dsh-pocket-relay/commit/26bdb69a9dc8480c67d99bc4dba76fcdc79052e0))
* **tunnel:** resolveCloudflared also matches the manual asset filename (issue [#15](https://github.com/kinderao/dsh-pocket-relay/issues/15)) ([2359e01](https://github.com/kinderao/dsh-pocket-relay/commit/2359e01fe0a852d62b0eb9aa18e2f6acab088745))
* **tunnel:** URL regex must not match api.trycloudflare.com (issue [#32](https://github.com/kinderao/dsh-pocket-relay/issues/32)) ([3109e1b](https://github.com/kinderao/dsh-pocket-relay/commit/3109e1ba20e17a790e4eb5356ec270d9c70d0770))
* **tunnel:** 把 --no-autoupdate 移到全局位置，兼容 cloudflared 2026.x（issue [#78](https://github.com/kinderao/dsh-pocket-relay/issues/78)） ([4abc6b9](https://github.com/kinderao/dsh-pocket-relay/commit/4abc6b9f9400443bc691d52e7e13c2f7b93aee58))
* **tunnel:** 进程退出不再清除自动恢复标记，修复重启后公网隧道不自动恢复 ([#107](https://github.com/kinderao/dsh-pocket-relay/issues/107)) ([db1e5c4](https://github.com/kinderao/dsh-pocket-relay/commit/db1e5c418cae91ae1e56f4d6c5c05413ddea02c2)), closes [#11](https://github.com/kinderao/dsh-pocket-relay/issues/11) [#106](https://github.com/kinderao/dsh-pocket-relay/issues/106)
* **ui:** center the toast and narrow it to 280px ([2bcaff0](https://github.com/kinderao/dsh-pocket-relay/commit/2bcaff0a3db7847f4cc9941293026ab78b1398c4))
* **ui:** mode selector only after public access enabled; selected-state highlight; drop lan address hint ([cf6abc0](https://github.com/kinderao/dsh-pocket-relay/commit/cf6abc091ac398158e9e8213d9bddcf554b8f87a)), closes [#66](https://github.com/kinderao/dsh-pocket-relay/issues/66)
* **ui:** show only the current language half of backend error messages ([bd79283](https://github.com/kinderao/dsh-pocket-relay/commit/bd79283d5bad1888933a9fceda886204f59d450c))
* **update:** keep banner when disk updated but process not restarted (current vs loaded) ([dd8a90e](https://github.com/kinderao/dsh-pocket-relay/commit/dd8a90e1e4b9e575d5a5139a266daaad4708e5f3))
* **update:** re-check registry every 5min — CDN edge cache can serve the old 'latest' right after a release, so a page opened in that window never shows the banner ([3c60bfd](https://github.com/kinderao/dsh-pocket-relay/commit/3c60bfde5026de102e58d25a2afbc3b43fd74bf7))
* **update:** version check fetch with cache:no-store — browser was caching the registry 'latest' response, so small releases never showed the banner ([cb25fc0](https://github.com/kinderao/dsh-pocket-relay/commit/cb25fc0838376a805151e710b7b5884582e5dcdc))
* **update:** Windows spawn dsh ENOENT — shell:true (PR [#54](https://github.com/kinderao/dsh-pocket-relay/issues/54)) ([01baadd](https://github.com/kinderao/dsh-pocket-relay/commit/01baadd3ffeb1d36e53b989c80654757dfc8dbac))
* **update:** Windows spawn dsh ENOENT — use shell (PR [#54](https://github.com/kinderao/dsh-pocket-relay/issues/54)) ([82bad94](https://github.com/kinderao/dsh-pocket-relay/commit/82bad949b0a0a793e5185e6c2264e9f54d06e523))
* 移除临时访问 PIN 功能并修复撤销时的崩溃 ([238864c](https://github.com/kinderao/dsh-pocket-relay/commit/238864c92999f73b2a42c103163180053fd10c49)), closes [#69](https://github.com/kinderao/dsh-pocket-relay/issues/69)


### Features

* **auth:** custom PINs + session persistence (issue [#33](https://github.com/kinderao/dsh-pocket-relay/issues/33)) ([2830d44](https://github.com/kinderao/dsh-pocket-relay/commit/2830d44b33372ae7923a7d88b347a2c11811dce4))
* **auth:** LAN access-PIN switch, on by default (issue [#24](https://github.com/kinderao/dsh-pocket-relay/issues/24)) ([b3f33d0](https://github.com/kinderao/dsh-pocket-relay/commit/b3f33d0be8f88e7d3ba3969886c48be3916228e8))
* **auth:** mandatory security disclaimer before enabling public access (issue [#31](https://github.com/kinderao/dsh-pocket-relay/issues/31)) ([e26d5f2](https://github.com/kinderao/dsh-pocket-relay/commit/e26d5f2f6d7054df5b16b38b19128027c089d0a1))
* **auth:** optional 8-digit PIN for public tunnel access (issue [#13](https://github.com/kinderao/dsh-pocket-relay/issues/13)) ([2cbd9b8](https://github.com/kinderao/dsh-pocket-relay/commit/2cbd9b88bb31fdf88eac8fb27b202768d1f0545d))
* **auth:** separate LAN PIN with refresh button (issue [#18](https://github.com/kinderao/dsh-pocket-relay/issues/18)) ([12d5c2e](https://github.com/kinderao/dsh-pocket-relay/commit/12d5c2e17c6f2308e034cdebb23be4f9136fd52e))
* **auth:** temporary access PINs with auto-expiry (issue [#69](https://github.com/kinderao/dsh-pocket-relay/issues/69)) ([965195e](https://github.com/kinderao/dsh-pocket-relay/commit/965195e21841e3cfba719e6d6bf6424036e149ad))
* **desktop:** advanced-mode notice overlay for phone access (issue [#19](https://github.com/kinderao/dsh-pocket-relay/issues/19)) ([a3b11cd](https://github.com/kinderao/dsh-pocket-relay/commit/a3b11cd65ec8e3e542646e03369abe080378548b))
* **desktop:** detect DSH Desktop (Electron) — disable update & self-restart there, keep everything else ([40f9aae](https://github.com/kinderao/dsh-pocket-relay/commit/40f9aae5eea8c726c5e4b3f3bdef8a5b6d727062))
* dsh-pocket v0.1 — phone access to DeepSeek Harness via QR (LAN + public tunnel) ([d6dc160](https://github.com/kinderao/dsh-pocket-relay/commit/d6dc160b54592a761031efe3c7f2290a038ec66c))
* **i18n:** localize the Phone access settings tab (PR [#36](https://github.com/kinderao/dsh-pocket-relay/issues/36)) ([c3a65b2](https://github.com/kinderao/dsh-pocket-relay/commit/c3a65b2995ac570dd5eb836aadcc35804726a8f6))
* **lan:** LAN access on/off switch, on by default (PR [#61](https://github.com/kinderao/dsh-pocket-relay/issues/61)) ([2373f4b](https://github.com/kinderao/dsh-pocket-relay/commit/2373f4bcb3f93b8e8fd037919cc9d91fdeda37dd))
* **mobile:** 'expand composer' button on phone (issue [#23](https://github.com/kinderao/dsh-pocket-relay/issues/23)) ([ec6f115](https://github.com/kinderao/dsh-pocket-relay/commit/ec6f115655964fca882df1e99171cbb5fc59efab))
* **mobile:** add layout mode switch for wide-screen phones (issue [#74](https://github.com/kinderao/dsh-pocket-relay/issues/74)) ([018aef0](https://github.com/kinderao/dsh-pocket-relay/commit/018aef0db644093a13d6cb1db427655138c86799))
* **mobile:** mobile adaptation injected via proxy (rail→drawer, touch, safe-area) — only affects phone clients, desktop 3080 untouched; CSS adapted from MIT dsh-web-mobile ([22c17a7](https://github.com/kinderao/dsh-pocket-relay/commit/22c17a73c22123d9cbd025866568893aee50a8f5))
* **mobile:** port dsh-web-mobile (MIT) into the client — rail→drawer on narrow screens via ctx.layout.toggleSidebar ([15d04f2](https://github.com/kinderao/dsh-pocket-relay/commit/15d04f2910b396941dc1dc7bbdc9d216f957a44e))
* **mobile:** 文件块支持「复制内容」按钮（issue [#17](https://github.com/kinderao/dsh-pocket-relay/issues/17)），移除放大输入 ([c7351ac](https://github.com/kinderao/dsh-pocket-relay/commit/c7351acefb8f78b2c26218d812d59a648cd22c7d))
* **mobile:** 文件链接旁「复制」按钮经主机 RPC 读取正文（issue [#17](https://github.com/kinderao/dsh-pocket-relay/issues/17) 内容复制） ([06f69fd](https://github.com/kinderao/dsh-pocket-relay/commit/06f69fdef5fd1706846d433ece8bc10944549563))
* **pin:** allow 8-char alphanumeric custom PINs (letters + digits) ([527abba](https://github.com/kinderao/dsh-pocket-relay/commit/527abbac7097a4b7748180ec093f6d5f48a8ce39)), closes [#33](https://github.com/kinderao/dsh-pocket-relay/issues/33)
* **pocket:** factory reset entry at the bottom of the settings page ([672b31b](https://github.com/kinderao/dsh-pocket-relay/commit/672b31ba04083e4223c15ef1f326fab9a6e5faf7))
* **proxy:** make the proxy port configurable from settings.json (issue [#70](https://github.com/kinderao/dsh-pocket-relay/issues/70)) ([20bb1b5](https://github.com/kinderao/dsh-pocket-relay/commit/20bb1b50eaa06a0d7070e97f516cc44d3cdc475b))
* **proxy:** stream gzip/brotli for large JSON/text responses (issue [#12](https://github.com/kinderao/dsh-pocket-relay/issues/12)) ([e4172ee](https://github.com/kinderao/dsh-pocket-relay/commit/e4172eed4d6c4668fc31a2355f1515111f538a2b))
* **proxy:** 上游桌面门禁 403 forbidden 对导航请求返回可操作提示页（issue [#81](https://github.com/kinderao/dsh-pocket-relay/issues/81)） ([ff003b6](https://github.com/kinderao/dsh-pocket-relay/commit/ff003b66a63f55eebc10b4b96f06b2b1984fdc8c))
* **push:** on/off toggle — settings tab switch, persisted; notify no-op when disabled; 13 tests ([1c356be](https://github.com/kinderao/dsh-pocket-relay/commit/1c356be95ff3b7086253d0a2e3de9fbcffe7fbdc))
* **push:** Web Push notifications via web-push (VAPID) — agent done/failed → phone notification; sw route + RPC + client subscribe; 12 tests ([67f9f70](https://github.com/kinderao/dsh-pocket-relay/commit/67f9f70da5ec55c58d36a480ca0348a314fda252))
* **restart:** after self-restart show how to stop the background process ([ed0c8d5](https://github.com/kinderao/dsh-pocket-relay/commit/ed0c8d5374be41e4f7e9ab95ece7f1c3e9d19726))
* **security:** 公网会话指纹 + 链接 ephemeral 提示，防快速隧道子域复用跳陌生站点（issue [#82](https://github.com/kinderao/dsh-pocket-relay/issues/82)） ([5bfc039](https://github.com/kinderao/dsh-pocket-relay/commit/5bfc0399a1c4d6765fdc815043b6861b08ad5267))
* **security:** 移除会话指纹防钓鱼机制（issue [#82](https://github.com/kinderao/dsh-pocket-relay/issues/82)/[#83](https://github.com/kinderao/dsh-pocket-relay/issues/83) 后续） ([8f91960](https://github.com/kinderao/dsh-pocket-relay/commit/8f91960a8379ac7ec16a7c3577ff0134cb2f6204))
* **settings:** optional LAN IP override for Tailscale/VPN access (PR [#47](https://github.com/kinderao/dsh-pocket-relay/issues/47)) ([f84c136](https://github.com/kinderao/dsh-pocket-relay/commit/f84c13636b92ca20b42794babe109a60948f6104))
* **tunnel:** auto-restore public tunnel after DSH restart (issue [#11](https://github.com/kinderao/dsh-pocket-relay/issues/11)) ([93a4932](https://github.com/kinderao/dsh-pocket-relay/commit/93a49328ae7c5e074fb634174e6144c6514504ad))
* **tunnel:** honor a custom cloudflared path (issue [#45](https://github.com/kinderao/dsh-pocket-relay/issues/45)) ([b9c0c9f](https://github.com/kinderao/dsh-pocket-relay/commit/b9c0c9f0ea37aecdcf004fccfb9e0f5bfc1fd381)), closes [#proxy](https://github.com/kinderao/dsh-pocket-relay/issues/proxy)
* **tunnel:** multi-mirror cloudflared download for mainland China + Windows stop commands ([6bc558c](https://github.com/kinderao/dsh-pocket-relay/commit/6bc558cf18ab3e1cbb7cd1eeaec2f5dc8c56fab3))
* **tunnel:** named tunnel mode (fixed public hostname) + fail-closed host trust boundary ([a7bf98e](https://github.com/kinderao/dsh-pocket-relay/commit/a7bf98e54b25e59d03c6dc03c08bc2b4a74d84f5))
* **tunnel:** persistent cloudflared cache + progress phases + countdown UI; 16 tests ([3cf4f09](https://github.com/kinderao/dsh-pocket-relay/commit/3cf4f097a7758867b03acd270d0f0fa783755776))
* **tunnel:** Tsinghua mirror as fastest cloudflared source (macOS/Linux) + Windows exe path ([015a4b4](https://github.com/kinderao/dsh-pocket-relay/commit/015a4b49e3d2ddff02ebc06e9bf02145231faa5d))
* **ui:** align with official DeepSeek Harness design system + elapsed-time countdowns ([6a881b6](https://github.com/kinderao/dsh-pocket-relay/commit/6a881b6e20cea0a56e6032cf1086231f970f831a))
* **ui:** Phone access as top-level settings section (order 1, same level as General/Models/Plugins) ([bf9470a](https://github.com/kinderao/dsh-pocket-relay/commit/bf9470a1eaf587515c529ffeeb2207f1cdbff533))
* **ui:** Star-on-GitHub link under the dev credit (free star request) ([722eea4](https://github.com/kinderao/dsh-pocket-relay/commit/722eea4254b31ea49b6b57e50c1a69d4e7ca6311))
* **ui:** toast feedback after factory reset ([074744d](https://github.com/kinderao/dsh-pocket-relay/commit/074744d2524584e48de19fdc1b301e85cbd7623e))
* **update:** auto-refresh page after restart completes — no manual refresh needed ([d8bb27d](https://github.com/kinderao/dsh-pocket-relay/commit/d8bb27d3fdf301e4bb8ca041cf69c60ca7aefd65))
* **update:** in-page self-restart (dshmarket-style detached relaunch) — updates take effect without leaving the UI; credit text only; issues entry at page bottom ([2d44d68](https://github.com/kinderao/dsh-pocket-relay/commit/2d44d68340d2731c4a5a9e48e3e6ea9080a96953))
* **update:** one-click update now auto-restarts + single-state UI; apply runtime review H1/M1/M3/M4/M5 ([6afe6a2](https://github.com/kinderao/dsh-pocket-relay/commit/6afe6a2ab621759039c5a7800d75fe95bd47d662))
* **update:** refresh-page button after update completes ([e4c82b6](https://github.com/kinderao/dsh-pocket-relay/commit/e4c82b673759e4ee4674848ec5135549f5d703be))
* **update:** update banner + one-click update button (registry latest vs installed, dsh plugin update --latest); 14 tests ([4cf72ce](https://github.com/kinderao/dsh-pocket-relay/commit/4cf72ce6c8a2bc21652c8da054254c113033c795))
* v1.1.0 — minor bump for mirror-source feature; README notes Windows slow download ([2cf4375](https://github.com/kinderao/dsh-pocket-relay/commit/2cf43750e95f74c8070fd35ec9bdaf385f4ca3ca))
* web plugin — settings tab '手机访问' with in-page QR (LAN auto + public tunnel button) ([a31a04d](https://github.com/kinderao/dsh-pocket-relay/commit/a31a04dd37183a75c45a90e2ba3da5d649f8ed1d))


### Performance Improvements

* **proxy:** brotli quality 11 -> 6, 17MB JSON 41s -> ~130ms (fixes [#25](https://github.com/kinderao/dsh-pocket-relay/issues/25)) ([77b94f2](https://github.com/kinderao/dsh-pocket-relay/commit/77b94f266632248e476555ea19aab6fc6cf76fb8))


### BREAKING CHANGES

* 公网通道从 cloudflared 隧道改为自建 relay 中继；插件更名为
dsh-pocket-relay，npm 包名与 Go module 路径同步变更。

中继（新增 relay/，Go 单二进制服务端）
- 服务端从 Node 重写为 Go，静态单文件；内置 TLS、lego ACME DNS-01（腾讯云 DNSPod）、
  证书热加载与自动续期
- Web 管理端：状态、证书续期、访客 IP 白名单、按需查看 agent token
- 三监听口（agent/visitor/admin），支持 PROXY protocol

设备认证（替代共享 PIN 的远程通道）
- 每台设备独立凭据，可单独撤销；token 只存 SHA-256，设备密码用 scrypt
- 内存态一次性配对码、渐进式锁定、空闲会话仅由真实用户输入续期

多 PC 端共存与热备
- 按 agent 名区分机器；首选优先，掉线/假死时兜底到注册最早的备机
- 管理端可切首选、断开（自动重连）、禁止接入（agent-blocked）
- 修复：PC 侧 agent 名此前固定为 default，导致两台电脑互相顶下线

其他
- 客户端设置页新增「本机名称」，留空按主机名派生
- npm 包瘦身：files 移除 relay/（31MB 服务端二进制不属于插件运行时），
  17.40 MB -> 0.20 MB
- 更名 dsh-pocket-relay：package/cordis patch/bin/Go module/README/文档；
  保留 dsh-pocket bin 别名与 $DSH_HOME/dsh-pocket 数据目录以兼容既有安装
- 新增发布与上架指南（docs/发布与上架指南.md）

测试：npm 259 用例（257 通过，2 个为既有 Windows 环境问题）；Go 4 包全绿
* the settings page DOM structure and locale keys changed
(lanAddressHint removed; wanAccess/pinLabel/modeLabel/advAddress/
wanOffHint added). Custom styles or scripts targeting the old settings
DOM/keys need updating.

## [2.10.6](https://github.com/shaobeichen/dsh-pocket/compare/v2.10.5...v2.10.6) (2026-09-10)


### Bug Fixes

* **mobile:** 替换手机端模型设置加载失败提示为引导信息，增加本地真机冒烟测试 ([5ab2ad4](https://github.com/shaobeichen/dsh-pocket/commit/5ab2ad444ba276c5df2bf87fa104c4b16b2081f9))

## [2.10.5](https://github.com/shaobeichen/dsh-pocket/compare/v2.10.4...v2.10.5) (2026-09-10)


### Bug Fixes

* **rpc:** 以方法形式调用 requestRejection 保留 this 绑定，修复 /dsh-pocket/* 全部 403（issue [#117](https://github.com/shaobeichen/dsh-pocket/issues/117)） ([282f71c](https://github.com/shaobeichen/dsh-pocket/commit/282f71c1d844b0e6123b9c976ad0401c3c4a84e7))

## [2.10.4](https://github.com/shaobeichen/dsh-pocket/compare/v2.10.3...v2.10.4) (2026-09-10)


### Bug Fixes

* **client:** prevent iOS Safari input auto-zoom on mobile ([8d5b3fa](https://github.com/shaobeichen/dsh-pocket/commit/8d5b3fa1a14385816e61f92bd83fb239f7d8e74f)), closes [#114](https://github.com/shaobeichen/dsh-pocket/issues/114)
* **mobile:** 侧边栏先开后弹出 aria-modal 弹窗时自动收起，修复卡死 ([#99](https://github.com/shaobeichen/dsh-pocket/issues/99)) ([f2e60b0](https://github.com/shaobeichen/dsh-pocket/commit/f2e60b0eb03ac1b065788e231590a56316a7cfcf))
* **proxy:** shim transport.createApiClient for dsh 0.1.1-rc.2 (issue [#96](https://github.com/shaobeichen/dsh-pocket/issues/96)) ([61cadf8](https://github.com/shaobeichen/dsh-pocket/commit/61cadf871ec817f51135277b7fb3085d9492959e))
* **proxy:** 移除与 DSH Desktop 2.0.4+ 不兼容的 LOOPBACK_ENV_PATCH，修复远程/手机访问白屏 ([#105](https://github.com/shaobeichen/dsh-pocket/issues/105)) ([a1b813d](https://github.com/shaobeichen/dsh-pocket/commit/a1b813d854da5900b55c5893f3190a272cd4a0fc)), closes [#100](https://github.com/shaobeichen/dsh-pocket/issues/100) [#58](https://github.com/shaobeichen/dsh-pocket/issues/58)
* **rpc:** 适配 dsh v0.1.5-alpha.1 的 webServer inject 收缩，堵住启动崩溃 ([#112](https://github.com/shaobeichen/dsh-pocket/issues/112)) ([2ac8efd](https://github.com/shaobeichen/dsh-pocket/commit/2ac8efdb46de19959c1fc59eeddf2f12b42cb909)), closes [#109](https://github.com/shaobeichen/dsh-pocket/issues/109) [#113](https://github.com/shaobeichen/dsh-pocket/issues/113) [#111](https://github.com/shaobeichen/dsh-pocket/issues/111)
* **security:** 收紧限速身份键与登录比较，修隧道失败态残留，移除已删功能的 README 残留 ([517eb00](https://github.com/shaobeichen/dsh-pocket/commit/517eb004ce869f5e140159dfa118ab833a37fd6c)), closes [#69](https://github.com/shaobeichen/dsh-pocket/issues/69)
* **tunnel:** 进程退出不再清除自动恢复标记，修复重启后公网隧道不自动恢复 ([#107](https://github.com/shaobeichen/dsh-pocket/issues/107)) ([db1e5c4](https://github.com/shaobeichen/dsh-pocket/commit/db1e5c418cae91ae1e56f4d6c5c05413ddea02c2)), closes [#11](https://github.com/shaobeichen/dsh-pocket/issues/11) [#106](https://github.com/shaobeichen/dsh-pocket/issues/106)

## [2.10.3](https://github.com/shaobeichen/dsh-pocket/compare/v2.10.2...v2.10.3) (2026-09-03)


### Bug Fixes

* **security:** CLI 模式默认开启访问密码，堵住 0.0.0.0 上的无认证访问（issue [#90](https://github.com/shaobeichen/dsh-pocket/issues/90) [#8](https://github.com/shaobeichen/dsh-pocket/issues/8)） ([5d3a6d0](https://github.com/shaobeichen/dsh-pocket/commit/5d3a6d03e4e1c4fe84626fd3dfd7a4fec28641cc))

## [2.10.2](https://github.com/shaobeichen/dsh-pocket/compare/v2.10.1...v2.10.2) (2026-09-03)


### Bug Fixes

* **mobile:** restore compact usable composer ([#89](https://github.com/shaobeichen/dsh-pocket/issues/89)) ([#93](https://github.com/shaobeichen/dsh-pocket/issues/93)) ([5c56d24](https://github.com/shaobeichen/dsh-pocket/commit/5c56d24c2953022c4300973627dae4d3aebcfbb2))
* **mobile:** snap composer popups to viewport sheet; scroll containers clipped them half-visible on phones ([#88](https://github.com/shaobeichen/dsh-pocket/issues/88)) ([7209de8](https://github.com/shaobeichen/dsh-pocket/commit/7209de8540cf324dd578b18f10bec6b1ff8ea3c4))
* **mobile:** 触摸切换会话等宿主完成导航后再关抽屉 ([#85](https://github.com/shaobeichen/dsh-pocket/issues/85)) ([80b9d16](https://github.com/shaobeichen/dsh-pocket/commit/80b9d16369e3e33457afe8d9c1a48dfa42dc4397)), closes [#84](https://github.com/shaobeichen/dsh-pocket/issues/84)
* **proxy:** loopback trust patch so remote browsers can load settings (issue [#58](https://github.com/shaobeichen/dsh-pocket/issues/58)) ([#87](https://github.com/shaobeichen/dsh-pocket/issues/87)) ([1d67152](https://github.com/shaobeichen/dsh-pocket/commit/1d67152a8a1808d36743162ff24abe3a061cedcd))
* **security:** 堵住 ?token=/WS 的限速旁路，PIN 改 CSPRNG，Host 头伪造按源地址收紧（issue [#90](https://github.com/shaobeichen/dsh-pocket/issues/90)） ([0bfe15a](https://github.com/shaobeichen/dsh-pocket/commit/0bfe15a56c2063e14f1eea5de2ef0cd4e1e54b0d))

## [2.10.1](https://github.com/shaobeichen/dsh-pocket/compare/v2.10.0...v2.10.1) (2026-09-03)


### Bug Fixes

* **proxy:** 打断 Safari 局域网入口的 303 无限重定向（issue [#91](https://github.com/shaobeichen/dsh-pocket/issues/91)） ([4dd4c01](https://github.com/shaobeichen/dsh-pocket/commit/4dd4c017d5ad4b11ac003058dbda1d8d6507f079))

# [2.10.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.9.1...v2.10.0) (2026-08-30)


### Features

* **security:** 移除会话指纹防钓鱼机制（issue [#82](https://github.com/shaobeichen/dsh-pocket/issues/82)/[#83](https://github.com/shaobeichen/dsh-pocket/issues/83) 后续） ([8f91960](https://github.com/shaobeichen/dsh-pocket/commit/8f91960a8379ac7ec16a7c3577ff0134cb2f6204))

## [2.9.1](https://github.com/shaobeichen/dsh-pocket/compare/v2.9.0...v2.9.1) (2026-08-30)


### Bug Fixes

* **security:** 防钓鱼校验只在公网启用，局域网不再误报（issue [#83](https://github.com/shaobeichen/dsh-pocket/issues/83)） ([059163e](https://github.com/shaobeichen/dsh-pocket/commit/059163e26457a15a9f9ce1b21aea539db9ecb803))

# [2.9.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.8.0...v2.9.0) (2026-08-30)


### Bug Fixes

* **auth:** Tailscale/CGNAT(100.64/10) 与手动局域网地址覆盖走局域网密码（issue [#79](https://github.com/shaobeichen/dsh-pocket/issues/79)） ([e3c2e7b](https://github.com/shaobeichen/dsh-pocket/commit/e3c2e7b97700b375bdc17a68ed3523588796ba21)), closes [#66](https://github.com/shaobeichen/dsh-pocket/issues/66)
* **tunnel:** 把 --no-autoupdate 移到全局位置，兼容 cloudflared 2026.x（issue [#78](https://github.com/shaobeichen/dsh-pocket/issues/78)） ([4abc6b9](https://github.com/shaobeichen/dsh-pocket/commit/4abc6b9f9400443bc691d52e7e13c2f7b93aee58))


### Features

* **proxy:** 上游桌面门禁 403 forbidden 对导航请求返回可操作提示页（issue [#81](https://github.com/shaobeichen/dsh-pocket/issues/81)） ([ff003b6](https://github.com/shaobeichen/dsh-pocket/commit/ff003b66a63f55eebc10b4b96f06b2b1984fdc8c))
* **security:** 公网会话指纹 + 链接 ephemeral 提示，防快速隧道子域复用跳陌生站点（issue [#82](https://github.com/shaobeichen/dsh-pocket/issues/82)） ([5bfc039](https://github.com/shaobeichen/dsh-pocket/commit/5bfc0399a1c4d6765fdc815043b6861b08ad5267))

# [2.8.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.7.1...v2.8.0) (2026-08-29)


### Bug Fixes

* **mobile:** 去掉 isInsidePocket 误杀，让对话文件链接在手机上弹提示并注入复制按钮（issue [#17](https://github.com/shaobeichen/dsh-pocket/issues/17)） ([5fca020](https://github.com/shaobeichen/dsh-pocket/commit/5fca0202623df513e11b4654868210f287ea6ffd))


### Features

* **mobile:** 文件链接旁「复制」按钮经主机 RPC 读取正文（issue [#17](https://github.com/shaobeichen/dsh-pocket/issues/17) 内容复制） ([06f69fd](https://github.com/shaobeichen/dsh-pocket/commit/06f69fdef5fd1706846d433ece8bc10944549563))

## [2.7.1](https://github.com/shaobeichen/dsh-pocket/compare/v2.7.0...v2.7.1) (2026-08-29)


### Bug Fixes

* **mobile:** 移动端拦截文件链接点击改提示、隐藏添加工作区，移除冗余复制按钮（issue [#17](https://github.com/shaobeichen/dsh-pocket/issues/17)） ([96ed896](https://github.com/shaobeichen/dsh-pocket/commit/96ed896201045b009068b198e6f5f444a43cfb23))

# [2.7.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.6.3...v2.7.0) (2026-08-29)


### Features

* **mobile:** 文件块支持「复制内容」按钮（issue [#17](https://github.com/shaobeichen/dsh-pocket/issues/17)），移除放大输入 ([c7351ac](https://github.com/shaobeichen/dsh-pocket/commit/c7351acefb8f78b2c26218d812d59a648cd22c7d))

## [2.6.3](https://github.com/shaobeichen/dsh-pocket/compare/v2.6.2...v2.6.3) (2026-08-29)


### Bug Fixes

* 移除临时访问 PIN 功能并修复撤销时的崩溃 ([238864c](https://github.com/shaobeichen/dsh-pocket/commit/238864c92999f73b2a42c103163180053fd10c49)), closes [#69](https://github.com/shaobeichen/dsh-pocket/issues/69)

## [2.6.2](https://github.com/shaobeichen/dsh-pocket/compare/v2.6.1...v2.6.2) (2026-08-29)


### Bug Fixes

* **client:** 补上 MobileComposerFullscreen 缺的 import（P0） ([a71319d](https://github.com/shaobeichen/dsh-pocket/commit/a71319dd66f6b3e70a8f904ce3dca236e6615dbd))

## [2.6.1](https://github.com/shaobeichen/dsh-pocket/compare/v2.6.0...v2.6.1) (2026-08-29)


### Bug Fixes

* **tunnel:** linux 改用裸二进制，不再下载上游已下架的 .tgz (issue [#45](https://github.com/shaobeichen/dsh-pocket/issues/45)) ([26bdb69](https://github.com/shaobeichen/dsh-pocket/commit/26bdb69a9dc8480c67d99bc4dba76fcdc79052e0))

# [2.6.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.5.1...v2.6.0) (2026-08-29)


### Features

* **mobile:** 'expand composer' button on phone (issue [#23](https://github.com/shaobeichen/dsh-pocket/issues/23)) ([ec6f115](https://github.com/shaobeichen/dsh-pocket/commit/ec6f115655964fca882df1e99171cbb5fc59efab))

## [2.5.1](https://github.com/shaobeichen/dsh-pocket/compare/v2.5.0...v2.5.1) (2026-08-29)


### Bug Fixes

* **proxy:** support `?token=<raw pin>` and seed the auth cookie (issue [#35](https://github.com/shaobeichen/dsh-pocket/issues/35)) ([734afbd](https://github.com/shaobeichen/dsh-pocket/commit/734afbdb800ed4b2a1d4dff085cdf2ef074917db))

# [2.5.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.4.0...v2.5.0) (2026-08-29)


### Bug Fixes

* **proxy:** 转发前清掉历史遗留的 dsh-desktop-* 参数 (issue [#75](https://github.com/shaobeichen/dsh-pocket/issues/75)) ([8979594](https://github.com/shaobeichen/dsh-pocket/commit/89795940e2aeb28675b79a1541862331fe3aef5f))


### Features

* **tunnel:** honor a custom cloudflared path (issue [#45](https://github.com/shaobeichen/dsh-pocket/issues/45)) ([b9c0c9f](https://github.com/shaobeichen/dsh-pocket/commit/b9c0c9f0ea37aecdcf004fccfb9e0f5bfc1fd381)), closes [#proxy](https://github.com/shaobeichen/dsh-pocket/issues/proxy)

# [2.4.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.3.0...v2.4.0) (2026-08-29)


### Features

* **auth:** temporary access PINs with auto-expiry (issue [#69](https://github.com/shaobeichen/dsh-pocket/issues/69)) ([965195e](https://github.com/shaobeichen/dsh-pocket/commit/965195e21841e3cfba719e6d6bf6424036e149ad))

# [2.3.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.2.0...v2.3.0) (2026-08-29)


### Features

* **proxy:** make the proxy port configurable from settings.json (issue [#70](https://github.com/shaobeichen/dsh-pocket/issues/70)) ([20bb1b5](https://github.com/shaobeichen/dsh-pocket/commit/20bb1b50eaa06a0d7070e97f516cc44d3cdc475b))

# [2.2.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.1.4...v2.2.0) (2026-08-29)


### Features

* **mobile:** add layout mode switch for wide-screen phones (issue [#74](https://github.com/shaobeichen/dsh-pocket/issues/74)) ([018aef0](https://github.com/shaobeichen/dsh-pocket/commit/018aef0db644093a13d6cb1db427655138c86799))

## [2.1.4](https://github.com/shaobeichen/dsh-pocket/compare/v2.1.3...v2.1.4) (2026-08-29)


### Bug Fixes

* **mobile:** 抽屉层级压过 dsh-web-ui-all 的全屏遮罩 (issue [#67](https://github.com/shaobeichen/dsh-pocket/issues/67)) ([88605d9](https://github.com/shaobeichen/dsh-pocket/commit/88605d93a145af61e345f91b96db2850bb8f1e56))

## [2.1.3](https://github.com/shaobeichen/dsh-pocket/compare/v2.1.2...v2.1.3) (2026-08-29)


### Bug Fixes

* **mobile:** 抽屉里的工作区菜单点不动，并给 iOS 触摸加自愈 (issue [#72](https://github.com/shaobeichen/dsh-pocket/issues/72)) ([9f7c427](https://github.com/shaobeichen/dsh-pocket/commit/9f7c4279049c499f2f33b6ded45f2bd92625b476))

## [2.1.2](https://github.com/shaobeichen/dsh-pocket/compare/v2.1.1...v2.1.2) (2026-08-29)


### Bug Fixes

* **desktop:** stop injecting dsh-desktop-* markers into proxied pages ([17c2d97](https://github.com/shaobeichen/dsh-pocket/commit/17c2d97e6c2da5951a11e171efdd1e436184b04c)), closes [3/#4](https://github.com/shaobeichen/dsh-pocket/issues/4)

## [2.1.1](https://github.com/shaobeichen/dsh-pocket/compare/v2.1.0...v2.1.1) (2026-08-29)


### Bug Fixes

* **proxy:** complete the dsh web browser-session handshake (issue [#77](https://github.com/shaobeichen/dsh-pocket/issues/77)) ([ffc12dd](https://github.com/shaobeichen/dsh-pocket/commit/ffc12ddfcd2113ee4ba80424b2346efee85c0c0f))

# [2.1.0](https://github.com/shaobeichen/dsh-pocket/compare/v2.0.0...v2.1.0) (2026-08-29)


### Bug Fixes

* **ui:** center the toast and narrow it to 280px ([2bcaff0](https://github.com/shaobeichen/dsh-pocket/commit/2bcaff0a3db7847f4cc9941293026ab78b1398c4))
* **ui:** show only the current language half of backend error messages ([bd79283](https://github.com/shaobeichen/dsh-pocket/commit/bd79283d5bad1888933a9fceda886204f59d450c))


### Features

* **pocket:** factory reset entry at the bottom of the settings page ([672b31b](https://github.com/shaobeichen/dsh-pocket/commit/672b31ba04083e4223c15ef1f326fab9a6e5faf7))
* **ui:** toast feedback after factory reset ([074744d](https://github.com/shaobeichen/dsh-pocket/commit/074744d2524584e48de19fdc1b301e85cbd7623e))

# [2.0.0](https://github.com/shaobeichen/dsh-pocket/compare/v1.16.1...v2.0.0) (2026-08-29)


* feat!: redesign settings page layout into structured cards ([1b7d494](https://github.com/shaobeichen/dsh-pocket/commit/1b7d494554ed80eadd701c1e2574760ff130580c))


### BREAKING CHANGES

* the settings page DOM structure and locale keys changed
(lanAddressHint removed; wanAccess/pinLabel/modeLabel/advAddress/
wanOffHint added). Custom styles or scripts targeting the old settings
DOM/keys need updating.

## [1.16.1](https://github.com/shaobeichen/dsh-pocket/compare/v1.16.0...v1.16.1) (2026-08-29)


### Bug Fixes

* **ui:** mode selector only after public access enabled; selected-state highlight; drop lan address hint ([cf6abc0](https://github.com/shaobeichen/dsh-pocket/commit/cf6abc091ac398158e9e8213d9bddcf554b8f87a)), closes [#66](https://github.com/shaobeichen/dsh-pocket/issues/66)

# [1.16.0](https://github.com/shaobeichen/dsh-pocket/compare/v1.15.0...v1.16.0) (2026-08-29)


### Features

* **tunnel:** named tunnel mode (fixed public hostname) + fail-closed host trust boundary ([a7bf98e](https://github.com/shaobeichen/dsh-pocket/commit/a7bf98e54b25e59d03c6dc03c08bc2b4a74d84f5))

# [1.15.0](https://github.com/shaobeichen/dsh-pocket/compare/v1.14.5...v1.15.0) (2026-08-29)


### Bug Fixes

* **ci:** drop setup-node registry-url to avoid .npmrc conflict with semantic-release ([bb41482](https://github.com/shaobeichen/dsh-pocket/commit/bb41482cf499533741cd22a28b5004be253d4f4f))


### Features

* **pin:** allow 8-char alphanumeric custom PINs (letters + digits) ([527abba](https://github.com/shaobeichen/dsh-pocket/commit/527abbac7097a4b7748180ec093f6d5f48a8ce39)), closes [#33](https://github.com/shaobeichen/dsh-pocket/issues/33)
