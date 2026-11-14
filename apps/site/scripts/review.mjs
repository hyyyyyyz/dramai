// Visual and layout review of the built site: node scripts/review.mjs [outDir] [filePrefix]
// Opens dist/ (served under /dramai/) in Chromium in eight combinations (375 and 1280 wide, light and
// dark, Chinese and English), saves a full-page screenshot of each, and measures what a screenshot cannot
// prove: no horizontal scroll, headings within their line budget, no element wider than the viewport.
// One more screenshot is taken with JavaScript disabled. Needs Chromium: pnpm exec playwright install chromium
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { serveDist } from './serve-dist.mjs'

const outDir = path.resolve(process.argv[2] ?? 'review')
// Optional file name prefix, e.g. `v2-`, to keep several review rounds in one folder.
const prefix = process.argv[3] ?? ''
mkdirSync(outDir, { recursive: true })

const server = await serveDist()
const browser = await chromium.launch()
let failures = 0

const pages = [
  { lang: 'zh', path: '' },
  { lang: 'en', path: 'en/' },
]
const sizes = [
  { name: '375', width: 375, height: 812 },
  { name: '1280', width: 1280, height: 900 },
]

/** Measures inside the page. Line count = rendered height / computed line height. */
function measure() {
  const lines = (el) => {
    const cs = getComputedStyle(el)
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5
    return Math.round(el.getBoundingClientRect().height / lh)
  }
  const vw = document.documentElement.clientWidth
  const headings = [...document.querySelectorAll('h1, h2')].map((el) => ({
    tag: el.tagName,
    text: el.textContent.trim().slice(0, 40),
    lines: lines(el),
  }))
  const wide = [...document.querySelectorAll('body *')]
    .filter((el) => {
      if (el.closest('pre, svg, .sr-only, .skip')) return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.right > vw + 1
    })
    .slice(0, 5)
    .map((el) => `${el.tagName.toLowerCase()}.${el.className}`)
  return {
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: vw,
    headings,
    wide,
    fontsReady: document.fonts.status,
  }
}

for (const p of pages) {
  for (const size of sizes) {
    for (const scheme of ['light', 'dark']) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        colorScheme: scheme,
        deviceScaleFactor: 1,
      })
      const page = await context.newPage()
      const requests = []
      page.on('request', (r) => requests.push(r.url()))
      await page.goto(server.url + p.path, { waitUntil: 'load' })
      await page.evaluate(() => document.fonts.ready)
      // Lazy images only load once near the viewport: make every visible one eager and wait until it is decoded.
      await page.evaluate(async () => {
        const shown = [...document.images].filter((i) => getComputedStyle(i).display !== 'none')
        for (const img of shown) img.loading = 'eager'
        await Promise.all(
          shown.map(async (img) => {
            if (!img.complete)
              await new Promise((r) => {
                img.addEventListener('load', r, { once: true })
                img.addEventListener('error', r, { once: true })
              })
            await img.decode().catch(() => {})
          }),
        )
      })
      const m = await page.evaluate(measure)
      const name = `${prefix}${p.lang}-${size.name}-${scheme}`
      // A sticky header would be painted in the middle of a full-page capture.
      await page.addStyleTag({ content: '.top { position: static !important; }' })
      await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true })
      const external = requests.filter((u) => !u.startsWith(server.origin))
      const problems = []
      if (m.scrollWidth > m.clientWidth)
        problems.push(`horizontal scroll ${m.scrollWidth}>${m.clientWidth}`)
      if (m.wide.length) problems.push(`wider than viewport: ${m.wide.join(', ')}`)
      const budget = (h) => (h.tag === 'H1' && size.width < 500 ? 3 : 2)
      for (const h of m.headings)
        if (h.lines > budget(h))
          problems.push(`${h.tag} "${h.text}" has ${h.lines} lines (budget ${budget(h)})`)
      if (external.length) problems.push(`external requests: ${external.join(', ')}`)
      console.log(
        `${problems.length ? 'FAIL' : 'ok  '} ${name}  headings: ${m.headings.map((h) => h.lines).join(',')}`,
      )
      for (const x of problems) console.log(`     ${x}`)
      failures += problems.length
      await context.close()
    }
  }
}

// JavaScript disabled: the content must be complete and the system colour scheme must still decide the theme.
for (const p of pages) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: 'dark',
    javaScriptEnabled: false,
  })
  const page = await context.newPage()
  await page.goto(server.url + p.path, { waitUntil: 'load' })
  await page.screenshot({
    path: path.join(outDir, `${prefix}${p.lang}-1280-dark-nojs.png`),
    fullPage: true,
  })
  const hiddenButtons = await page.locator('#theme').isVisible()
  console.log(`nojs ${p.lang}: theme button visible = ${hiddenButtons} (expected false)`)
  if (hiddenButtons) failures++
  await context.close()
}

await browser.close()
await server.close()
if (failures) {
  console.error(`${failures} problem(s)`)
  process.exitCode = 1
}
