// relay 二进制构建脚本
//
//   node relay/scripts/build.mjs            为当前平台构建到 relay/dist/
//   node relay/scripts/build.mjs --all      交叉编译 linux/amd64 + linux/arm64 + 当前平台
//
// 为什么用脚本而不是 npm script 里裸写 go build：交叉编译要设 CGO_ENABLED/GOOS/GOARCH，
// 三个环境变量在命令行里写又长又容易漏（漏了 CGO 就会产出动态链接的二进制，
// 拷到精简的服务器镜像上直接跑不起来）。
import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const relayDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(relayDir, 'dist');
const all = process.argv.includes('--all');
// 版本号会被 -X main.version 注入二进制，并显示在 Web 管理端。
// **别让它静默回落到默认值**：换了默认值就等于把线上显示的版本号改回去
// （曾经把 0.2.0 的服务端用默认值重新构建，管理端就显示成了 0.1.0）。
// 发版时改这里的默认值，或临时用 DSHP_RELAY_VERSION=… 覆盖。
const version = process.env.DSHP_RELAY_VERSION ?? '0.3.0';

const targets = all
  ? [
    { goos: 'linux', goarch: 'amd64' },
    { goos: 'linux', goarch: 'arm64' },
    { goos: process.platform === 'win32' ? 'windows' : 'darwin', goarch: 'amd64' },
  ]
  : [{ goos: null, goarch: null }]; // 当前平台

mkdirSync(distDir, { recursive: true });

for (const t of targets) {
  const ext = (t.goos ?? process.platform) === 'win32' || t.goos === 'windows' ? '.exe' : '';
  const suffix = t.goos ? `-${t.goos}-${t.goarch}` : '';
  // 当前平台同时产出一个不带后缀的名字，方便测试与本地直接运行
  const names = t.goos ? [`dsh-pocket-relay${suffix}${ext}`] : [`dsh-pocket-relay${ext}`];
  const out = resolve(distDir, names[0]);

  const env = { ...process.env, CGO_ENABLED: '0' };
  if (t.goos) { env.GOOS = t.goos; env.GOARCH = t.goarch; }

  console.log(`building ${names[0]} …`);
  // 刻意不用 shell：Windows 上 shell:true 会把 -ldflags "-s -w -X …" 拆成
  // 独立参数交给 cmd.exe，go 收到裸的 -w 直接报 "flag provided but not defined"。
  // go 本身是 go.exe，直接 spawn 即可，不需要 shell 介入。
  const res = spawnSync('go', [
    'build', '-trimpath',
    '-ldflags', `-s -w -X main.version=${version}`,
    '-o', out, '.',
  ], { cwd: relayDir, env, stdio: 'inherit' });

  if (res.status !== 0) {
    console.error(`❌ 构建失败（${names[0]}）`);
    process.exit(res.status ?? 1);
  }
  const mb = (statSync(out).size / 1024 / 1024).toFixed(1);
  console.log(`✅ ${names[0]}  ${mb} MB`);
}
