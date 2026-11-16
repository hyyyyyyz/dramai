// Rules for what the landing page may say, shared by tests/content-rules.test.mjs (page source text) and
// scripts/check-dist.mjs (text of the built pages).
//   1. no "302" anywhere in page text (resource paths such as hashed font files are not page text)
//   2. no counts of presets or vendors, and no "preset" as a selling point
//   3. none of the verification wording ("tested end to end", "set up from official documentation", ...)
//   4. no AI provider or model company by name; the only exceptions are the two sign-in channels
//      (ChatGPT account, OpenRouter account) and "OpenAI-compatible" as the name of an interface type
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Vendor display names from packages/core, plus brand names that are not vendors there. */
export async function loadProviderNames() {
  const core = await import(
    pathToFileURL(path.join(here, '../../../packages/core/src/providers/presets.ts')).href
  )
  const names = new Set()
  for (const v of core.PROVIDER_VENDORS) {
    for (const locale of ['zh', 'en', 'zh-Hant']) {
      const label = core.localizeVendor(v.id, locale)?.label
      if (label) names.add(label)
    }
    names.add(v.name)
  }
  // Brand and product names that must not appear even though core no longer lists them as vendors.
  for (const extra of [
    'Seedream',
    'Seedance',
    'Nano Banana',
    'Qwen',
    'Gemini',
    'Claude',
    'GPT',
    'Kimi',
    'GLM',
    '通义',
    '即梦',
    '豆包',
    '可灵',
  ])
    names.add(extra)
  return [...names].filter(Boolean)
}

/** Names that are allowed, and the phrase in which they are allowed. */
const ALLOWED = [
  // the two sign-in channels
  /ChatGPT/g,
  /OpenRouter/g,
  // "OpenAI-compatible" as the name of an interface type
  /OpenAI[ -]?兼容/g,
  /OpenAI-compatible/gi,
]

const COUNTS = [
  /\d+\s*(个)?(服务商)?预设/,
  /[二三四五六七八九十两]+个(服务商)?预设/,
  /\d+\s*(个|家)?厂商/,
  /\b\d+\s+(provider\s+|built-in\s+)?(presets?|vendors?)\b/i,
  /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|sixteen|twenty|thirty|thirty-six|forty)\s+(built-in\s+)?(provider\s+)?(presets?|vendors?)\b/i,
]

const PRESET_WORDS = [/预设/, /\bpresets?\b/i]

const VERIFICATION = [
  /实测/,
  /端到端/,
  /按官方文档/,
  /官方文档接入/,
  /验证状态/,
  /已验证|未验证/,
  /run end to end/i,
  /from (the )?official doc/i,
  /official documentation/i,
  /verification status/i,
  /\b(un)?tested\b/i,
  /\bverified\b/i,
]

/** Returns a list of problems found in `text` (empty when it is fine). `names` comes from loadProviderNames(). */
export function checkText(text, names) {
  const problems = []
  if (/302/.test(text)) problems.push('mentions "302"')
  for (const re of COUNTS)
    if (re.test(text)) problems.push(`states a preset or vendor count (${re})`)
  for (const re of PRESET_WORDS) if (re.test(text)) problems.push(`uses the word "preset" (${re})`)
  for (const re of VERIFICATION)
    if (re.test(text)) problems.push(`uses verification wording (${re})`)

  let rest = text
  for (const allowed of ALLOWED) rest = rest.replace(allowed, ' ')
  const lower = rest.toLowerCase()
  for (const name of names) {
    // Short Latin names are matched as whole words, so "GLM" does not fire inside another word.
    const needle = name.toLowerCase()
    const isLatin = /^[\x00-\x7f]+$/.test(name)
    const hit = isLatin
      ? new RegExp(
          `(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`,
        ).test(lower)
      : lower.includes(needle)
    if (hit) problems.push(`names a provider: ${name}`)
  }
  return problems
}
