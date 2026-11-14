// Numbers the page states about the product. They are counted from the code by tests/facts.test.mjs
// (packages/core presets and styles): change them here only after the code changed, and the test fails
// when the page and the code disagree. Page text must use these values, never a typed-in number.
export const STYLE_PRESET_COUNT = 20

export type ProviderKindId = 'llm' | 'image' | 'video' | 'speech'

export interface KindFacts {
  tested: number
  documented: number
  /** Vendor ids (packages/core PROVIDER_VENDORS) with at least one tested / untested preset of this kind. */
  testedVendors: string[]
  documentedVendors: string[]
}

export const PROVIDER_FACTS: {
  total: number
  tested: number
  documented: number
  vendors: number
  /** Presets that sign in with an account instead of a key. */
  accountSignIn: number
  /** Presets that need no authentication (a model on your own machine). */
  noAuth: number
  kinds: Record<ProviderKindId, KindFacts>
} = {
  total: 40,
  tested: 4,
  documented: 36,
  vendors: 16,
  accountSignIn: 2,
  noAuth: 2,
  kinds: {
    llm: {
      tested: 1,
      documented: 16,
      testedVendors: ['deepseek'],
      documentedVendors: [
        'openai',
        'anthropic',
        'google',
        'aliyun',
        'volcengine',
        'zhipu',
        'moonshot',
        'minimax',
        'siliconflow',
        'openrouter',
        '302ai',
        'ollama',
        'lmstudio',
      ],
    },
    image: {
      tested: 2,
      documented: 8,
      testedVendors: ['302ai'],
      documentedVendors: [
        'openai',
        'volcengine',
        'minimax',
        'google',
        'aliyun',
        'siliconflow',
        'kling',
      ],
    },
    video: {
      tested: 1,
      documented: 6,
      testedVendors: ['302ai'],
      documentedVendors: ['volcengine', 'byteplus', 'kling', 'aliyun'],
    },
    speech: {
      tested: 0,
      documented: 6,
      testedVendors: [],
      documentedVendors: ['openai', 'siliconflow', 'minimax', 'aliyun'],
    },
  },
}

/** Display names of the vendors, as in packages/core (zh: `name`, en: `i18n.en` or `name`). */
export const VENDOR_NAMES: Record<string, { zh: string; en: string }> = {
  openai: { zh: 'OpenAI', en: 'OpenAI' },
  anthropic: { zh: 'Anthropic', en: 'Anthropic' },
  google: { zh: 'Google', en: 'Google' },
  deepseek: { zh: 'DeepSeek', en: 'DeepSeek' },
  aliyun: { zh: '阿里云百炼', en: 'Alibaba Cloud Model Studio' },
  volcengine: { zh: '火山方舟', en: 'Volcengine Ark' },
  zhipu: { zh: '智谱 AI', en: 'Zhipu AI' },
  moonshot: { zh: 'Moonshot AI（Kimi）', en: 'Moonshot AI（Kimi）' },
  minimax: { zh: 'MiniMax', en: 'MiniMax' },
  kling: { zh: '可灵', en: 'Kling AI' },
  byteplus: { zh: 'BytePlus', en: 'BytePlus' },
  siliconflow: { zh: '硅基流动', en: 'SiliconFlow' },
  openrouter: { zh: 'OpenRouter', en: 'OpenRouter' },
  '302ai': { zh: '302.AI', en: '302.AI' },
  ollama: { zh: 'Ollama', en: 'Ollama' },
  lmstudio: { zh: 'LM Studio', en: 'LM Studio' },
}

/** Presets of one kind, tested and not tested together. */
export function kindTotal(kind: ProviderKindId): number {
  const k = PROVIDER_FACTS.kinds[kind]
  return k.tested + k.documented
}
