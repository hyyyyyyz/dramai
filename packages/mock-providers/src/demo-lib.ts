import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { PlatformPath } from 'node:path'
import { loadCatalog } from '@dramai/core'
import type { ModelCapability } from '@dramai/core'

/**
 * 用户在命令行里写的相对路径，按**用户执行命令时所在的目录**解析。
 *
 * `pnpm demo`（和 npm / yarn 的脚本）会先把工作目录切到包目录再启动脚本，所以 `process.cwd()` 是
 * `packages/mock-providers`，不是用户所在的目录；包管理器会把用户当时所在的目录放进环境变量 `INIT_CWD`。
 * 直接用 `node` 启动时没有 `INIT_CWD`，用 `process.cwd()`。
 *
 * `pathApi` is the platform's path rules (`path.win32` / `path.posix`); it defaults to the running platform's and is
 * a parameter only so Windows behaviour (`C:\\` drives, UNC, backslashes) can be tested on any machine.
 */
export function resolveUserPath(
  path: string,
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
  pathApi: Pick<PlatformPath, 'isAbsolute' | 'resolve'> = { isAbsolute, resolve },
): string {
  return pathApi.isAbsolute(path) ? path : pathApi.resolve(env.INIT_CWD || cwd, path)
}

export type DemoLang = 'zh' | 'zh-Hant' | 'en'

export interface DemoProviderDef {
  label: string
  kind: 'llm' | 'image' | 'video' | 'tts'
  protocol:
    | 'openai-chat'
    | 'gemini-image'
    | 'openai-images'
    | 'aliyun-video'
    | 'volcengine-video'
    | 'openai-tts'
  model: string
  accept?: readonly string[]
}

/** 演示用的服务商配置；名称按语言给。用 kind + protocol + model 认它们（改了名称也不会重复创建）。 */
export function demoProviders(lang: DemoLang): DemoProviderDef[] {
  // Names per language. Traditional Chinese follows the frontend's zh-TW wording (影片, 服務商, 配音, 演示).
  const L = {
    zh: {
      llm: '大模型（DeepSeek 风格）',
      nano: '文生图（Nano Banana 风格）',
      seedream: '文生图（Seedream 风格）',
      wan: '图生视频（Wan Flash 风格）',
      seedance: '图生视频（Seedance 风格，带人声）',
      tts: '配音',
    },
    'zh-Hant': {
      llm: '大型語言模型（DeepSeek 風格）',
      nano: '文生圖（Nano Banana 風格）',
      seedream: '文生圖（Seedream 風格）',
      wan: '圖生影片（Wan Flash 風格）',
      seedance: '圖生影片（Seedance 風格，帶人聲）',
      tts: '配音',
    },
    en: {
      llm: 'LLM (DeepSeek style)',
      nano: 'Image (Nano Banana style)',
      seedream: 'Image (Seedream style)',
      wan: 'Video (Wan Flash style)',
      seedance: 'Video (Seedance style, with voice)',
      tts: 'Voice-over',
    },
  }[lang]
  const prefix = lang === 'en' ? 'Demo · ' : '演示 · '
  return [
    { label: prefix + L.llm, kind: 'llm', protocol: 'openai-chat', model: 'deepseek-chat' },
    {
      label: prefix + L.nano,
      kind: 'image',
      protocol: 'gemini-image',
      model: 'gemini-2.5-flash-image',
      accept: ['mode:i2i', 'refImages', 'aspectRatio'],
    },
    {
      label: prefix + L.seedream,
      kind: 'image',
      protocol: 'openai-images',
      model: 'doubao-seedream-5-0-260128',
    },
    { label: prefix + L.wan, kind: 'video', protocol: 'aliyun-video', model: 'wan2.2-i2v-flash' },
    {
      label: prefix + L.seedance,
      kind: 'video',
      protocol: 'volcengine-video',
      model: 'doubao-seedance-2-0-fast-260128',
      accept: ['mode:i2v', 'firstFrame', 'duration', 'resolution'],
    },
    {
      label: prefix + L.tts,
      kind: 'tts',
      protocol: 'openai-tts',
      model: 'tts-1',
      accept: ['mode:tts'],
    },
  ]
}

export const DEMO_NOTICE = {
  zh: '演示模式：服务商是本机的模拟服务，不会产生任何费用，生成的是占位内容（不是真实作品）。',
  'zh-Hant':
    '演示模式：服務商是本機的模擬服務，不會產生任何費用，生成的是佔位內容（不是真實作品）。',
  en: 'Demo mode: the providers are local simulations. Nothing is charged, and the generated content is placeholder, not real work.',
} as const

// === 演示价格 ===

/** 演示价格用的币种：`DMO` 不是任何真实货币（三个字母，Intl 格式化不会报错），一看就知道是演示。 */
export const DEMO_CURRENCY = 'DMO'
export const DEMO_PRICE_NOTE =
  '演示价格（虚构，不是真实报价）· Demo price (fictional, not a real quote)'

interface DemoPrice {
  currency: string
  unit: 'per_image' | 'per_second' | 'per_call' | 'per_1k_chars'
  amount: number
  dimensions?: Record<string, string>
  range?: [number, number]
  note: string
}

function demoPrices(def: DemoProviderDef, capability: ModelCapability): DemoPrice[] {
  const price = (
    amount: number,
    extra: Partial<DemoPrice> = {},
    unit: DemoPrice['unit'],
  ): DemoPrice => ({
    currency: DEMO_CURRENCY,
    unit,
    amount,
    note: DEMO_PRICE_NOTE,
    ...extra,
  })
  switch (def.kind) {
    case 'llm':
      return [price(0.02, {}, 'per_1k_chars')]
    case 'tts':
      return [price(0.15, {}, 'per_1k_chars')]
    case 'image':
      // 一个带区间的（界面要能显示“约 / 区间”），一个单价的。
      return def.protocol === 'gemini-image'
        ? [price(0.4, { range: [0.3, 0.5] }, 'per_image')]
        : [price(0.1, {}, 'per_image')]
    case 'video': {
      // 按分辨率档位计价（档位取自模型自己声明的），再给一个不分档的兜底，任何写法的分辨率都有价。
      const base = def.protocol === 'volcengine-video' ? 0.6 : 0.3
      const tiers = capability.resolutions.value?.filter((r) => r !== 'none') ?? []
      return [
        ...tiers.map((resolution, i) =>
          price(
            Math.round(base * (1 + i * 0.6) * 100) / 100,
            { dimensions: { resolution } },
            'per_second',
          ),
        ),
        price(base, {}, 'per_second'),
      ]
    }
  }
}

/** 演示用的模型画像：和真实画像的能力一样，只把价目换成演示价格，并在数据里明确标出（价目的 note、provenance、名称）。 */
export function demoModelProfiles(): unknown[] {
  const registry = loadCatalog().models
  return demoProviders('en').map((def) => {
    const found = registry.lookup({ protocol: def.protocol, model: def.model })
    const profile = found.profile
    return {
      id: profile?.id ?? def.model,
      protocol: def.protocol,
      apiModel: def.model,
      displayName: `${profile?.displayName ?? def.model} · demo prices`,
      capability: found.capability,
      pricing: demoPrices(def, found.capability),
      prompt: profile?.prompt ?? { lang: 'zh', negative: 'inline' },
      quirks: [...(profile?.quirks ?? []), 'DEMO PRICES: fictional, in the made-up currency DMO.'],
      provenance: `DEMO PRICES — fictional, invented for the demo (currency ${DEMO_CURRENCY}); capability data: ${profile?.provenance ?? 'conservative defaults, no model profile'}`,
    }
  })
}

/**
 * 把演示价格写进数据目录的用户覆盖目录（`<dataDir>/catalog/models/`），服务启动时按"同型号后者覆盖前者"加载。
 * 这是演示数据目录里的普通数据文件，服务端没有任何演示价格的特殊分支。
 */
export async function writeDemoCatalog(dataDir: string): Promise<string> {
  const dir = join(dataDir, 'catalog', 'models')
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'demo-prices.json')
  await writeFile(file, JSON.stringify({ schemaVersion: 1, models: demoModelProfiles() }, null, 2))
  return file
}
