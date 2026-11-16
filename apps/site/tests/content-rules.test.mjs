// The page introduces the product; it does not name providers, count presets or grade verification.
// The rules live in scripts/content-rules.mjs. They run here on the page source (both languages) and in
// scripts/check-dist.mjs on the text of the built pages.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkText, loadProviderNames } from '../scripts/content-rules.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const names = await loadProviderNames()

/** Text of the content files: the string literals only, so code and variable names are not scanned. */
function pageStrings(file) {
  const source = readFileSync(path.join(here, '../src/content', file), 'utf8')
  return [...source.matchAll(/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)]
    .map((m) => (m[1] ?? m[2] ?? '').replace(/\$\{[^}]*\}/g, ' '))
    .filter((t) => /[^\x00-\x7f]|[a-z]{3,}/i.test(t))
}

test('the vendor name list is read from packages/core and is not empty', () => {
  assert.ok(names.length >= 15, `only ${names.length} names`)
  assert.ok(names.includes('Anthropic'))
})

for (const file of ['zh.ts', 'en.ts']) {
  test(`${file}: no 302, preset or vendor counts, verification wording or provider names`, () => {
    const bad = []
    for (const text of pageStrings(file)) {
      for (const problem of checkText(text, names)) bad.push(`${problem}: ${text.slice(0, 70)}`)
    }
    assert.deepEqual(bad, [])
  })
}

// Mutation checks: the rules must actually fire on text that breaks them.
test('the rules catch what they are meant to catch', () => {
  const cases = {
    '302.AI 上的模型': '302',
    'Models through 302.AI': '302',
    '内置 40 个预设，覆盖 16 个厂商': 'count',
    '40 built-in presets covering 16 vendors': 'count',
    'Sixteen vendors': 'count',
    四个预设: 'count',
    '其中 4 个经过端到端实测': 'verification',
    其余按官方文档接入: 'verification',
    'Set up from the official docs, not tested': 'verification',
    'run end to end in v0.4': 'verification',
    '支持 DeepSeek 和 Anthropic': 'names a provider',
    'Works with Google Gemini': 'names a provider',
    'OpenAI 的接口': 'names a provider',
    预设目录: 'preset',
  }
  for (const [text, what] of Object.entries(cases)) {
    const found = checkText(text, names)
    assert.ok(
      found.some((p) => p.includes(what)),
      `expected a "${what}" problem in: ${text} (got ${JSON.stringify(found)})`,
    )
  }
})

test('the allowed names do not fire', () => {
  for (const text of [
    '任何提供 OpenAI 兼容接口的服务',
    'Any service with an OpenAI-compatible interface',
    '用 ChatGPT 账号登录',
    'An OpenRouter account hands dramai an API key',
    '剪映 and JianYing are export targets',
  ]) {
    assert.deepEqual(checkText(text, names), [], text)
  }
})
