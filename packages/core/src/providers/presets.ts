import type { Locale } from '../i18n.ts'
import type { ProviderConfig, ProviderKind } from './types.ts'

/**
 * 预设服务商。**只保留经过端到端实测可用的组合**——未实测的不要放进来，
 * 否则用户会以为"预设 = 推荐 = 一定能用"，一次协议问题就会扣冤枉钱。
 *
 * 验证记录（2026-05-04，v0.4 端到端跑通）：
 *   LLM         DeepSeek 直连 + deepseek-chat
 *   文生图      Nano Banana  : api.302.ai / gemini-2.5-flash-image / Gemini 协议
 *   文生图      Seedream 5.0 : api.302.ai/doubao / doubao-seedream-5-0-260128 / OpenAI 兼容
 *   图生视频    Wan2.2 Flash : api.302ai.cn / wan2.2-i2v-flash / 阿里 DashScope
 *
 * 加预设前请：(1) 真实跑过；(2) 价格用过；(3) base URL + 协议 + model id 都验证；
 *           (4) 写进 notes 与 verifiedAt。
 */
export interface ProviderPreset {
  id: string
  label: string
  kind: ProviderKind
  protocol: ProviderConfig['protocol']
  baseUrl: string
  suggestedModel: string
  notes: string
  /** 最近一次验证日期（ISO）。 */
  verifiedAt: string
  knownLimitations: string[]
  /** 其他语言的内置文案（中文是源语言）。 */
  i18n?: { en?: { label: string; notes: string; knownLimitations: string[] } }
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'deepseek-llm',
    label: 'DeepSeek 直连 (LLM)',
    kind: 'llm',
    protocol: 'openai-chat',
    baseUrl: 'https://api.deepseek.com',
    suggestedModel: 'deepseek-chat',
    notes: '官方直连，中文极强 + 便宜。验证 2026-05',
    verifiedAt: '2026-05-04',
    knownLimitations: ['纯文本模型：不接受图片输入，参考图无法作为多模态上下文传入。'],
    i18n: {
      en: {
        label: 'DeepSeek direct (LLM)',
        notes: 'Official direct connection, strong Chinese and cheap. Verified 2026-05',
        knownLimitations: [
          'Text-only model: it does not accept image input, so reference images cannot be passed as multimodal context.',
        ],
      },
    },
  },
  {
    id: '302-image-seedream',
    label: '302.AI · 即梦 Seedream 5.0 (字节，便宜)',
    kind: 'image',
    protocol: 'openai-images',
    baseUrl: 'https://api.302.ai/doubao',
    suggestedModel: 'doubao-seedream-5-0-260128',
    notes:
      '约 0.035 PTC/张。验证 2026-05。注意：locked character 参考图当前不通——doubao 期望参考图是 URL 不是 base64',
    verifiedAt: '2026-05-04',
    knownLimitations: [
      '参考图（角色一致性）经此路径不生效：服务商期望参考图是 URL 而不是 base64。需要多参考图一致性时请换用 Nano Banana。',
    ],
    i18n: {
      en: {
        label: '302.AI · Seedream 5.0 (ByteDance, cheap)',
        notes:
          'About 0.035 PTC per image. Verified 2026-05. Note: locked character reference images currently do not work — doubao expects reference images as URLs, not base64',
        knownLimitations: [
          'Reference images (character consistency) do not take effect on this route: the provider expects reference images as URLs rather than base64. Use Nano Banana when you need multi-reference consistency.',
        ],
      },
    },
  },
  {
    id: '302-image-nano-banana',
    label: '302.AI · Nano Banana (Gemini 文生图)',
    kind: 'image',
    protocol: 'gemini-image',
    baseUrl: 'https://api.302.ai',
    suggestedModel: 'gemini-2.5-flash-image',
    notes:
      '⚠️ base URL 不带 /v1（Gemini 协议自己的路径就是 /v1beta/models/{model}:generateContent）。约 0.2-0.5 PTC/张，比 Seedream 贵但指令跟随更精准。验证 2026-05',
    verifiedAt: '2026-05-04',
    knownLimitations: ['单价是 0.2–0.5 PTC 的区间，成本估算只能给出区间。'],
    i18n: {
      en: {
        label: '302.AI · Nano Banana (Gemini image)',
        notes:
          "⚠️ The base URL has no /v1 (the Gemini protocol's own path is /v1beta/models/{model}:generateContent). About 0.2–0.5 PTC per image: pricier than Seedream but follows instructions more precisely. Verified 2026-05",
        knownLimitations: [
          'The price is a 0.2–0.5 PTC range, so cost estimates can only give a range.',
        ],
      },
    },
  },
  {
    id: '302-i2v-wan-flash',
    label: '⭐ 302.AI · 通义万相 Wan2.2 Flash (最便宜 · 阿里)',
    kind: 'video',
    protocol: 'aliyun-video',
    baseUrl: 'https://api.302ai.cn',
    suggestedModel: 'wan2.2-i2v-flash',
    notes:
      '🟢 性价比之王：5 秒 720P 仅约 0.2 PTC，6 个分镜 ≈ 1.2 PTC（¥8 左右）；duration 固定 5 秒。验证 2026-05',
    verifiedAt: '2026-05-04',
    knownLimitations: ['时长固定 5 秒；不支持首尾帧；不带人声。', '输出比例跟随起始帧。'],
    i18n: {
      en: {
        label: '⭐ 302.AI · Wan2.2 Flash (cheapest · Alibaba)',
        notes:
          '🟢 Best value: 5 s at 720P costs about 0.2 PTC, so 6 shots ≈ 1.2 PTC (around ¥8). Duration is fixed at 5 seconds. Verified 2026-05',
        knownLimitations: [
          'Fixed 5-second duration; no first/last-frame control; no spoken voice.',
          'Output aspect ratio follows the start frame.',
        ],
      },
    },
  },
]

export const PROVIDER_KIND_LABEL: Record<ProviderKind, string> = {
  llm: 'LLM 文本生成',
  image: '文生图 / 图生图',
  video: '图生视频',
  tts: '语音合成',
}

/** 由预设创建一份服务商配置（不含 Key）。 */
export function configFromPreset(
  preset: ProviderPreset,
  options: { id: string; secretRef?: string },
): ProviderConfig {
  return {
    id: options.id,
    label: preset.label,
    kind: preset.kind,
    protocol: preset.protocol,
    baseUrl: preset.baseUrl,
    model: preset.suggestedModel,
    secretRef: options.secretRef,
    enabled: true,
    presetId: preset.id,
    notes: preset.notes,
    verifiedAt: preset.verifiedAt,
    knownLimitations: [...preset.knownLimitations],
  }
}

// === 本地化 ===

/** 预设的某一语言版本（没有翻译回退中文）。 */
export function localizeProviderPreset(
  preset: ProviderPreset,
  locale: Locale,
): Pick<ProviderPreset, 'label' | 'notes' | 'knownLimitations'> {
  const t = locale === 'en' ? preset.i18n?.en : undefined
  return {
    label: t?.label ?? preset.label,
    notes: t?.notes ?? preset.notes,
    knownLimitations: t?.knownLimitations ?? preset.knownLimitations,
  }
}

/**
 * 由预设创建的服务商配置，创建时把预设的中文文案复制进了配置。展示时：没被用户改过的那几项
 * （名称、备注、已知限制，和预设原文一致）换成对应语言；用户改过的原样返回。
 */
export function localizeProviderConfig(
  config: Pick<ProviderConfig, 'presetId' | 'label' | 'notes' | 'knownLimitations'>,
  locale: Locale,
): { label: string; notes?: string; knownLimitations?: string[] } {
  const preset = config.presetId
    ? PROVIDER_PRESETS.find((p) => p.id === config.presetId)
    : undefined
  if (!preset || locale === 'zh') {
    return { label: config.label, notes: config.notes, knownLimitations: config.knownLimitations }
  }
  const t = localizeProviderPreset(preset, locale)
  const sameLimits =
    config.knownLimitations !== undefined &&
    config.knownLimitations.length === preset.knownLimitations.length &&
    config.knownLimitations.every((x, i) => x === preset.knownLimitations[i])
  return {
    label: config.label === preset.label ? t.label : config.label,
    notes: config.notes === preset.notes ? t.notes : config.notes,
    knownLimitations: sameLimits ? t.knownLimitations : config.knownLimitations,
  }
}
