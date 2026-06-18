// esbuild 打包入口
// 用法:
//   node build.mjs              — 一次性构建 frontend + server
//   node build.mjs --watch      — 监听 src/ 变化
//   node build.mjs frontend     — 只打前端
//   node build.mjs server       — 只打后端

import { build, context } from 'esbuild';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DIST = join(ROOT, 'dist');
const PUBLIC = join(ROOT, 'public');

if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true });
if (!existsSync(PUBLIC)) mkdirSync(PUBLIC, { recursive: true });

const watch = process.argv.includes('--watch');
const target = process.argv.find((a) => ['frontend', 'server'].includes(a));
const buildFrontend = !target || target === 'frontend';
const buildServer = !target || target === 'server';

/** @type {import('esbuild').BuildOptions} */
const frontendCfg = {
  entryPoints: [join(ROOT, 'src', 'app.ts')],
  outfile: join(PUBLIC, 'app.js'),
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  platform: 'browser',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const serverCfg = {
  entryPoints: [join(ROOT, 'src', 'server.ts')],
  outfile: join(DIST, 'server.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node20'],
  sourcemap: true,
  minify: false,
  external: ['express'], // 保留 require,避免打包内置模块
  banner: { js: "import { createRequire as __crq } from 'node:module'; const require = __crq(import.meta.url);" },
  logLevel: 'info',
};

async function run() {
  if (watch) {
    if (buildFrontend) {
      const ctx = await context(frontendCfg);
      await ctx.watch();
      console.log('[watch] frontend → public/app.js');
    }
    if (buildServer) {
      const ctx = await context(serverCfg);
      await ctx.watch();
      console.log('[watch] server → dist/server.js');
    }
  } else {
    if (buildFrontend) {
      await build(frontendCfg);
      console.log('[ok] frontend → public/app.js');
    }
    if (buildServer) {
      await build(serverCfg);
      console.log('[ok] server → dist/server.js');
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
