// dsh-pocket-relay 网页客户端打包：client/index.jsx → client/client.js
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const sourceDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(sourceDir, '..');
const outputPath = resolve(packageRoot, 'client/client.js');

// loader id 必须与 package.json 的 name 一致：DSH 按包名去 __ModuleLoader__
// 里找这个前端模块，对不上就会加载了文件却报
// "loaded without registering <包名> via __ModuleLoader__.load"，整个客户端
// 插件加载失败。这里直接读 package.json，避免再出现「改了包名但这里没跟着改」
// 的脱节——曾经硬编码 'dsh-pocket'，包名改成 dsh-pocket-relay 后就踩了这个坑。
//
// 注意与 cordis.patch.yml 的 id 区分：那个 id 是市场「启用/禁用」开关的身份键，
// 沿用历史值 dsh-pocket，与这里的 loader id 无关（参照 dshmarket：它的 patch id
// 是 dsh-market，而 loader id 与包名一致，都是 dshmarket）。
const pkg = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
const loaderId = process.env.DSH_POCKET_CLIENT_ID ?? pkg.name;

const result = await build({
  entryPoints: [resolve(sourceDir, 'index.jsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome100'],
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
  write: false,
  minify: process.env.NODE_ENV === 'production',
  legalComments: 'none',
});

const bundled = result.outputFiles?.[0]?.text;
if (!bundled) throw new Error('esbuild did not produce a client bundle');

const wrapped = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(loaderId)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    // The DSH client module system provides react as a module, never as a
    // global. esbuild keeps react external (see the build config above) and
    // its classic JSX transform emits bare React.createElement calls for the
    // mobile components (which import only named hooks, not React itself), so
    // the bundle must bind React itself - otherwise every mobile component
    // crashes at render time with "ReferenceError: React is not defined".
    var React = require("react");
${bundled}
    return module.exports;
  }
});
`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, wrapped, 'utf8');
console.log(`Wrote ${outputPath}`);
