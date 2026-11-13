/**
 * 旧视频协议（302.AI 透传 / 旧版）的黄金用例：输入矩阵 + 正常响应表。
 *
 * 同一份用例既用来**生成**黄金文件（用 `b06d198` 的代码，即视频协议改动之前的行为），
 * 也用来在每次测试里用**当前**代码重新计算后逐项比较。协议从参数里传进来，所以生成时可以指向旧代码。
 * 轮询表只含"正常响应"（有任务状态的）；业务错误响应（没有状态）的行为在 poll-business-errors.test.ts。
 */

export interface LegacyProtocol {
  id: string
  buildGenerateRequest(auth: unknown, input: unknown): unknown
  parseGenerateResponse(raw: unknown): unknown
  buildPollRequest?(auth: unknown, taskId: string): unknown
  parsePollResponse?(raw: unknown): unknown
}

const png = { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }
const jpg = { bytes: new Uint8Array([9, 8, 7, 6]), mime: 'image/jpeg' }

const authOf = (model: string) => ({
  baseUrl: 'https://api.example.com/',
  model,
  apiKey: 'sk-secret',
  method: 'api_key',
})

const INPUTS: Array<[string, Record<string, unknown>]> = [
  ['minimal', { prompt: 'p', image: png }],
  ['camera', { prompt: 'p', cameraInstruction: 'dolly in', image: png }],
  ['duration-3', { prompt: 'p', image: png, durationSec: 3 }],
  ['duration-6-snap', { prompt: 'p', image: png, durationSec: 6 }],
  ['duration-12', { prompt: 'p', image: png, durationSec: 12 }],
  ['allowed-5', { prompt: 'p', image: png, durationSec: 9, allowedDurations: [5] }],
  ['allowed-list', { prompt: 'p', image: png, durationSec: 4, allowedDurations: [3, 5, 10] }],
  ['aspect-916', { prompt: 'p', image: png, aspectRatio: '9:16' }],
  ['aspect-169', { prompt: 'p', image: jpg, aspectRatio: '16:9' }],
  ['aspect-11', { prompt: 'p', image: png, aspectRatio: '1:1' }],
  ['res-480P', { prompt: 'p', image: png, resolution: '480P' }],
  ['res-720p', { prompt: 'p', image: png, resolution: '720p' }],
  ['res-1080P', { prompt: 'p', image: png, resolution: '1080P' }],
  ['audio-on', { prompt: 'p', image: png, withAudio: true }],
  ['audio-off', { prompt: 'p', image: png, withAudio: false }],
  ['last-frame', { prompt: 'p', image: png, lastImage: jpg }],
  [
    'everything',
    {
      prompt: '开场。',
      cameraInstruction: 'slow push',
      image: png,
      lastImage: jpg,
      durationSec: 10,
      allowedDurations: [5, 10],
      aspectRatio: '9:16',
      resolution: '720p',
      withAudio: true,
    },
  ],
  ['empty-prompt', { prompt: '', image: png }],
]

const MODELS: Record<string, string[]> = {
  'aliyun-video': ['wan2.2-i2v-flash', 'wan2.5-i2v-preview'],
  'volcengine-video': ['doubao-seedance-2-0-fast-260128'],
  'kling-video': ['kling-v2-6'],
  'generic-video': ['some-video-model'],
}

const raw = (json: unknown, status = 200) => ({
  status,
  headers: {},
  text: JSON.stringify(json),
  json,
})

/** 提交响应：正常的、缺任务号的。 */
const SUBMIT: Record<string, unknown[]> = {
  'aliyun-video': [{ output: { task_id: 't1', task_status: 'PENDING' } }, { output: {} }, {}],
  'volcengine-video': [{ id: 'cgt-1' }, {}, { id: '' }],
  'kling-video': [{ data: { task_id: 'k1' } }, { task_id: 'k2' }, { data: {} }, {}],
  'generic-video': [
    { id: 'g1' },
    { task_id: 'g2' },
    { request_id: 'g3' },
    { data: { id: 'g4' } },
    { data: { task_id: 'g5' } },
    {},
  ],
}

/** 轮询响应（都有任务状态，即"正常响应"）。 */
const POLL: Record<string, unknown[]> = {
  'aliyun-video': [
    { output: { task_status: 'PENDING' } },
    { output: { task_status: 'RUNNING' } },
    { output: { task_status: 'UNKNOWN' } },
    { output: { task_status: 'SUCCEEDED', video_url: 'https://v/1.mp4' } },
    { output: { task_status: 'SUCCEEDED', results: [{ video_url: 'https://v/2.mp4' }] } },
    { output: { task_status: 'SUCCEEDED', results: [{ url: 'https://v/3.mp4' }] } },
    { output: { task_status: 'SUCCEEDED' } },
    { output: { task_status: 'succeeded', video_url: 'https://v/4.mp4' } },
    { output: { task_status: 'FAILED', message: 'bad image' } },
    { output: { task_status: 'FAILED' } },
    { output: { task_status: 'CANCELED' } },
  ],
  'volcengine-video': [
    { status: 'queued' },
    { status: 'running' },
    { status: 'succeeded', content: { video_url: 'https://v/a.mp4' } },
    { status: 'success', content: { videoUrl: 'https://v/b.mp4' } },
    { status: 'succeeded', content: {} },
    { status: 'failed', error: { message: 'blocked' } },
    { status: 'failed' },
    { status: 'error' },
    { status: 'expired' },
    { status: 'cancelled' },
    { status: 'something-else' },
  ],
  'kling-video': [
    { data: { task_status: 'submitted' } },
    { data: { task_status: 'processing', task_status_msg: 'x' } },
    { data: { task_status: 'running' } },
    {
      data: {
        task_status: 'succeed',
        task_result: { videos: [{ url: 'https://v/k.mp4', duration: '5.1' }] },
      },
    },
    {
      data: {
        task_status: 'succeeded',
        task_result: { videos: [{ url: 'https://v/k2.mp4', duration: 10 }] },
      },
    },
    { data: { task_status: 'succeed', task_result: { videos: [] } } },
    { data: { task_status: 'failed', task_status_msg: 'nope' } },
    { data: { task_status: 'failed' } },
    { data: { task_status: 'fail' } },
    { data: { task_status: 'weird' } },
  ],
  'generic-video': [
    { status: 'processing' },
    { status: 'in_progress' },
    { status: 'queued' },
    { status: 'completed', url: 'https://v/g.mp4' },
    { status: 'succeeded', video_url: 'https://v/g2.mp4' },
    { status: 'done', output: { url: 'https://v/g3.mp4' } },
    { status: 'success', output: [{ url: 'https://v/g4.mp4' }] },
    { status: 'completed', video: { url: 'https://v/g5.mp4' } },
    { status: 'completed', data: [{ url: 'https://v/g6.mp4' }] },
    { status: 'completed', data: { url: 'https://v/g7.mp4' } },
    { state: 'completed', url: 'https://v/g8.mp4' },
    { status: 'completed' },
    { status: 'failed', error: 'boom' },
    { status: 'error', message: 'oops' },
    { status: 'failed', error: { message: 'deep' } },
    { status: 'failed' },
  ],
}

const TASK_IDS = ['t1', 'a/b', 'cgt 1']

/** 把字节数组换成可读的 base64，其余原样（给 JSON 化用）。 */
function plain(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) =>
      v instanceof Uint8Array ? { __bytes: Buffer.from(v).toString('base64') } : v,
    ),
  )
}

export function computeLegacyVideoGolden(protocols: Record<string, LegacyProtocol>) {
  const out: Record<string, unknown> = {}
  for (const [id, models] of Object.entries(MODELS)) {
    const p = protocols[id]!
    const requests: Record<string, unknown> = {}
    for (const model of models) {
      for (const [name, input] of INPUTS) {
        requests[`${model} | ${name}`] = plain(p.buildGenerateRequest(authOf(model), input))
      }
    }
    const submit = (SUBMIT[id] ?? []).map((j) => plain(p.parseGenerateResponse(raw(j))))
    const pollRequests = TASK_IDS.map((t) => plain(p.buildPollRequest!(authOf(models[0]!), t)))
    const poll = (POLL[id] ?? []).map((j) => plain(p.parsePollResponse!(raw(j))))
    out[id] = { requests, submit, pollRequests, poll }
  }
  return out
}
