import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { APP_CSP, APP_CSP_DIRECTIVES } from '../src/http/csp.ts'
import { cleanupAll, startServer } from './helpers.ts'

afterEach(cleanupAll)

// === a tiny CSP evaluator (same-origin app; only what the checks below need) ===

type Directives = Record<string, string[]>
const parseCsp = (csp: string): Directives =>
  Object.fromEntries(
    csp
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...sources]) => [name!, sources]),
  )

/** Which directive governs a request destination (with the default-src fallback). */
const FETCH_DIRECTIVE = {
  script: 'script-src',
  style: 'style-src',
  font: 'font-src',
  image: 'img-src',
  media: 'media-src',
  connect: 'connect-src',
} as const
type Destination = keyof typeof FETCH_DIRECTIVE

function allowed(csp: Directives, destination: Destination, url: string): boolean {
  const sources = csp[FETCH_DIRECTIVE[destination]] ?? csp['default-src'] ?? []
  if (sources.includes("'none'")) return false
  if (url.startsWith('data:')) return sources.includes('data:')
  if (url.startsWith('blob:')) return sources.includes('blob:')
  if (url.startsWith('/') && !url.startsWith('//')) return sources.includes("'self'") // same-origin path
  return false // any other origin: the policy lists none
}

const POLICY = parseCsp(APP_CSP)

describe('the policy itself', () => {
  it('is minimal: nothing wider than the app needs', () => {
    expect(POLICY['font-src']).toEqual(["'self'", 'data:'])
    // Scripts: only same-origin files — no inline scripts, no eval, no remote hosts.
    expect(POLICY['script-src']).toEqual(["'self'"])
    for (const [name, sources] of Object.entries(POLICY)) {
      expect(sources, name).not.toContain('*')
      expect(sources, name).not.toContain('https:')
      expect(sources, name).not.toContain('http:')
      expect(sources, name).not.toContain("'unsafe-eval'")
    }
    // Only styles need 'unsafe-inline' (style attributes set by UI libraries).
    for (const [name, sources] of Object.entries(POLICY)) {
      if (name !== 'style-src') expect(sources, name).not.toContain("'unsafe-inline'")
    }
    expect(POLICY['connect-src']).toEqual(["'self'"]) // HTTP API + SSE
    expect(POLICY['frame-ancestors']).toEqual(["'none'"])
    expect(POLICY['object-src']).toEqual(["'none'"])
    expect(POLICY['base-uri']).toEqual(["'self'"])
    expect(Object.keys(APP_CSP_DIRECTIVES).length).toBe(Object.keys(POLICY).length)
  })

  it('allows what each kind of resource needs and nothing foreign', () => {
    expect(allowed(POLICY, 'font', '/assets/inter-latin-wght-normal.woff2')).toBe(true) // self-hosted font file
    expect(allowed(POLICY, 'font', 'data:font/woff2;base64,AAAA')).toBe(true) // font inlined by the bundler
    expect(allowed(POLICY, 'image', '/api/projects/p/files/images/a.png')).toBe(true) // local image read
    expect(allowed(POLICY, 'image', 'blob:http://127.0.0.1:1/x')).toBe(true) // preview of an upload
    expect(allowed(POLICY, 'media', '/api/projects/p/files/videos/a.mp4')).toBe(true) // local video / audio read
    expect(allowed(POLICY, 'connect', '/api/events')).toBe(true) // SSE
    expect(allowed(POLICY, 'connect', '/api/projects')).toBe(true)
    expect(allowed(POLICY, 'script', '/assets/index.js')).toBe(true)
    // foreign
    expect(allowed(POLICY, 'connect', 'https://example.com/')).toBe(false)
    expect(allowed(POLICY, 'script', 'https://cdn.example.com/x.js')).toBe(false)
    expect(allowed(POLICY, 'script', 'data:text/javascript,1')).toBe(false)
    expect(allowed(POLICY, 'media', 'data:audio/wav;base64,AAAA')).toBe(false)
    expect(allowed(POLICY, 'font', 'https://fonts.gstatic.com/x.woff2')).toBe(false)
    expect(allowed(POLICY, 'image', '//evil.example/x.png')).toBe(false)
  })
})

// === the real build ===

const workspaceDir = join(import.meta.dirname, '../../workspace')
const dist = join(workspaceDir, 'dist')
let haveDist = false

beforeAll(() => {
  if (!existsSync(join(dist, 'index.html'))) {
    // Build the frontend ourselves (a few seconds). If it cannot be built (e.g. work in progress there),
    // the build-dependent checks are skipped loudly — that is the frontend's failure, not the server's.
    const r = spawnSync('pnpm', ['--filter', '@dramai/workspace', 'build'], {
      cwd: workspaceDir,
      encoding: 'utf8',
      shell: process.platform === 'win32', // pnpm is a .cmd shim on Windows
    })
    if (r.status !== 0)
      console.warn(
        `[csp] SKIPPED build-dependent checks: the workspace did not build\n${r.stdout}${r.stderr}`,
      )
  }
  haveDist = existsSync(join(dist, 'index.html'))
})

const buildIt = (name: string, fn: () => Promise<void> | void) =>
  it(name, async (ctx) => {
    if (!haveDist) return ctx.skip()
    await fn()
  })

interface Ref {
  destination: Destination
  url: string
  from: string
}

/** Everything the built page references, with the kind of load each one is. */
function collectReferences(): Ref[] {
  const refs: Ref[] = []
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const attr = (tag: string, name: string) =>
    new RegExp(`\\b${name}=["']([^"']*)["']`).exec(tag)?.[1]
  for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
    const src = attr(tag, 'src')
    expect(src, `inline <script> in index.html: ${tag}`).toBeDefined() // inline scripts would be blocked
    refs.push({ destination: 'script', url: src!, from: 'index.html' })
  }
  expect(/<script\b[^>]*>[^<]+<\/script>/.test(html), 'inline script body in index.html').toBe(
    false,
  )
  for (const tag of html.match(/<link\b[^>]*>/g) ?? []) {
    const href = attr(tag, 'href')
    const rel = attr(tag, 'rel') ?? ''
    if (!href) continue
    if (rel === 'stylesheet') refs.push({ destination: 'style', url: href, from: 'index.html' })
    else if (rel.includes('icon'))
      refs.push({ destination: 'image', url: href, from: 'index.html' })
    else if (rel === 'modulepreload')
      refs.push({ destination: 'script', url: href, from: 'index.html' })
    else if (rel === 'preload') {
      const as = attr(tag, 'as')
      refs.push({
        destination:
          as === 'font' ? 'font' : as === 'image' ? 'image' : as === 'style' ? 'style' : 'script',
        url: href,
        from: 'index.html',
      })
    }
  }
  for (const tag of html.match(/<img\b[^>]*>/g) ?? []) {
    const src = attr(tag, 'src')
    if (src) refs.push({ destination: 'image', url: src, from: 'index.html' })
  }
  const assets = join(dist, 'assets')
  for (const file of readdirSync(assets)) {
    if (file.endsWith('.css')) {
      const css = readFileSync(join(assets, file), 'utf8')
      for (const m of css.matchAll(/@font-face\s*\{[^}]*\}/g)) {
        for (const u of m[0].matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g))
          refs.push({ destination: 'font', url: u[1]!, from: file })
      }
      for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
        const url = m[1]!
        if (/\.(woff2?|ttf|otf)(\?|$)/.test(url) || /^data:(font|application\/(x-)?font)/.test(url))
          continue // counted as fonts above
        refs.push({ destination: 'image', url, from: file })
      }
      for (const m of css.matchAll(/@import\s+(?:url\()?["']?([^"');]+)/g))
        refs.push({ destination: 'style', url: m[1]!, from: file })
    }
  }
  return refs
}

describe('the built frontend against the policy', () => {
  buildIt('every resource the page references is allowed (nothing is blocked)', () => {
    const refs = collectReferences()
    expect(refs.length).toBeGreaterThan(10)
    const blocked = refs.filter((r) => !allowed(POLICY, r.destination, r.url))
    expect(
      blocked,
      `blocked by the policy:\n${blocked.map((r) => `${r.destination} ${r.url.slice(0, 80)} (${r.from})`).join('\n')}`,
    ).toEqual([])
    // the self-hosted fonts really are among them (this is what `font-src` is for)
    expect(refs.some((r) => r.destination === 'font' && r.url.startsWith('/assets/'))).toBe(true)
  })

  buildIt(
    'the code needs nothing the policy withholds: no eval, workers, sockets or remote loads',
    () => {
      const assets = join(dist, 'assets')
      const js = readdirSync(assets)
        .filter((f) => f.endsWith('.js'))
        .map((f) => readFileSync(join(assets, f), 'utf8'))
        .join('\n')
      expect(js).not.toMatch(/\beval\(|new Function\(/) // script-src has no 'unsafe-eval'
      expect(js).not.toMatch(/new (Shared)?Worker\(|importScripts\(/) // no worker-src needed
      expect(js).not.toMatch(/new WebSocket\(/) // connect-src covers fetch / SSE only
      expect(js).not.toMatch(/(?:fetch|import)\(\s*["'`]https?:\/\//) // nothing loaded from another origin
      expect(js).not.toMatch(/\b(?:src|href|poster)\s*[:=]\s*["'`]https?:\/\/(?!www\.w3\.org)/) // no remote resources in markup
    },
  )

  buildIt(
    'the server sends the policy with the HTML shell (also for SPA routes), but not with assets',
    async () => {
      const h = await startServer({ startWorker: false, staticDir: dist })
      for (const path of ['/', '/projects/p_x/anything', '/index.html']) {
        const res = await h.raw(path)
        expect(res.status, path).toBe(200)
        expect(res.headers.get('content-security-policy'), path).toBe(APP_CSP)
        expect(res.headers.get('x-frame-options')).toBe('DENY')
      }
      const js = readdirSync(join(dist, 'assets')).find((f) => f.endsWith('.js'))!
      const asset = await h.raw(`/assets/${js}`)
      expect(asset.status).toBe(200)
      expect(asset.headers.get('content-security-policy')).toBeNull()
      // API responses keep their own (stricter) rules
      expect((await h.raw('/api/system')).headers.get('content-security-policy')).toBeNull()
    },
  )
})

// === a real browser, when there is one ===

interface Browserish {
  launch(): Promise<{
    newPage(): Promise<PageLike>
    close(): Promise<void>
  }>
  executablePath(): string
}
interface PageLike {
  addInitScript(script: string): Promise<void>
  goto(url: string, o?: { waitUntil?: string }): Promise<unknown>
  evaluate<T>(fn: string | ((arg: unknown) => T | Promise<T>), arg?: unknown): Promise<T>
  waitForTimeout(ms: number): Promise<void>
}

async function loadChromium(): Promise<Browserish | undefined> {
  try {
    const require = createRequire(join(workspaceDir, 'package.json'))
    const mod = (await import(require.resolve('@playwright/test'))) as { chromium: Browserish }
    return existsSync(mod.chromium.executablePath()) ? mod.chromium : undefined
  } catch {
    return undefined
  }
}

describe('in a real browser (skipped when Playwright / Chromium is not installed)', () => {
  it('the app loads with no CSP violation, and each kind of resource it uses is let through (and a foreign one is not)', async (ctx) => {
    const chromium = await loadChromium()
    if (!chromium || !haveDist) {
      console.warn(
        '[csp] browser check SKIPPED: no Playwright chromium (or no built frontend) here',
      )
      return ctx.skip()
    }
    const h = await startServer({ startWorker: false, staticDir: dist })
    // Local files the page will read: an image, an audio clip (a valid WAV) and a font (the build's own file).
    const png = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64',
      ),
    )
    const wav = (() => {
      const n = 1600
      const b = Buffer.alloc(44 + n * 2)
      b.write('RIFF', 0)
      b.writeUInt32LE(36 + n * 2, 4)
      b.write('WAVEfmt ', 8)
      b.writeUInt32LE(16, 16)
      b.writeUInt16LE(1, 20)
      b.writeUInt16LE(1, 22)
      b.writeUInt32LE(16000, 24)
      b.writeUInt32LE(32000, 28)
      b.writeUInt16LE(2, 32)
      b.writeUInt16LE(16, 34)
      b.write('data', 36)
      b.writeUInt32LE(n * 2, 40)
      return new Uint8Array(b)
    })()
    await h.server.ctx.files.put('p1', 'images/a.png', png)
    await h.server.ctx.files.put('p1', 'audio/a.wav', wav)
    const fontFile = readdirSync(join(dist, 'assets')).find(
      (f) => f.startsWith('inter-latin-wght') && f.endsWith('.woff2'),
    )!
    const fontB64 = readFileSync(join(dist, 'assets', fontFile)).toString('base64')

    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      await page.addInitScript(
        `window.__violations = []; document.addEventListener('securitypolicyviolation', (e) => { window.__violations.push({ directive: e.violatedDirective, blocked: e.blockedURI, file: e.sourceFile, line: e.lineNumber, sample: e.sample }) })`,
      )
      // Not 'networkidle': the app keeps its SSE stream open, so the network is never idle.
      await page.goto(`${h.server.url}/`, { waitUntil: 'load' })
      await page.waitForTimeout(1500)
      await page.evaluate('document.fonts.ready.then(() => true)')
      const violations = () =>
        page.evaluate<Array<{ directive: string; blocked: string }>>('window.__violations')
      expect(await violations(), 'the app itself must load without any violation').toEqual([])

      const result = await page.evaluate<Record<string, string>>(
        `(async () => {
          const out = {}
          const load = (el, ok) => new Promise((res) => { el.addEventListener(ok, () => res('ok')); el.addEventListener('error', () => res('error')); setTimeout(() => res('timeout'), 4000) })
          const img = new Image(); img.src = '/api/projects/p1/files/images/a.png'; out.image = await load(img, 'load')
          const audio = document.createElement('audio'); audio.src = '/api/projects/p1/files/audio/a.wav'; out.media = await load(audio, 'loadedmetadata')
          out.connect = (await fetch('/api/system')).status === 200 ? 'ok' : 'error'
          out.sse = await new Promise((res) => { const es = new EventSource('/api/events'); es.onopen = () => { es.close(); res('ok') }; es.onerror = () => { es.close(); res('error') }; setTimeout(() => res('timeout'), 4000) })
          const face = new FontFace('InlineProbe', 'url(data:font/woff2;base64,${fontB64})')
          try { await face.load(); out.fontData = 'ok' } catch { out.fontData = 'error' }
          const face2 = new FontFace('SelfProbe', 'url(/assets/${fontFile})')
          try { await face2.load(); out.fontSelf = 'ok' } catch { out.fontSelf = 'error' }
          const blobUrl = URL.createObjectURL(new Blob([new Uint8Array(${JSON.stringify([...png])})], { type: 'image/png' }))
          const bimg = new Image(); bimg.src = blobUrl; out.blobImage = await load(bimg, 'load')
          return out
        })()`,
      )
      expect(result).toEqual({
        image: 'ok',
        media: 'ok',
        connect: 'ok',
        sse: 'ok',
        fontData: 'ok',
        fontSelf: 'ok',
        blobImage: 'ok',
      })
      expect(await violations()).toEqual([])

      // Negative controls: the listener works, and foreign loads really are stopped.
      await page.evaluate(
        `(async () => {
          await fetch('https://example.com/').catch(() => {})
          const i = new Image(); i.src = 'https://example.com/x.png'
          const s = document.createElement('script'); s.src = 'https://example.com/x.js'; document.head.appendChild(s)
          await new Promise((r) => setTimeout(r, 300))
        })()`,
      )
      const after = await violations()
      expect(after.map((v) => v.directive.split(' ')[0]).sort()).toEqual([
        'connect-src',
        'img-src',
        'script-src-elem',
      ])
    } finally {
      await browser.close()
    }
  }, 90_000)
})
