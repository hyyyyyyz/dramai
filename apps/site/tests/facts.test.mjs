// Page text that mirrors data elsewhere in the repository is checked against that data.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

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

test('the page shows the version of this package', () => {
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
