import type { createClient } from '@dramai/api'

type Api = ReturnType<typeof createClient>

/** 等项目里的任务都结束；有失败的任务就报错（带上失败原因）。 */
export async function waitJobs(
  api: Api,
  projectId: string,
  options: { timeoutMs?: number; allowFailed?: boolean } = {},
) {
  const deadline = Date.now() + (options.timeoutMs ?? 90_000)
  for (;;) {
    const { items } = await api.call('jobs.list', { query: { projectId } })
    const busy = items.filter((j) => j.status === 'queued' || j.status === 'running')
    if (busy.length === 0) {
      const failed = items.filter((j) => j.status === 'failed')
      if (failed.length > 0 && !options.allowFailed) {
        throw new Error(`jobs failed: ${JSON.stringify(failed.map((j) => [j.operation, j.error]))}`)
      }
      return items
    }
    if (Date.now() > deadline) {
      throw new Error(
        `timeout: ${JSON.stringify(busy.map((j) => [j.operation, j.status, j.stage]))}`,
      )
    }
    await new Promise((r) => setTimeout(r, 20))
  }
}

/** 和演示入口一样：用正常的接口建服务商配置，指向模拟服务商。 */
export async function addProviders(api: Api, mockUrl: string): Promise<Record<string, string>> {
  const ids: Record<string, string> = {}
  const defs = [
    ['llm', 'llm', 'openai-chat', 'deepseek-chat', []],
    [
      'img',
      'image',
      'gemini-image',
      'gemini-2.5-flash-image',
      ['mode:i2i', 'refImages', 'aspectRatio'],
    ],
    ['seedream', 'image', 'openai-images', 'doubao-seedream-5-0-260128', []],
    ['vid', 'video', 'aliyun-video', 'wan2.2-i2v-flash', []],
    [
      'seedance',
      'video',
      'volcengine-video',
      'doubao-seedance-2-0-fast-260128',
      ['mode:i2v', 'firstFrame', 'duration', 'resolution'],
    ],
    ['tts', 'tts', 'openai-tts', 'tts-1', ['mode:tts']],
  ] as const
  for (const [id, kind, protocol, model, accept] of defs) {
    const created = await api.call('providers.create', {
      body: {
        label: `测试 · ${id}`,
        kind,
        protocol,
        baseUrl: mockUrl,
        model,
        apiKey: 'mock-key-not-a-secret',
      },
    })
    ids[id] = created.id
    if (accept.length > 0) {
      await api.call('providers.acceptUnverified', {
        params: { providerId: created.id },
        body: { keys: [...accept] },
      })
    }
  }
  return ids
}
