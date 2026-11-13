import type { Catalog } from '../data-dir.ts'
import type { FfmpegBinaries, FfmpegCapabilities } from '../media/ffmpeg.ts'
import type { ImageEncoder } from '../media/reference-images.ts'
import type {
  Clock,
  EventSink,
  FileStore,
  IdGenerator,
  SecretStore,
  Store,
} from '../ports/index.ts'
import type { ExecutorDeps } from '../providers/executor.ts'
import type { ChatMessage } from '../providers/protocols/openai-chat.ts'
import { createCredentialResolver, effectiveAuth } from '../providers/auth.ts'
import { ProviderError } from '../providers/errors.ts'
import type { CredentialResolver } from '../providers/auth.ts'
import type { AuthContext, ProviderConfig } from '../providers/types.ts'
import { streamText } from '../providers/llm.ts'
import type { LlmCallDeps } from '../providers/llm.ts'
import { parseJsonLoose } from '../util/json-loose.ts'
import type { z } from 'zod'

/**
 * 流水线的依赖。全部是端口或可注入的函数——测试里换成假的，server 里换成真的。
 */
export interface LlmRequest {
  /** 任务名（如 `episodes.plan`），用于日志、计费归类，也方便测试里的假 LLM 按任务回放。 */
  task: string
  messages: ChatMessage[]
  jsonMode?: boolean
  temperature?: number
  signal?: AbortSignal
  /** 流式增量回调（可选）：server 用它把文本步骤的输出实时推给前端。回调里抛错不影响请求。 */
  onDelta?: (delta: string, accumulated: string) => void
}

export interface LlmClient {
  complete(req: LlmRequest): Promise<{ text: string }>
}

export interface ProviderDirectory {
  get(id: string): Promise<ProviderConfig | undefined>
  list(): Promise<ProviderConfig[]>
}

export interface MediaTools {
  bins: FfmpegBinaries
  caps: FfmpegCapabilities
  /** 参考图编码器；缺省用 ffmpeg 实现。 */
  imageEncoder?: ImageEncoder
}

export interface PipelineDeps {
  store: Store
  files: FileStore
  secrets: SecretStore
  /** 统一取凭据（含账号登录的自动刷新）；缺省只处理 API Key / 无需鉴权。 */
  credentials?: CredentialResolver
  clock: Clock
  ids: IdGenerator
  events?: EventSink
  catalog: Catalog
  llm: LlmClient
  providers: ProviderDirectory
  /** 媒体服务商调用用的 fetch / sleep（可注入假的）。 */
  executor?: ExecutorDeps
  media?: MediaTools
}

/**
 * 取服务商鉴权：凭据只在这里从 SecretStore 读出（登录方式下由登录通道刷新），作为调用参数交给适配器。
 * 登录凭据不可用时抛 `LoginRequiredError`（"需要重新登录"），不是普通的网络错误。
 */
export async function authFor(
  deps: Pick<PipelineDeps, 'secrets' | 'credentials'>,
  config: ProviderConfig,
): Promise<AuthContext> {
  const auth = effectiveAuth(config)
  if (auth.type === 'account_login' && config.kind !== 'llm') {
    throw new ProviderError(
      'capability',
      '账号登录目前只覆盖文本，不能用于图片、视频或语音服务商',
      {
        code: 'LOGIN_TEXT_ONLY',
      },
    )
  }
  const resolver = deps.credentials ?? createCredentialResolver({ secrets: deps.secrets })
  const cred = await resolver.resolve(config)
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: cred.bearer,
    method: cred.method,
    channel: cred.channel,
    ...(config.dialect ? { dialect: config.dialect } : {}),
  }
}

/** 用一个 LLM 服务商配置造 LlmClient（流式收齐）。 */
export function createProviderLlm(
  deps: Pick<PipelineDeps, 'secrets' | 'credentials' | 'executor'> & {
    /** 协议层丢弃了这个鉴权方式不支持的参数时的记录回调。 */
    onDropped?: LlmCallDeps['onDropped']
  },
  config: ProviderConfig,
): LlmClient {
  return {
    async complete(req) {
      const auth = await authFor(deps, config)
      const stream = streamText(
        config.protocol,
        auth,
        { messages: req.messages, jsonMode: req.jsonMode, temperature: req.temperature },
        { ...deps.executor, signal: req.signal, onDropped: deps.onDropped },
      )
      while (true) {
        const next = await stream.next()
        if (next.done) return { text: next.value.text }
        try {
          req.onDelta?.(next.value.delta, next.value.accumulated)
        } catch {
          /* 观察者出错不能影响生成 */
        }
      }
    },
  }
}

export class LlmOutputError extends Error {
  readonly task: string
  readonly raw: string
  constructor(task: string, message: string, raw: string) {
    super(`${task}: ${message}`)
    this.name = 'LlmOutputError'
    this.task = task
    this.raw = raw
  }
}

/**
 * 调 LLM 要 JSON：解析 + 用 zod 校验；不合格时把问题告诉模型再来一次（最多 `attempts` 次）。
 */
export async function llmJson<S extends z.ZodType>(
  deps: Pick<PipelineDeps, 'llm'>,
  options: {
    task: string
    messages: ChatMessage[]
    schema: S
    attempts?: number
    temperature?: number
    signal?: AbortSignal
  },
): Promise<z.output<S>> {
  const attempts = options.attempts ?? 2
  let messages = options.messages
  let lastRaw = ''
  let lastProblem = ''
  for (let i = 0; i < attempts; i++) {
    const { text } = await deps.llm.complete({
      task: options.task,
      messages,
      jsonMode: true,
      temperature: options.temperature,
      signal: options.signal,
    })
    lastRaw = text
    const parsed = parseJsonLoose(text)
    if (parsed === undefined) {
      lastProblem = '输出不是合法的 JSON'
    } else {
      const checked = options.schema.safeParse(parsed)
      if (checked.success) return checked.data
      lastProblem = checked.error.issues
        .slice(0, 5)
        .map((x) => `${x.path.join('.') || '(根)'}：${x.message}`)
        .join('；')
    }
    messages = [
      ...options.messages,
      { role: 'assistant', content: text.slice(0, 4000) },
      {
        role: 'user',
        content: `上一次的输出不符合要求（${lastProblem}）。请严格按要求只输出一个 JSON，不要任何解释。`,
      },
    ]
  }
  throw new LlmOutputError(options.task, lastProblem, lastRaw)
}
