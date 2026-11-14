// Page text that mirrors data elsewhere in the repository is checked against that data.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.join(here, '../../..')
const read = (rel) => readFileSync(path.join(repo, rel), 'utf8')

const stylesFile = path.join(repo, 'packages/core/data/styles.json')

test(
  'the style presets on the page are the 20 in packages/core',
  { skip: !existsSync(stylesFile) },
  () => {
    const data = JSON.parse(readFileSync(stylesFile, 'utf8'))
    const zh = read('apps/site/src/content/zh.ts')
    const en = read('apps/site/src/content/en.ts')
    let total = 0
    for (const group of data.groups) {
      assert.ok(zh.includes(`name: '${group.label}'`), `zh group ${group.label}`)
      for (const preset of group.presets) {
        total++
        assert.ok(zh.includes(`'${preset.label}'`), `zh preset ${preset.label}`)
        assert.ok(en.includes(`'${preset.i18n.en.label}'`), `en preset ${preset.i18n.en.label}`)
      }
    }
    assert.equal(total, 20)
  },
)

test('this package has the repo-wide version', () => {
  const pkg = JSON.parse(read('apps/site/package.json'))
  const root = JSON.parse(read('package.json'))
  assert.equal(pkg.version, root.version)
})

test('localStorage is only touched inside try/catch', () => {
  for (const file of [
    'apps/site/src/components/Landing.astro',
    'apps/site/src/layouts/BaseLayout.astro',
  ]) {
    const text = read(file)
    for (const match of text.matchAll(/localStorage/g)) {
      const before = text.slice(0, match.index)
      const lastTry = before.lastIndexOf('try {')
      const lastCatch = before.lastIndexOf('catch')
      assert.ok(lastTry !== -1 && lastTry > lastCatch, `${file}: localStorage outside try/catch`)
    }
  }
})

// ---------- numbers about providers: counted from packages/core ----------
const corePresets = pathToFileURL(path.join(repo, 'packages/core/src/providers/presets.ts')).href
const siteFacts = pathToFileURL(path.join(repo, 'apps/site/src/content/facts.ts')).href
const { PROVIDER_PRESETS, PROVIDER_VENDORS, localizeVendor } = await import(corePresets)
const { PROVIDER_FACTS, VENDOR_NAMES, STYLE_PRESET_COUNT } = await import(siteFacts)

const kindOf = { llm: 'llm', image: 'image', video: 'video', speech: 'tts' }
const sorted = (list) => [...new Set(list)].sort()

test('the provider numbers on the page are the ones in packages/core', () => {
  const tested = PROVIDER_PRESETS.filter((p) => p.verification.status === 'tested')
  const documented = PROVIDER_PRESETS.filter((p) => p.verification.status === 'documented')
  assert.equal(
    tested.length + documented.length,
    PROVIDER_PRESETS.length,
    'an unknown verification status',
  )
  assert.equal(PROVIDER_FACTS.total, PROVIDER_PRESETS.length, 'total presets')
  assert.equal(PROVIDER_FACTS.tested, tested.length, 'tested presets')
  assert.equal(PROVIDER_FACTS.documented, documented.length, 'not tested presets')
  assert.equal(
    PROVIDER_FACTS.vendors,
    new Set(PROVIDER_PRESETS.map((p) => p.vendor)).size,
    'vendors',
  )
  assert.equal(PROVIDER_FACTS.vendors, PROVIDER_VENDORS.length, 'vendors listed in core')
  assert.equal(
    PROVIDER_FACTS.accountSignIn,
    PROVIDER_PRESETS.filter((p) => p.auth.type === 'account_login').length,
    'account sign-in presets',
  )
  assert.equal(
    PROVIDER_FACTS.noAuth,
    PROVIDER_PRESETS.filter((p) => p.auth.type === 'none').length,
    'presets without authentication',
  )
})

test('the per-kind provider numbers and vendors on the page are the ones in packages/core', () => {
  for (const [kind, coreKind] of Object.entries(kindOf)) {
    const ofKind = PROVIDER_PRESETS.filter((p) => p.kind === coreKind)
    const tested = ofKind.filter((p) => p.verification.status === 'tested')
    const documented = ofKind.filter((p) => p.verification.status === 'documented')
    const facts = PROVIDER_FACTS.kinds[kind]
    assert.equal(facts.tested, tested.length, `${kind}: tested`)
    assert.equal(facts.documented, documented.length, `${kind}: not tested`)
    assert.deepEqual(
      sorted(facts.testedVendors),
      sorted(tested.map((p) => p.vendor)),
      `${kind}: tested vendors`,
    )
    assert.deepEqual(
      sorted(facts.documentedVendors),
      sorted(documented.map((p) => p.vendor)),
      `${kind}: not tested vendors`,
    )
  }
  const kinds = new Set(PROVIDER_PRESETS.map((p) => p.kind))
  assert.deepEqual(
    sorted([...kinds]),
    sorted(Object.values(kindOf)),
    'a new kind of provider needs a place on the page',
  )
})

test('vendor names on the page equal the ones in packages/core', () => {
  assert.deepEqual(sorted(Object.keys(VENDOR_NAMES)), sorted(PROVIDER_VENDORS.map((v) => v.id)))
  for (const id of Object.keys(VENDOR_NAMES)) {
    assert.equal(VENDOR_NAMES[id].zh, localizeVendor(id, 'zh').label, `${id} (zh)`)
    assert.equal(VENDOR_NAMES[id].en, localizeVendor(id, 'en').label, `${id} (en)`)
  }
})

test(
  'the number of style presets stated on the page matches packages/core',
  { skip: !existsSync(stylesFile) },
  () => {
    const data = JSON.parse(readFileSync(stylesFile, 'utf8'))
    assert.equal(
      STYLE_PRESET_COUNT,
      data.groups.reduce((n, g) => n + g.presets.length, 0),
    )
  },
)

test('page text never types a preset or vendor count by hand', () => {
  const literal =
    /(?<![\w.])\d+\s*(个(服务商)?预设|个厂商|家厂商|presets?\b|vendors?\b)|[二三四五六七八九十两]+个(服务商)?预设|\b(four|six|sixteen|forty|thirty-six|twenty)\s+(provider\s+)?(presets?|vendors?)\b/i
  for (const file of ['zh.ts', 'en.ts']) {
    const lines = read(`apps/site/src/content/${file}`).split('\n')
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return
      assert.ok(
        !literal.test(line),
        `${file}:${i + 1} has a hand-typed count: ${line.trim().slice(0, 80)}`,
      )
    })
  }
})

test('the installers named on the page are a version the changelog lists as released', () => {
  const site = read('apps/site/src/content/site.ts')
  const published = /PUBLISHED_VERSION = '([^']+)'/.exec(site)?.[1]
  assert.ok(published, 'PUBLISHED_VERSION not found')
  const changelog = read('CHANGELOG.md')
  assert.ok(
    new RegExp(`^## \\[${published.replace(/[.]/g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}`, 'm').test(
      changelog,
    ),
    `CHANGELOG.md has no released section for ${published}`,
  )
})

// ---------- screenshots: the site copies must be the ones in docs/assets/readme ----------
test('every screenshot on the page is identical to the one in docs/assets/readme', () => {
  for (const lang of ['zh', 'en']) {
    const dir = path.join(repo, 'apps/site/src/assets/shots', lang)
    for (const name of readdirSync(dir)) {
      const mine = readFileSync(path.join(dir, name))
      const theirs = path.join(repo, 'docs/assets/readme', lang, name)
      assert.ok(existsSync(theirs), `${lang}/${name} is no longer in docs/assets/readme`)
      assert.ok(
        mine.equals(readFileSync(theirs)),
        `${lang}/${name} differs from docs/assets/readme: copy the new one`,
      )
    }
  }
})
