import type { AspectRatio } from '../domain/common.ts'

/**
 * 服务商适配器契约（A6）。
 *
 * 每个协议是一组**不碰网络的纯函数**：构造请求、解析响应、构造轮询请求、解析轮询响应。
 * 统一的执行器（executor.ts）负责 fetch、重试、轮询节奏、下载，`fetch` 可注入，所以协议
 * 可以做表驱动单测，执行器用假 fetch 测错误路径。
 *
 * API Key 只作为调用参数（`AuthContext.apiKey`）进入适配器：不写入配置对象、不进环境变量。
 */

export type ProviderKind = 'llm' | 'image' | 'video' | 'tts'

export type ProtocolId =
  | 'openai-chat'
  | 'openai-images'
  | 'gemini-image'
  | 'aliyun-video'
  | 'volcengine-video'
  | 'kling-video'
  | 'generic-video'
  | 'openai-tts'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'gemini-chat'
  | 'volcengine-images'
  | 'dashscope-image'
  | 'siliconflow-images'
  | 'kling-image'

/**
 * 同步返回结果的协议：请求发出后直接拿到成品，根本没有上游任务号可查。
 * （视频协议是异步的：提交 → 任务号 → 轮询。）
 */
export const SYNC_PROTOCOLS: readonly ProtocolId[] = [
  'openai-chat',
  'openai-images',
  'gemini-image',
  'openai-tts',
  'openai-responses',
  'anthropic-messages',
  'gemini-chat',
  'volcengine-images',
  'dashscope-image',
  'siliconflow-images',
]

/** 账号登录通道。现在只有 OpenAI 一种；加通道 = 在这里加一项，并在 CredentialResolver 里注册。 */
export type LoginChannelId = 'openai-chatgpt' | 'openrouter'

export const LOGIN_CHANNELS: readonly LoginChannelId[] = ['openai-chatgpt', 'openrouter']

/**
 * 服务商的鉴权方式。
 * - `api_key`：Key 在 SecretStore（`secretRef`）。
 * - `account_login`：厂商官方的账号登录（令牌在 SecretStore，由登录通道负责刷新）。
 * - `none`：不需要鉴权（本地模型）。
 * 旧数据没有这个字段：见 `effectiveAuth`（有 Key 按 API Key，否则按无需鉴权）。
 */
export type ProviderAuth =
  | { type: 'api_key' }
  | { type: 'account_login'; channel: LoginChannelId }
  | { type: 'none' }

/**
 * 文本服务商之间的"方言"差异，每个服务商配置自己带一份（预设里预填，用户可以看、可以改）。
 * 协议层把它用在请求里；不认识的字段不会报错，只是不生效。
 */
export interface ProviderDialect {
  /**
   * 合并进请求体的额外字段（深合并，覆盖协议层自己生成的同名字段，但 `model`、`messages`、`input`、`contents`、
   * `stream`、`store` 不能被覆盖）。典型用途：给默认开思考的模型关思考，例如 `{ "enable_thinking": false }`、
   * `{ "thinking": { "type": "disabled" } }`、`{ "reasoning_effort": "low" }`。
   */
  extraBody?: Record<string, unknown>
  /** openai-chat 的输出长度字段名：OpenAI / Moonshot / MiniMax 等新字段，其他多数用 `max_tokens`。缺省 `max_tokens`。 */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens'
  /**
   * 要 JSON 输出时怎么交付：`json_object`（缺省，发 `response_format`）或 `prompt_only`（不发，靠提示词 +
   * 解析重试；给不支持 `json_object` 的服务商用）。
   */
  jsonMode?: 'json_object' | 'prompt_only'
  /**
   * 额外请求头（例如 Anthropic 对没有限定到单个工作区的 API Key 要求的 `anthropic-workspace-id`）。
   * 不能覆盖鉴权头、内容类型头和协议的版本头。
   */
  extraHeaders?: Record<string, string>
}

/**
 * 预设（和由它创建的配置）的验证状态。
 * - `tested`：端到端实测过，带日期；
 * - `documented`：按官方文档接入，没有实测，带文档出处。**不自动成为当前选择。**
 */
export type ProviderVerification =
  | { status: 'tested'; testedAt: string }
  | { status: 'documented'; source: string }

/** 持久化的服务商配置。**不含 API Key**；Key 通过 `secretRef` 从 SecretStore 取。 */
export interface ProviderConfig {
  id: string
  label: string
  kind: ProviderKind
  protocol: ProtocolId
  baseUrl: string
  model: string
  /** 缺省 = 旧数据，按 `effectiveAuth` 推断。 */
  auth?: ProviderAuth
  /**
   * API Key（`api_key`）或登录凭据（`account_login`）在 SecretStore 里的键。
   */
  secretRef?: string
  enabled: boolean
  /** 来自预设时的预设 id。 */
  presetId?: string
  notes?: string
  /** 最近一次验证通过的日期（ISO，yyyy-mm-dd）。 */
  verifiedAt?: string
  /** 由预设创建时的验证状态。没有 = 用户自己加的配置，不声称验证过。 */
  verification?: ProviderVerification
  /** 方言差异（额外请求体、输出长度字段名、JSON 模式）。 */
  dialect?: ProviderDialect
  knownLimitations?: string[]
  /** 用户对某个模型能力的覆盖（自定义模型时用）。 */
  capabilityOverrides?: Partial<ModelCapability>
  /**
   * 用户已确认“可以在这个能力未验证的情况下照常生成”的能力项（如 `refImages`、`mode:i2i`）。
   * 记在配置上，避免每个批次都要重复确认；只对这个服务商配置生效。
   */
  acceptedUnverified?: string[]
}

/** 每次调用时传入适配器的鉴权/路由信息。 */
export interface AuthContext {
  baseUrl: string
  model: string
  /**
   * 凭据：`api_key` 时是 API Key，`account_login` 时是当前有效的访问令牌（调用前已由 CredentialResolver
   * 刷新），`none` 时为空。**由协议决定怎么发**：多数放 `Authorization: Bearer`，Anthropic 用 `x-api-key`，
   * Gemini 用 `x-goog-api-key`。
   */
  apiKey?: string
  /** 鉴权方式；缺省 = `api_key`。协议层据此处理登录方式下的额外要求（例如 openai-responses）。 */
  method?: ProviderAuth['type']
  channel?: LoginChannelId
  /** 服务商配置里的方言差异（文本协议用）。 */
  dialect?: ProviderDialect
}

export interface BinaryImage {
  bytes: Uint8Array
  mime: string
}

export interface HttpRequestSpec {
  method: 'GET' | 'POST'
  url: string
  headers: Record<string, string>
  /** json：序列化后发送；form：multipart，**不要**设 Content-Type（边界由 fetch 生成）。 */
  body?: { type: 'json'; value: unknown } | { type: 'form'; value: FormData }
}

export interface RawResponse {
  status: number
  headers: Record<string, string>
  /** 响应文本（binary 协议下为空）。 */
  text: string
  /** `text` 解析成功的 JSON，否则 undefined。 */
  json?: unknown
  /** 仅 `responseType: 'binary'` 的协议会有。 */
  bytes?: Uint8Array
}

export type OutputRef =
  | { kind: 'url'; url: string; mime?: string }
  | { kind: 'bytes'; bytes: Uint8Array; mime: string }

export type GenerateParse =
  | { status: 'sync'; outputs: OutputRef[] }
  | { status: 'async'; taskId: string }
  | { status: 'failed'; message: string }

export type PollParse =
  | { status: 'queued' | 'processing'; progress?: number; message?: string }
  | { status: 'completed'; outputs: OutputRef[]; durationSec?: number }
  | { status: 'failed'; message: string }

export interface MediaProtocol<Input> {
  id: ProtocolId
  media: 'image' | 'video' | 'audio'
  /** 默认 json。 */
  responseType?: 'json' | 'binary'
  /** 单次提交请求的超时（毫秒）；比执行器默认的 120 秒长的协议（同步大图）在这里声明。 */
  requestTimeoutMs?(auth: AuthContext): number | undefined
  buildGenerateRequest(auth: AuthContext, input: Input): HttpRequestSpec
  parseGenerateResponse(raw: RawResponse): GenerateParse
  buildPollRequest?(auth: AuthContext, taskId: string): HttpRequestSpec
  parsePollResponse?(raw: RawResponse): PollParse
}

export interface ImageGenInput {
  prompt: string
  negativePrompt?: string
  n?: number
  /** 精确像素尺寸（来自输出尺寸规则）。 */
  size?: { width: number; height: number }
  aspectRatio?: AspectRatio
  quality?: 'standard' | 'hd'
  references?: BinaryImage[]
}

export interface VideoGenInput {
  prompt: string
  /** 附加运镜说明，会拼到提示词后面。 */
  cameraInstruction?: string
  image: BinaryImage
  lastImage?: BinaryImage
  durationSec?: number
  /** 该模型支持的时长档；缺省时协议用自己的默认档。 */
  allowedDurations?: number[]
  aspectRatio?: AspectRatio
  /** 分辨率档位，大小写按协议各自要求（"720P" / "720p"）。 */
  resolution?: string
  withAudio?: boolean
}

export interface SpeechInput {
  text: string
  voice?: string
  format?: 'mp3' | 'wav' | 'ogg'
  speed?: number
}

// === 模型能力与价目 ===

export type GenerationMode = 't2i' | 'i2i' | 't2v' | 'i2v' | 'first_last' | 'omni_ref' | 'tts'

export interface DurationRule {
  /** 离散档位，例如 [5] 或 [3,4,5,10,15]。 */
  values?: number[]
  /** 连续范围（含端点），整数秒。 */
  min?: number
  max?: number
}

/**
 * 能力的三态：支持 / 不支持 / 未验证。
 *
 * - `supported`：本项目实测过，可用。
 * - `unsupported`：已知不可用（实测失败，或协议/服务商明确没有）。
 * - `unverified`：没验证过。可能带一个“官方/注释里声称的值”（`value`），但**不假装知道**。
 *
 * 准入检查对三态的处理规则见 `admission/index.ts` 顶部。
 */
export type Support = 'supported' | 'unsupported' | 'unverified'

/** 带值的能力：`value` 是声称/实测的值（如参考图上限），含义随 `support` 而定。 */
export interface Claim<T> {
  support: Support
  value?: T
  note?: string
}

/** 模型级能力描述：能力以"模型"为单位，不是"服务商"。 */
export interface ModelCapability {
  media: 'image' | 'video' | 'audio'
  /** 最近一次验证这份描述的日期（ISO）。从未验证为 undefined。 */
  verifiedAt?: string
  /** 各生成模式的支持情况；没写的模式按 `unverified`。 */
  modes: Partial<Record<GenerationMode, Support>>
  /** 参考图：value = 上限张数。 */
  refImages: Claim<number>
  refVideos: Claim<number>
  refAudios: Claim<number>
  refAudioMaxTotalSec?: number
  firstFrame: Support
  lastFrame: Support
  /** 是否自带人声（原生音频）。 */
  nativeAudio: Support
  durations: Claim<DurationRule>
  /** 分辨率档位；"none" = 不传该参数（不要用空字符串占位）。 */
  resolutions: Claim<string[]>
  aspectRatios: Claim<AspectRatio[]>
  /** 输出比例跟随输入图（图生视频常见），此时画幅不需要模型“支持”。这是已知的协议事实。 */
  aspectFromSource?: boolean
  maxPromptChars?: number
  /** 尺寸取整步长（输出尺寸规则里的 k）。 */
  sizeStep?: number
  maxLongSide?: number
  maxPixels?: number
}

/**
 * 价目：按**服务商的原始计量单位和币种**存（如 PTC、CNY、USD）。
 * 不在这里折算；折算成人民币是用户可改的可选设置（`CostDisplaySettings`），默认不折算。
 */
export interface PriceEntry {
  /** 服务商原始币种/点数（PTC、CNY、USD …）。 */
  currency: string
  /** 计价单位。 */
  unit: 'per_image' | 'per_second' | 'per_call' | 'per_1k_chars'
  amount: number
  /** 按维度匹配，例如 { resolution: '720P' }。缺省维度 = 通配。 */
  dimensions?: Record<string, string>
  /** 价格是区间估算时的上下界。 */
  range?: [number, number]
  note?: string
}

export interface ModelProfile {
  id: string
  protocol: ProtocolId
  /** 请求里的 model 名。注册键（id）与 API 模型名解耦。 */
  apiModel: string
  displayName: string
  capability: ModelCapability
  /** 空 = 未定价（如实标"未定价"，不猜）。 */
  pricing: PriceEntry[]
  /** 提示词写法（语义内容之外的、各模型自己的写法）。 */
  prompt: PromptDialect
  /** 已知脾气，给人和提示词编译器看的。 */
  quirks: string[]
  /** 这份画像的依据与日期。 */
  provenance: string
}

/** 模型"想怎么被写提示词"：与提示词的语义内容分层（A16/A17）。 */
export interface PromptDialect {
  lang: 'zh' | 'en'
  /** 建议长度（字符），非硬限。 */
  recommendedMaxChars?: number
  /** 参考图在提示词里的指称方式，`{n}` 为图序号，`{name}` 为资产名。 */
  referenceBinding?: string
  /** 恒追加在最后的句子（例如防字地板）。 */
  suffixFloor?: string[]
  /** 负面提示怎么交付：独立字段 / 该模型不支持（丢弃并告警）/ 并入正文。 */
  negative: 'field' | 'none' | 'inline'
  /** 不听的字段（编译时丢弃并告警）。 */
  ignores?: string[]
}
