// The landing page keeps its own copy of the design tokens (it does not import workspace code).
// These tests make sure that copy cannot drift from packages/ui or from itself.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const site = readFileSync(path.join(here, '../src/styles/tokens.css'), 'utf8')
const ui = readFileSync(path.join(here, '../../../packages/ui/src/v2/styles/theme.css'), 'utf8')

/** The declarations of the first rule whose selector line matches. */
function block(css, selectorStart) {
  const i = css.indexOf(selectorStart)
  assert.notEqual(i, -1, `selector ${selectorStart} not found`)
  const open = css.indexOf('{', i)
  const close = css.indexOf('}', open)
  const body = css.slice(open + 1, close)
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+?);(?:\s*\/\*.*?\*\/)?/g)].map((m) => [
      m[1],
      m[2].replace(/\s+/g, ' '),
    ]),
  )
}

const siteLight = block(site, ':root {')
const siteDark = block(site, ":root[data-theme='dark'],")
const siteDarkMedia = block(site, ":root:not([data-theme='light']) {")
const uiDark = block(ui, ":root,\n[data-theme='dark'] {")
const uiLight = block(ui, "[data-theme='light'] {")

const colorTokens = Object.keys(siteDark).filter((k) => !k.startsWith('--shadow'))

test('the dark set is identical in the explicit rule and the media query', () => {
  assert.deepEqual(siteDarkMedia, siteDark)
})

test('every colour token has a light and a dark value', () => {
  for (const key of colorTokens) assert.ok(siteLight[key], `${key} missing from the light set`)
})

test('colour tokens equal the ones in packages/ui', () => {
  for (const key of colorTokens) {
    assert.equal(siteDark[key], uiDark[key], `${key} (dark) differs from packages/ui`)
    assert.equal(siteLight[key], uiLight[key], `${key} (light) differs from packages/ui`)
  }
})

test('the accent is the same colour in both themes (brand vermilion)', () => {
  assert.equal(siteLight['--accent'], 'oklch(0.619 0.19 40)')
  assert.equal(siteDark['--accent'], 'oklch(0.619 0.19 40)')
})
