// Renders the social share images (1200x630) into public/: node scripts/make-og.mjs
// Brand banner on the ink background with a one-line description and the viewfinder corner marks.
// Uses the same self-hosted fonts as the site and the banner from packages/ui. Needs Chromium.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))
const fontsCss = pathToFileURL(path.join(here, '../src/styles/fonts.css')).href
const banner = pathToFileURL(path.join(here, '../../../packages/ui/src/brand/banner-ink.svg')).href
const outDir = path.join(here, '../public')

const variants = {
  zh: {
    line: '把故事拍成短剧，全程在你自己的电脑上',
    sub: '开源的 AI 短剧工作室 · 本地运行 · Key 留在本机',
  },
  en: {
    line: 'Turn stories into short dramas, on your own computer',
    sub: 'An open-source AI short-drama studio · runs locally · keys stay on your machine',
  },
}

const html = (
  v,
) => `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${fontsCss}"><style>
  html,body{margin:0;width:1200px;height:630px;background:#100E0C;color:#F9F6F1;overflow:hidden}
  body{position:relative;font-family:'Inter Variable','Noto Sans SC','PingFang SC',sans-serif}
  .banner{position:absolute;left:100px;top:64px;width:1000px;height:auto}
  .copy{position:absolute;left:190px;top:384px;width:830px}
  h1{margin:0;font-family:'Inter Variable','Noto Sans SC','PingFang SC',sans-serif;font-weight:700;font-size:40px;line-height:1.3;letter-spacing:-0.01em;text-wrap:balance}
  p{margin:16px 0 0;font-family:'Inter Variable','PingFang SC','Microsoft YaHei',sans-serif;font-size:22px;line-height:1.5;color:#B9B2A8}
  .m{position:absolute;width:28px;height:28px;border:0 solid #DF500C}
  .tl{left:56px;top:56px;border-top-width:3px;border-left-width:3px}
  .tr{right:56px;top:56px;border-top-width:3px;border-right-width:3px}
  .bl{left:56px;bottom:56px;border-bottom-width:3px;border-left-width:3px}
  .br{right:56px;bottom:56px;border-bottom-width:3px;border-right-width:3px}
</style></head><body>
  <img class="banner" src="${banner}" alt="">
  <div class="copy"><h1>${v.line}</h1><p>${v.sub}</p></div>
  <i class="m tl"></i><i class="m tr"></i><i class="m bl"></i><i class="m br"></i>
</body></html>`

const dir = mkdtempSync(path.join(tmpdir(), 'dramai-og-'))
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] })
for (const [lang, v] of Object.entries(variants)) {
  const file = path.join(dir, `og-${lang}.html`)
  writeFileSync(file, html(v))
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  })
  await page.goto(pathToFileURL(file).href)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: path.join(outDir, `og-${lang}.png`) })
  await page.close()
  console.log(`wrote public/og-${lang}.png`)
}
await browser.close()
