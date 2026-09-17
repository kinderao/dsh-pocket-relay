// 守护 client 打包产物的 loader id 与包名一致。
//
// 为什么需要它：DSH 客户端按 **package.json 的 name** 去 __ModuleLoader__ 里找
// 前端模块。产物若注册成别的 id，文件会被加载但「没注册上」，用户看到的是
//
//   failed to import loader entry … (dsh-pocket-relay): client-modules: bundle
//   …/dsh-pocket-relay/client.js loaded without registering "dsh-pocket-relay"
//   via __ModuleLoader__.load
//
// 并导致整个客户端插件加载失败（需要进恢复模式卸载）。而既有的渲染冒烟测试
// 用 `__ModuleLoader__: { load: (m) => ... }` 这种不校验 id 的垫片，改错了也
// 照样绿——所以这个坑一路溜到了已发布的 npm 包里。
//
// 真实事故：client/build.mjs 里硬编码 loaderId = 'dsh-pocket'，包名改成
// dsh-pocket-relay 后没跟着改，市场安装后的插件无法加载。
//
// 这里直接对**打包产物**断言（不是源码常量），因为客户端的实际行为由产物决定：
// 即使 build.mjs 写对了，产物没重新构建也一样会出错。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BUNDLE = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** 从产物头部取出 window.__ModuleLoader__.load({ id: "..." }) 里的 id。 */
function bundleLoaderId() {
  const m = BUNDLE.match(/__ModuleLoader__\s*\.\s*load\s*\(\s*\{\s*id\s*:\s*"([^"]+)"/);
  return m?.[1] ?? null;
}

test('client 产物调用了 __ModuleLoader__.load 并带 id', () => {
  assert.ok(
    BUNDLE.includes('__ModuleLoader__'),
    '打包产物没有引用 __ModuleLoader__，客户端无法注册',
  );
  assert.notEqual(bundleLoaderId(), null, '产物里的 load({ id: ... }) 解析不出 id');
});

test('loader id 必须与 package.json 的 name 完全一致', () => {
  const id = bundleLoaderId();
  assert.equal(
    id,
    PKG.name,
    `loader id ("${id}") 与包名 ("${PKG.name}") 不一致——DSH 会加载了文件却报 ` +
      `"loaded without registering ${PKG.name}"，整个客户端插件加载失败。` +
      '改包名后请重新运行 npm run build:client。',
  );
});

test('loader id 不是历史遗留的 dsh-pocket', () => {
  // 单独一条：这个具体值是最容易残留的（从上游 fork 而来，build.mjs 里曾硬编码）。
  assert.notEqual(
    bundleLoaderId(),
    'dsh-pocket',
    '产物仍注册为旧 id "dsh-pocket"——包名已是 dsh-pocket-relay，需重新构建产物',
  );
});
