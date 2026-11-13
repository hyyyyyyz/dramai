// Builds the site and checks the output: node scripts/check-dist.mjs [--no-build]
//   - every internal link and anchor resolves
//   - the two languages have the same sections and the same amount of content
//   - nothing in the output requests a third-party host (fonts, scripts, analytics, images, CSS)
//   - hreflang, canonical, Open Graph and sitemap are consistent; images have alt text and dimensions
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const dist = path.join(root, 'dist')
const BASE = '/dramai/'
const ORIGIN = 'https://hyyyyyyz.github.io'
const REPO = 'https://github.com/hyyyyyyz/dramai'

const errors = []
const fail = (msg) => errors.push(msg)

// ---------- build ----------
if (!process.argv.includes('--no-build')) {
  const require = createRequire(import.meta.url)
  const astroBin = path.join(path.dirname(require.resolve('astro/package.json')), 'bin/astro.mjs')
  const result = spawnSync(process.execPath, [astroBin, 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
  })
  if (result.status !== 0) {
    console.error('astro build failed')
    process.exit(1)
  }
}
if (!existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/index.html is missing: build first')
  process.exit(1)
}

// ---------- helpers ----------
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}
const rel = (file) => path.relative(dist, file).split(path.sep).join('/')
const files = walk(dist)
const fileSet = new Set(files.map(rel))
const htmlFiles = files.filter((f) => f.endsWith('.html'))

/** All start tags of the given element names with their attributes. */
function tags(html, names) {
  const out = []
  const re = new RegExp(`<(${names.join('|')})\\b([^>]*)>`, 'gi')
  for (const m of html.matchAll(re)) {
    const attrs = {}
    for (const a of (m[2] ?? '').matchAll(/([\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? ''
    }
    out.push({ name: m[1].toLowerCase(), attrs })
  }
  return out
}
const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
const decode = (s) => s.replace(/&amp;/g, '&')

/** Resolve a site path such as "/dramai/en/#faq" to a dist file; null when it is outside the site. */
function resolveInternal(href) {
  const clean = decode(href).split('#')[0].split('?')[0]
  if (!clean.startsWith(BASE)) return undefined
  const sub = clean.slice(BASE.length)
  const candidates =
    sub === '' || sub.endsWith('/') ? [`${sub}index.html`] : [sub, `${sub}/index.html`]
  return candidates.find((c) => fileSet.has(c)) ?? null
}

const pages = new Map(htmlFiles.map((f) => [rel(f), readFileSync(f, 'utf8')]))
const pageIds = new Map([...pages].map(([name, html]) => [name, ids(html)]))

// ---------- 1. links, anchors, resources ----------
const hostOk = (url) => url.startsWith(`${ORIGIN}${BASE}`) || url === `${ORIGIN}${BASE}`
for (const [name, html] of pages) {
  for (const t of tags(html, ['a'])) {
    const href = t.attrs.href
    if (href === undefined) continue
    if (href.startsWith('#')) {
      if (href.length > 1 && !pageIds.get(name).has(href.slice(1)))
        fail(`${name}: anchor ${href} has no target`)
    } else if (/^https?:\/\//.test(href)) {
      if (
        !hostOk(href) &&
        !(href === REPO || href.startsWith(`${REPO}/`) || href.startsWith(`${REPO}.git`))
      )
        fail(`${name}: external link to ${href} (only the dramai repository is allowed)`)
    } else if (href.startsWith('/')) {
      const target = resolveInternal(href)
      if (target === undefined) fail(`${name}: internal link ${href} is outside ${BASE}`)
      else if (target === null) fail(`${name}: broken link ${href}`)
      else if (href.includes('#')) {
        const frag = decode(href).split('#')[1]
        if (frag && !pageIds.get(target)?.has(frag)) fail(`${name}: ${href} has no anchor #${frag}`)
      }
    } else if (!/^(mailto:|tel:)/.test(href)) {
      fail(`${name}: link ${href} is neither absolute nor site-rooted`)
    }
  }
  for (const t of tags(html, ['use'])) {
    const ref = t.attrs.href ?? t.attrs['xlink:href']
    if (ref?.startsWith('#') && !pageIds.get(name).has(ref.slice(1)))
      fail(`${name}: <use ${ref}> has no symbol`)
  }
  // Everything the browser fetches must be a file of this site.
  for (const t of tags(html, [
    'img',
    'source',
    'script',
    'link',
    'use',
    'video',
    'audio',
    'iframe',
  ])) {
    const refs = [
      t.attrs.src,
      t.attrs.href,
      ...(t.attrs.srcset ?? '').split(',').map((s) => s.trim().split(/\s+/)[0]),
    ]
    const rels = (t.attrs.rel ?? '').split(/\s+/)
    for (const ref of refs.filter(Boolean)) {
      if (ref.startsWith('#') || ref.startsWith('data:')) continue
      if (t.name === 'link' && (rels.includes('canonical') || rels.includes('alternate'))) {
        if (!hostOk(ref)) fail(`${name}: <link ${t.attrs.rel}> points to ${ref}`)
        continue
      }
      if (/^(https?:)?\/\//.test(ref)) {
        fail(`${name}: <${t.name}> loads a third-party resource ${ref}`)
      } else if (ref.startsWith('/')) {
        const target = resolveInternal(ref)
        if (target === undefined || target === null) fail(`${name}: <${t.name}> ${ref} is missing`)
      }
    }
  }
  for (const t of tags(html, ['img'])) {
    if (t.attrs.alt === undefined) fail(`${name}: <img ${t.attrs.src}> has no alt`)
    if (!t.attrs.width || !t.attrs.height)
      fail(`${name}: <img ${t.attrs.src}> has no width and height`)
  }
}

// CSS and JS must not reach out either.
for (const f of files.filter((x) => /\.(css|js|mjs)$/.test(x))) {
  const text = readFileSync(f, 'utf8')
  for (const m of text.matchAll(
    /(?:url\(\s*['"]?|@import\s+['"]?|fetch\(\s*['"]|src=['"]|href=['"])(https?:)?\/\/([^/'")\s]+)/g,
  )) {
    fail(`${rel(f)}: reaches out to ${m[2]}`)
  }
  if (
    /googleapis|gstatic|googletagmanager|google-analytics|plausible|umami|cloudflareinsights|sentry/i.test(
      text,
    )
  )
    fail(`${rel(f)}: mentions a font, analytics or tracking service`)
}

// ---------- 2. required files ----------
for (const need of [
  'index.html',
  'en/index.html',
  '404.html',
  'robots.txt',
  'sitemap-index.xml',
  'sitemap-0.xml',
  'favicon.svg',
  'favicon.ico',
  'favicon-16.png',
  'favicon-32.png',
  'favicon-180.png',
])
  if (!fileSet.has(need)) fail(`dist/${need} is missing`)

// ---------- 3. the two languages ----------
const zhHtml = pages.get('index.html') ?? ''
const enHtml = pages.get('en/index.html') ?? ''
const sections = (html) => [...html.matchAll(/<section\b[^>]*\sid="([^"]+)"/g)].map((m) => m[1])
const sz = sections(zhHtml)
const se = sections(enHtml)
if (sz.join() !== se.join()) fail(`sections differ: zh [${sz}] vs en [${se}]`)
if (sz.length < 7) fail(`expected at least 7 sections, found ${sz.length}`)
const count = (html, re) => (html.match(re) ?? []).length
const parity = {
  'workflow steps': /<li class="stage"/g,
  features: /<li>\s*<span class="ic"/g,
  screenshots: /<figure class="screen"/g,
  'style chips': /<li class="chip"/g,
  'edition rows': /<tr>\s*<th scope="row"/g,
  'platform rows': /<li>\s*<div class="pn-head"/g,
  'faq items': /<details/g,
  'h4 headings': /<h4\b/g,
  'h2 headings': /<h2\b/g,
  'h3 headings': /<h3\b/g,
}
for (const [what, re] of Object.entries(parity)) {
  const a = count(zhHtml, re)
  const b = count(enHtml, re)
  if (a !== b || a === 0) fail(`${what}: zh has ${a}, en has ${b}`)
}
if (count(zhHtml, /<li class="chip"/g) !== 20) fail('expected 20 style presets on the page')
for (const [name, html, lang, canonical, other] of [
  ['index.html', zhHtml, 'zh-CN', `${ORIGIN}${BASE}`, `${ORIGIN}${BASE}en/`],
  ['en/index.html', enHtml, 'en', `${ORIGIN}${BASE}en/`, `${ORIGIN}${BASE}`],
]) {
  if (!new RegExp(`<html lang="${lang}"`).test(html)) fail(`${name}: <html lang> should be ${lang}`)
  const links = tags(html, ['link'])
  const canon = links.find((l) => l.attrs.rel === 'canonical')
  if (canon?.attrs.href !== canonical)
    fail(`${name}: canonical is ${canon?.attrs.href}, expected ${canonical}`)
  const alt = Object.fromEntries(
    links.filter((l) => l.attrs.rel === 'alternate').map((l) => [l.attrs.hreflang, l.attrs.href]),
  )
  if (
    alt['zh-CN'] !== `${ORIGIN}${BASE}` ||
    alt.en !== `${ORIGIN}${BASE}en/` ||
    alt['x-default'] !== `${ORIGIN}${BASE}`
  )
    fail(`${name}: hreflang alternates are wrong: ${JSON.stringify(alt)}`)
  if (!tags(html, ['a']).some((a) => a.attrs.hreflang && a.attrs.href === new URL(other).pathname))
    fail(`${name}: no language switch to ${other}`)
  const metas = tags(html, ['meta'])
  const meta = (key) =>
    metas.find((m) => m.attrs.property === key || m.attrs.name === key)?.attrs.content
  for (const key of [
    'description',
    'og:title',
    'og:description',
    'og:image',
    'og:url',
    'twitter:card',
    'twitter:image',
  ])
    if (!meta(key)) fail(`${name}: missing <meta ${key}>`)
  if (meta('og:url') !== canonical) fail(`${name}: og:url differs from canonical`)
  const og = meta('og:image')
  const ogFile = og?.startsWith(`${ORIGIN}${BASE}`) ? og.slice(`${ORIGIN}${BASE}`.length) : null
  if (!ogFile || !fileSet.has(ogFile)) fail(`${name}: og:image ${og} is not a file of the site`)
  if (count(html, /<h1\b/g) !== 1) fail(`${name}: expected exactly one <h1>`)
  if (!/<title>[^<]+<\/title>/.test(html)) fail(`${name}: empty <title>`)
  if (!/<main\b/.test(html) || !/<header\b/.test(html) || !/<footer\b/.test(html))
    fail(`${name}: missing landmarks`)
  if (
    !/prefers-color-scheme/.test(
      readFileSync(
        path.join(
          dist,
          '_astro',
          readdirSync(path.join(dist, '_astro')).find((n) => n.endsWith('.css')) ?? '',
        ),
        'utf8',
      ),
    )
  )
    fail('the stylesheet has no prefers-color-scheme rules')
}
// The 404 page must not be indexed, and does not redirect.
const nf = pages.get('404.html') ?? ''
if (!/name="robots" content="noindex"/.test(nf)) fail('404.html should be noindex')
if (/location\.(replace|assign)/.test(nf)) fail('404.html should not redirect by script')
// Sitemap: both languages, no 404.
const sitemap = readFileSync(path.join(dist, 'sitemap-0.xml'), 'utf8')
for (const loc of [`${ORIGIN}${BASE}`, `${ORIGIN}${BASE}en/`])
  if (!sitemap.includes(`<loc>${loc}</loc>`)) fail(`sitemap lacks ${loc}`)
if (sitemap.includes('404')) fail('sitemap lists the 404 page')
if (
  !readFileSync(path.join(dist, 'robots.txt'), 'utf8').includes(`${ORIGIN}${BASE}sitemap-index.xml`)
)
  fail('robots.txt does not point at the sitemap')

// ---------- result ----------
if (errors.length) {
  console.error(`\n${errors.length} problem(s) in dist/:`)
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}
console.log(
  `dist/ ok: ${htmlFiles.length} pages, ${files.length} files, ${sz.length} sections in each language`,
)
