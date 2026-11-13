import type { Locale, TranslatedLocale } from '../i18n.ts'
import { TEXT_PRESETS } from './presets-text.ts'
import type {
  ProviderAuth,
  ProviderConfig,
  ProviderDialect,
  ProviderKind,
  ProviderVerification,
} from './types.ts'

/**
 * 预设服务商。每个预设都标明验证状态，界面如实显示：
 * - `tested`：端到端实测过（带日期）；
 * - `documented`：按官方文档接入、**没有实测**（带文档出处）。这类预设不作为默认推荐，
 *   也不会自动成为当前选择——用户要自己选，才不会以为"预设 = 一定能用"。
 *
 * 以前的规则是"只放实测过的组合"；覆盖的厂商多了以后守不住，所以改成标明状态。
 * 实测的预设仍然要：(1) 真实跑过；(2) 价格用过；(3) base URL + 协议 + model id 都验证；
 *           (4) 写进 notes 与 verification。
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
/** 预设所属的厂商（设置页按厂商分组用）。名称大多是品牌名，不翻译；翻译了的放在 `i18n`。 */
export interface ProviderVendor {
  id: string
  name: string
  i18n?: Partial<Record<TranslatedLocale, string>>
}

export const PROVIDER_VENDORS: readonly ProviderVendor[] = [
  { id: 'openai', name: 'OpenAI' },
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'google', name: 'Google' },
  { id: 'deepseek', name: 'DeepSeek' },
  {
    id: 'aliyun',
    name: '阿里云百炼',
    i18n: { 'zh-Hant': '阿里雲百煉', en: 'Alibaba Cloud Model Studio' },
  },
  { id: 'volcengine', name: '火山方舟', i18n: { 'zh-Hant': '火山方舟', en: 'Volcengine Ark' } },
  { id: 'zhipu', name: '智谱 AI', i18n: { 'zh-Hant': '智譜 AI', en: 'Zhipu AI' } },
  { id: 'moonshot', name: 'Moonshot AI（Kimi）' },
  { id: 'minimax', name: 'MiniMax' },
  { id: 'siliconflow', name: '硅基流动', i18n: { 'zh-Hant': '矽基流動', en: 'SiliconFlow' } },
  { id: 'openrouter', name: 'OpenRouter' },
  { id: '302ai', name: '302.AI' },
  { id: 'ollama', name: 'Ollama' },
  { id: 'lmstudio', name: 'LM Studio' },
]

export function localizeVendor(vendorId: string, locale: Locale): { id: string; label: string } {
  const v = PROVIDER_VENDORS.find((x) => x.id === vendorId)
  if (!v) return { id: vendorId, label: vendorId }
  return { id: v.id, label: locale === 'zh' ? v.name : (v.i18n?.[locale] ?? v.name) }
}

/** 官方服务的地区：`cn` 国内站、`global` 国际站 / 全球、`local` 本机服务。 */
export type PresetRegion = 'cn' | 'global' | 'local'

export interface ProviderPreset {
  id: string
  label: string
  /** 厂商 id（见 `PROVIDER_VENDORS`），设置页按它分组。 */
  vendor: string
  region?: PresetRegion
  kind: ProviderKind
  protocol: ProviderConfig['protocol']
  baseUrl: string
  /** 地址里要用户自己替换的 `{占位符}` 名（例如阿里云的 `WorkspaceId`）；没有就不写。 */
  baseUrlPlaceholders?: string[]
  suggestedModel: string
  /** 方言差异（额外请求体、输出长度字段名、JSON 模式），创建的配置里会带上这一份，用户可以改。 */
  dialect?: ProviderDialect
  /** 鉴权方式：API Key / 账号登录 / 无需鉴权。 */
  auth: ProviderAuth
  notes: string
  /** 验证状态：已实测（带日期）或按官方文档接入、未实测（带出处）。 */
  verification: ProviderVerification
  /** 最近一次实测日期（ISO），只有 `tested` 才有。 */
  verifiedAt?: string
  knownLimitations: string[]
  /** 其他语言的内置文案（中文是源语言）。 */
  i18n?: Partial<
    Record<TranslatedLocale, { label: string; notes: string; knownLimitations: string[] }>
  >
}

const CORE_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'deepseek-llm',
    vendor: 'deepseek',
    region: 'cn',
    label: 'DeepSeek 直连 (LLM)',
    kind: 'llm',
    protocol: 'openai-chat',
    baseUrl: 'https://api.deepseek.com',
    suggestedModel: 'deepseek-chat',
    notes: '官方直连，中文极强 + 便宜。验证 2026-05',
    auth: { type: 'api_key' },
    verification: { status: 'tested', testedAt: '2026-05-04' },
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
      'zh-Hant': {
        label: 'DeepSeek 直連 (LLM)',
        notes: '官方直連，中文極強 + 便宜。驗證 2026-05',
        knownLimitations: ['純文字模型：不接受圖片輸入，參考圖無法作為多模態上下文傳入。'],
      },
    },
  },
  {
    id: '302-image-seedream',
    vendor: '302ai',
    region: 'global',
    label: '302.AI · 即梦 Seedream 5.0 (字节，便宜)',
    kind: 'image',
    protocol: 'openai-images',
    baseUrl: 'https://api.302.ai/doubao',
    suggestedModel: 'doubao-seedream-5-0-260128',
    notes:
      '约 0.035 PTC/张。验证 2026-05。注意：locked character 参考图当前不通——doubao 期望参考图是 URL 不是 base64',
    auth: { type: 'api_key' },
    verification: { status: 'tested', testedAt: '2026-05-04' },
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
      'zh-Hant': {
        label: '302.AI · 即夢 Seedream 5.0 (位元組跳動，便宜)',
        notes:
          '約 0.035 PTC/張。驗證 2026-05。注意：locked character 參考圖目前不通——doubao 期望參考圖是 URL 不是 base64',
        knownLimitations: [
          '參考圖（角色一致性）經此路徑不生效：服務商期望參考圖是 URL 而不是 base64。需要多參考圖一致性時請改用 Nano Banana。',
        ],
      },
    },
  },
  {
    id: '302-image-nano-banana',
    vendor: '302ai',
    region: 'global',
    label: '302.AI · Nano Banana (Gemini 文生图)',
    kind: 'image',
    protocol: 'gemini-image',
    baseUrl: 'https://api.302.ai',
    suggestedModel: 'gemini-2.5-flash-image',
    notes:
      '⚠️ base URL 不带 /v1（Gemini 协议自己的路径就是 /v1beta/models/{model}:generateContent）。约 0.2-0.5 PTC/张，比 Seedream 贵但指令跟随更精准。验证 2026-05',
    auth: { type: 'api_key' },
    verification: { status: 'tested', testedAt: '2026-05-04' },
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
      'zh-Hant': {
        label: '302.AI · Nano Banana (Gemini 文生圖)',
        notes:
          '⚠️ base URL 不帶 /v1（Gemini 協定自己的路徑就是 /v1beta/models/{model}:generateContent）。約 0.2-0.5 PTC/張，比 Seedream 貴但指令跟隨更精準。驗證 2026-05',
        knownLimitations: ['單價是 0.2–0.5 PTC 的區間，成本估算只能給出區間。'],
      },
    },
  },
  {
    id: '302-i2v-wan-flash',
    vendor: '302ai',
    region: 'global',
    label: '⭐ 302.AI · 通义万相 Wan2.2 Flash (最便宜 · 阿里)',
    kind: 'video',
    protocol: 'aliyun-video',
    baseUrl: 'https://api.302ai.cn',
    suggestedModel: 'wan2.2-i2v-flash',
    notes:
      '🟢 性价比之王：5 秒 720P 仅约 0.2 PTC，6 个分镜 ≈ 1.2 PTC（¥8 左右）；duration 固定 5 秒。验证 2026-05',
    auth: { type: 'api_key' },
    verification: { status: 'tested', testedAt: '2026-05-04' },
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
      'zh-Hant': {
        label: '⭐ 302.AI · 通義萬相 Wan2.2 Flash (最便宜 · 阿里)',
        notes:
          '🟢 性價比之王：5 秒 720P 僅約 0.2 PTC，6 個分鏡 ≈ 1.2 PTC（¥8 左右）；時長固定 5 秒。驗證 2026-05',
        knownLimitations: ['時長固定 5 秒；不支援首尾影格；不帶人聲。', '輸出比例跟隨起始影格。'],
      },
    },
  },
  {
    id: 'openai-responses-login',
    vendor: 'openai',
    region: 'global',
    label: 'OpenAI（账号登录 · 文本）',
    kind: 'llm',
    protocol: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    suggestedModel: 'gpt-6.1-sol',
    auth: { type: 'account_login', channel: 'openai-chatgpt' },
    verification: {
      status: 'documented',
      source: 'https://developers.openai.com/siwc/token-sharing-open-source',
    },
    notes:
      '用 ChatGPT 账号登录，调用公开的 Responses 接口，用量算在你的 ChatGPT 订阅里，不需要 API Key。按官方文档接入，未实测。模型名取自官方示例，登录后请从模型列表里选',
    knownLimitations: [
      '只覆盖文本，不含生图、视频和语音。',
      '需要 ChatGPT 订阅：官方快速开始页写明符合条件的 Plus 和 Pro 用户可用，预览期具体支持哪些套餐文档未说明。',
      '用量按 ChatGPT 套餐的限额计算（Plus 有五小时用量上限，在所有使用该订阅的应用之间共享），超限会在生成中途失败。',
      '登录方式不接受 temperature、top_p、max_output_tokens 等参数，这些设置会被忽略。',
    ],
    i18n: {
      en: {
        label: 'OpenAI (account sign-in · text)',
        notes:
          'Sign in with your ChatGPT account and call the public Responses API; usage counts against your ChatGPT subscription and no API key is needed. Connected from the official documentation, not tested end to end. The model name comes from the official example; pick one from the model list after signing in',
        knownLimitations: [
          'Text only: no image generation, video or speech.',
          'Needs a ChatGPT subscription: the official quickstart says eligible Plus and Pro users can use it; which plans are supported during the preview is not stated in the documentation.',
          'Usage counts against the ChatGPT plan limits (Plus has a five-hour limit shared by every app that uses the subscription); going over it fails the request partway through.',
          'Sign-in does not accept temperature, top_p, max_output_tokens and similar parameters; those settings are ignored.',
        ],
      },
      'zh-Hant': {
        label: 'OpenAI（帳號登入 · 文字）',
        notes:
          '用 ChatGPT 帳號登入，呼叫公開的 Responses 介面，用量算在你的 ChatGPT 訂閱裡，不需要 API Key。依官方文件接入，尚未實測。模型名稱取自官方範例，登入後請從模型清單裡選',
        knownLimitations: [
          '只涵蓋文字，不含生圖、影片和語音。',
          '需要 ChatGPT 訂閱：官方快速開始頁寫明符合條件的 Plus 和 Pro 使用者可用，預覽期具體支援哪些方案文件未說明。',
          '用量依 ChatGPT 方案的額度計算（Plus 有五小時用量上限，在所有使用該訂閱的應用程式之間共用），超限會在生成中途失敗。',
          '登入方式不接受 temperature、top_p、max_output_tokens 等參數，這些設定會被忽略。',
        ],
      },
    },
  },
]

/** 全部预设：v0.4 实测的四个、OpenAI 账号登录，以及第一批文本服务商（按官方文档接入、未实测）。 */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [...CORE_PRESETS, ...TEXT_PRESETS]

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
    auth: preset.auth,
    ...(preset.dialect ? { dialect: structuredClone(preset.dialect) } : {}),
    secretRef: options.secretRef,
    enabled: true,
    presetId: preset.id,
    notes: preset.notes,
    verification: preset.verification,
    ...(preset.verifiedAt ? { verifiedAt: preset.verifiedAt } : {}),
    knownLimitations: [...preset.knownLimitations],
  }
}

// === 本地化 ===

/** 预设的某一语言版本（没有翻译回退中文）。 */
export function localizeProviderPreset(
  preset: ProviderPreset,
  locale: Locale,
): Pick<ProviderPreset, 'label' | 'notes' | 'knownLimitations'> {
  const t = locale === 'zh' ? undefined : preset.i18n?.[locale]
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
