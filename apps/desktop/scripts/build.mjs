#!/usr/bin/env node
// 把主进程、预加载脚本、服务进程打成几个文件放进 dist/，并带上服务运行时要读的数据和前端构建产物。
//
//   node scripts/build.mjs              生产构建（不含演示代码）
//   node scripts/build.mjs --dev        开发构建（带 sourcemap 和演示模式的种子代码）
//   node scripts/build.mjs --watch      开发构建 + 监听（改了源码自动重新打包）
//   node scripts/build.mjs --no-web     不拷贝前端构建产物（开发形态窗口加载 Vite，不需要）
//
// 打成单个文件的好处：应用包里没有 node_modules，只有这几个文件 + 数据 + 前端，体积小、没有“多装了什么”的问题。
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, context } from 'esbuild'
import { generateAppIcons, iconPng } from './lib/icons.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const repo = join(root, '../..')
const dist = join(root, 'dist')
const args = new Set(process.argv.slice(2))
const dev = args.has('--dev') || args.has('--watch')
const watch = args.has('--watch')
const withWeb = !args.has('--no-web')

const common = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  sourcemap: dev ? 'linked' : false,
  logLevel: 'info',
  legalComments: 'none',
  // 工作区里的包按源码打进来，不要求先单独构建它们。
  conditions: ['dramai-source'],
}

// CommonJS 依赖（jszip、mammoth 等）在 ESM 产物里需要 require。
const requireShim = `import { createRequire as __createRequire } from 'node:module';const require = __createRequire(import.meta.url);`

const entries = [
  {
    ...common,
    entryPoints: [join(root, 'src/main/index.ts')],
    outfile: join(dist, 'main.js'),
    format: 'esm',
    external: ['electron'],
    banner: { js: requireShim },
  },
  {
    ...common,
    entryPoints: [join(root, 'src/preload/index.ts')],
    outfile: join(dist, 'preload.cjs'),
    format: 'cjs',
    external: ['electron'],
  },
  {
    ...common,
    entryPoints: [join(root, 'src/server/entry.ts')],
    outfile: join(dist, 'server/server.mjs'),
    format: 'esm',
    external: ['electron'],
    banner: { js: requireShim },
  },
]
if (dev) {
  entries.push({
    ...common,
    entryPoints: [join(root, 'src/dev/demo.ts')],
    outfile: join(dist, 'demo.mjs'),
    format: 'esm',
    banner: { js: requireShim },
  })
}

async function writeWindowIcon() {
  // Window / taskbar icon for Windows and Linux, generated from the brand artwork (macOS takes its icon from the bundle).
  await mkdir(join(dist, 'icons'), { recursive: true })
  await writeFile(join(dist, 'icons', 'window.png'), iconPng(process.platform, 512))
  // The installed app's icon file for this platform (.icns / .ico / PNG set), generated from the brand artwork.
  generateAppIcons(join(root, 'build', 'generated'))
}

async function copyAssets() {
  await writeWindowIcon()
  // 服务读数据目录用的是相对 server.mjs 的 ../data/（见 @dramai/core 的 bundledDataDir），所以数据放在 dist/data。
  await cp(join(repo, 'packages/core/data'), join(dist, 'data'), { recursive: true })
  if (withWeb) {
    const web = join(repo, 'packages/workspace/dist')
    if (!existsSync(join(web, 'index.html'))) {
      throw new Error(
        `前端还没构建：${web}/index.html 不存在。先运行 pnpm --filter @dramai/workspace build`,
      )
    }
    await cp(web, join(dist, 'web'), { recursive: true })
  }
}

await rm(dist, { recursive: true, force: true })
await mkdir(join(dist, 'server'), { recursive: true })
await copyAssets()

if (watch) {
  for (const entry of entries) {
    const ctx = await context(entry)
    await ctx.watch()
  }
  console.log('[desktop] watching…')
} else {
  await Promise.all(entries.map((entry) => build(entry)))
  console.log(`[desktop] built → ${dist}`)
}
