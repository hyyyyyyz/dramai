import { createClient, type DramaiClient, type JobListItem, type SystemInfo } from '@dramai/api'

let seq = 0
export function makeJob(patch: Partial<JobListItem> = {}): JobListItem {
  seq += 1
  const now = 1_700_000_000_000 + seq * 1000
  const job: JobListItem = {
    schemaVersion: 1,
    id: `job_${seq}`,
    type: 'video',
    operation: 'shot_video',
    projectId: 'proj_1',
    episodeId: 'ep_1',
    providerLabel: 'Wan Flash',
    params: {},
    paid: true,
    status: 'queued',
    attempt: 1,
    previousProviderJobIds: [],
    createdAt: now,
    updatedAt: now,
    needsAttention: false,
    ...patch,
  }
  job.needsAttention =
    patch.needsAttention ?? (job.status === 'failed' && job.acknowledgedAt === undefined)
  return job
}

export const failedJob = (
  category: NonNullable<JobListItem['error']>['category'],
  patch: Partial<JobListItem> = {},
): JobListItem =>
  makeJob({
    status: 'failed',
    startedAt: 1_700_000_001_000,
    finishedAt: 1_700_000_005_000,
    error: {
      category,
      code: category === 'delivery_failed' ? 'POLL_FAILED' : 'HTTP_500',
      message: 'raw upstream text',
      recoverable: category === 'delivery_failed',
    },
    ...(category === 'delivery_failed' ? { providerJobId: 'up_1' } : {}),
    ...patch,
  })

export const makeSystem = (patch: Partial<SystemInfo> = {}): SystemInfo => ({
  version: '0.0.0-test',
  dataDir: '/tmp/dramai',
  platform: 'darwin',
  node: 'v24',
  desktop: false,
  startedAt: 1,
  epoch: 'epoch-a',
  ffmpeg: { found: true, ok: true, missing: [] },
  auth: { tokenRequired: false },
  demo: { active: false },
  ...patch,
})

type Handler = (req: { url: URL; method: string; body: unknown }) => unknown | Promise<unknown>
export interface Call {
  method: string
  path: string
  body: unknown
}

/** 假服务：按 “METHOD /path” 路由到处理函数；返回 { status, body } 可模拟错误。SSE 路径返回一个不出事件的流。 */
export function fakeServer(routes: Record<string, Handler>) {
  const calls: Call[] = []
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost')
    const method = (init?.method ?? 'GET').toUpperCase()
    const key = `${method} ${url.pathname}`
    if (url.pathname === '/api/events') {
      return new Response(new ReadableStream({ start() {} }), {
        headers: { 'content-type': 'text/event-stream' },
      })
    }
    let body: unknown
    try {
      body = init?.body ? JSON.parse(String(init.body)) : undefined
    } catch {
      body = init?.body
    }
    calls.push({ method, path: url.pathname, body })
    const handler = routes[key]
    if (!handler) return json(404, { error: { code: 'NOT_FOUND', message: `no route ${key}` } })
    const out = (await handler({ url, method, body })) as
      | { __status?: number; body?: unknown }
      | undefined
    if (out && typeof out === 'object' && '__status' in out) return json(out.__status!, out.body)
    return json(200, out)
  }
  const client: DramaiClient = createClient({ fetch: fetchImpl as typeof fetch })
  return { client, calls, fetch: fetchImpl }
}

export const apiError = (status: number, code: string, details?: unknown) => ({
  __status: status,
  body: { error: { code, message: 'ignored by the UI', details } },
})

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
