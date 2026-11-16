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
  'the styles on the page are the 20 in packages/core',
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

const siteFacts = pathToFileURL(path.join(repo, 'apps/site/src/content/facts.ts')).href
const { STYLE_COUNT } = await import(siteFacts)

test(
  'the number of styles stated on the page matches packages/core',
  { skip: !existsSync(stylesFile) },
  () => {
    const data = JSON.parse(readFileSync(stylesFile, 'utf8'))
    assert.equal(
      STYLE_COUNT,
      data.groups.reduce((n, g) => n + g.presets.length, 0),
    )
  },
)

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

// ---------- tone: the page introduces the product, it does not apologise for it ----------
test('page text has no negative self-declarations about verification', () => {
  const forbidden = [
    /还没有?连过/,
    /没有(在|对)?真实.{0,8}(试过|调用|验证|跑过)/,
    /(只|仅)用.{0,12}(模拟|自动化测试).{0,8}(验证|测过|检查)/,
    /(只|仅)在模拟.{0,6}(测过|验证)/,
    /从没跑过|没人(验证|用过|打开过)|还没有人/,
    /还没验证|未验证的|没有验证过/,
    /\bnot (yet )?(been )?(run|tried|verified|tested)\b/i,
    /\bnever (been )?(run|tried)\b/i,
    /\bnobody has\b/i,
    /\bsimulated (services?|providers?) only\b/i,
    /\bonly (checked|tested|verified) with\b/i,
    /\bnot verified\b/i,
    /\bwithout polish\b|没有修饰/,
  ]
  for (const file of ['zh.ts', 'en.ts']) {
    const lines = read(`apps/site/src/content/${file}`).split('\n')
    lines.forEach((line, i) => {
      for (const re of forbidden) {
        assert.ok(
          !re.test(line),
          `${file}:${i + 1} reads like a self-deprecating declaration (${re}): ${line.trim().slice(0, 90)}`,
        )
      }
    })
  }
})
