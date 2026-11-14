import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en'
import zhTW from '@/i18n/locales/zh-TW'
import zh from '@/i18n/locales/zh-CN'

/**
 * No sentence in any language may state, without a basis, that something is not charged or free. Whether a failed or
 * refused request is billed is not written in any provider's official pages, so a sentence like "if it doesn't exist
 * the provider refuses and doesn't charge" is an invention. Cautious wording ("may have been charged") and facts the app
 * itself can vouch for are fine; the second kind is listed below, each with its basis.
 */
const FORBIDDEN: RegExp[] = [
  /不收[费費]/,
  /不计费|不計費/,
  /不会收费|不會收費|不会被收费|不會被收費/,
  /免[费費]/,
  /不花[钱錢]/,
  /不产生费用|不產生費用|不会产生费用|不會產生費用/,
  /doesn[’']t charge|does not charge|dramai charges nothing/i,
  /no charge/i,
  /free of charge/i,
  /won[’']t be charged|will not be charged|nothing is charged|not charged/i,
]

/** Sentences that may stay, by key path (the same key in every language), each with why it is true. */
const ALLOWED: Record<string, string> = {
  'providerLogin.channels.openai-chatgpt.intro':
    'about dramai itself: the app has no billing; the ChatGPT plan is billed by OpenAI to the user',
  'providerLogin.channels.openrouter.intro':
    'about dramai itself: the app has no billing; usage is billed by OpenRouter to the user',
  'compose.render.honest': 'rendering is done on this machine with ffmpeg: no provider is called',
  'shell.demoNotice':
    'in demo mode the providers are local simulators: no external request is made',
  'storyboard.batch.blockedBody':
    'a blocked batch creates no job (all-or-nothing, the server and the dialog tests check it), so no request is sent to any provider',
}

function flatten(obj: unknown, prefix = ''): [string, string][] {
  if (typeof obj === 'string') return [[prefix, obj]]
  if (obj && typeof obj === 'object')
    return Object.entries(obj).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
  return []
}

const dicts = { 'zh-CN': zh, 'zh-TW': zhTW, en } as const

describe('wording about charging', () => {
  for (const [name, dict] of Object.entries(dicts)) {
    it(`${name}: no unfounded "not charged" / "free" sentence`, () => {
      const hits = flatten(dict)
        .filter(([, text]) => FORBIDDEN.some((re) => re.test(text)))
        .filter(([key]) => !(key in ALLOWED))
        .map(([key, text]) => `${key}: ${text}`)
      expect(hits).toEqual([])
    })
  }

  it('every allowed sentence still exists and still needs its entry (the list does not rot)', () => {
    for (const key of Object.keys(ALLOWED)) {
      const matches = flatten(zh).filter(([k]) => k === key)
      expect(matches.length, key).toBeGreaterThan(0)
      expect(
        matches.some(([, text]) => FORBIDDEN.some((re) => re.test(text))),
        `${key} no longer matches a forbidden pattern: remove it from the list`,
      ).toBe(true)
    }
  })

  it('the unlisted-voice sentence, the one that was wrong, is cautious in every language', () => {
    for (const dict of Object.values(dicts)) {
      const text = (dict.reasons as unknown as Record<string, string>).VOICE_UNLISTED!
      expect(text).toBeTruthy()
      expect(FORBIDDEN.some((re) => re.test(text))).toBe(false)
    }
  })
})
