// 把 @fontsource/noto-sans-sc 的 700 字重改写成只含 woff2 的 @font-face 列表。
// fontsource 自带的 700.css 同时引用 woff2 和 woff，构建时两种格式都会被打进产物（桌面端安装包体积翻倍），
// 而所有支持 unicode-range 的浏览器都支持 woff2，所以这里只留 woff2。
// 用法：node scripts/build-fonts.mjs（升级 @fontsource/noto-sans-sc 后重新跑一次，并提交结果）
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgJson = createRequire(import.meta.url).resolve('@fontsource/noto-sans-sc/package.json')
const pkgDir = path.dirname(pkgJson)
const version = JSON.parse(readFileSync(pkgJson, 'utf8')).version
const source = readFileSync(path.join(pkgDir, '700.css'), 'utf8')

const out = path.join(here, '../src/v2/fonts/noto-sans-sc-700.css')
// 不用 realpath（会指进 .pnpm 内部），按 packages/ui/node_modules 里的符号链接路径写相对地址。
const linkDir = path.join(here, '../node_modules/@fontsource/noto-sans-sc/files')
const fromOut = path.relative(path.dirname(out), linkDir).split(path.sep).join('/')

const blocks = source.match(/\/\*[^*]*\*\/\s*@font-face\s*\{[^}]*\}/g) ?? []
if (blocks.length < 90) throw new Error(`expected ~101 @font-face blocks, got ${blocks.length}`)

const rewritten = blocks.map((block) =>
  block.replace(/src:[^;]*;/, (src) => {
    const file = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(src)?.[1]
    if (!file) throw new Error(`no woff2 in: ${src}`)
    return `src: url(${fromOut}/${file}) format('woff2');`
  }),
)

const header = `/*
 * 自动生成，不要手改：node scripts/build-fonts.mjs
 * 来源：@fontsource/noto-sans-sc@${version}，字重 700，OFL-1.1。
 * 只保留 woff2，共 ${rewritten.length} 片，按 unicode-range 切分，浏览器只会下载页面用到的那几片。
 */
`
writeFileSync(out, header + rewritten.join('\n\n') + '\n')
console.log(`wrote ${path.relative(process.cwd(), out)} (${rewritten.length} faces)`)
