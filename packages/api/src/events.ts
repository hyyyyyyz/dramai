import { z } from 'zod'
import { job, jobTarget } from './schemas.ts'

/**
 * SSE 事件（`GET /api/events`）。
 *
 * SSE 的 `event:` 字段 = 下面的 `type`，`id:` = `<epoch>:<序号>`，`data:` = 事件的 JSON。
 * 事件只是“提示”：真相永远在接口里。断线重连的做法见 `sseId` 的注释和 README。
 */
export const entityName = z.enum([
  'project',
  'episode',
  'scene',
  'shot',
  'asset',
  'candidate',
  'material',
  'timeline',
  'provider',
  'settings',
  'import',
])

export const serverEvent = z.discriminatedUnion('type', [
  /** 连接建立后的第一条：epoch 变了就说明服务重启过。 */
  z.object({ type: z.literal('hello'), epoch: z.string(), serverTime: z.number() }),
  /** 服务端补不齐你错过的事件（缓冲区已溢出，或服务重启过）：整体刷新。 */
  z.object({ type: z.literal('resync'), reason: z.enum(['epoch_changed', 'buffer_overflow']) }),
  /** `target` 是任务作用的对象（结构化）；新任务第一次出现就带着，前端不必为它再请求一次。 */
  z.object({ type: z.literal('job.updated'), job, target: jobTarget.optional() }),
  z.object({
    type: z.literal('job.progress'),
    jobId: z.string(),
    progress: z.number(),
    message: z.string().optional(),
  }),
  /** 执行器自己出了错（和某个任务的结果无关）：显示成“后台出错”。 */
  z.object({ type: z.literal('job.worker_error'), message: z.string() }),
  /**
   * **提示，不是失败**：任务本身的结果是对的（例如视频已经保存），只是某个附带步骤没有完成。
   * 目前只有一个码：`native_audio_default_failed`（视频已保存，自动静音没有完成，那个片段的音量保持原样，可以在时间线上自己调）。
   * `level` 目前都是 `warning`；`code` 稳定，`message` 是给人看的中文（可以按 `code` 本地化）。
   * 不认识这个事件类型的旧版客户端会直接忽略它（客户端校验失败的事件会被丢弃）。
   */
  z.object({
    type: z.literal('job.notice'),
    level: z.enum(['info', 'warning']),
    code: z.string(),
    message: z.string(),
    projectId: z.string(),
    jobId: z.string().optional(),
    shotId: z.string().optional(),
  }),
  /** 文本步骤（分集、分镜拆解、实体抽取、镜头提示词）里 LLM 的流式输出。 */
  z.object({
    type: z.literal('text.delta'),
    jobId: z.string(),
    operation: z.string(),
    task: z.string(),
    /** 这次新增的文本。 */
    delta: z.string(),
    /** 这一次 LLM 调用已累计的字数。 */
    chars: z.number(),
  }),
  /** 数据变了（实体变更通知）：对应的查询该失效重取。 */
  z.object({
    type: z.literal('data.changed'),
    projectId: z.string().optional(),
    entity: entityName,
    ids: z.array(z.string()).optional(),
    op: z.enum(['created', 'updated', 'deleted']).optional(),
  }),
  z.object({ type: z.literal('artifact.changed'), projectId: z.string(), key: z.string() }),
])
export type ServerEvent = z.infer<typeof serverEvent>
export type ServerEventType = ServerEvent['type']

export const SERVER_EVENT_TYPES: readonly ServerEventType[] = [
  'hello',
  'resync',
  'job.updated',
  'job.progress',
  'job.worker_error',
  'job.notice',
  'text.delta',
  'data.changed',
  'artifact.changed',
]

/**
 * 事件 id：`<epoch>:<seq>`。epoch 是服务本次启动的标识，seq 在 epoch 内单调递增。
 * 浏览器的 EventSource 重连时会自动带上 `Last-Event-ID`。
 */
export function formatEventId(epoch: string, seq: number): string {
  return `${epoch}:${seq}`
}

export function parseEventId(
  id: string | null | undefined,
): { epoch: string; seq: number } | undefined {
  if (!id) return undefined
  const i = id.lastIndexOf(':')
  if (i <= 0) return undefined
  const seq = Number(id.slice(i + 1))
  return Number.isInteger(seq) && seq >= 0 ? { epoch: id.slice(0, i), seq } : undefined
}
