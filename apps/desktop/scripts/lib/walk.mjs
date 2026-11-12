// 页面里走一遍短流程：建项目 → 上传文本 → 规划分集（演示服务商）。接口调用发生在页面里，令牌由主进程补，这里看不到它。
import { apiCall, waitFor } from './cdp.mjs'

/**
 * @param page connect() 返回的页面句柄
 * @param options.mockUrl 给了就先建一个指向模拟服务商的 LLM 服务商配置（打包形态没有演示种子）
 * @param options.report (name, ok, detail) => void
 */
export async function walkFlow(page, { mockUrl, report }) {
  if (mockUrl) {
    const r = await apiCall(page, 'POST', '/api/providers', {
      label: 'walk · llm',
      kind: 'llm',
      protocol: 'openai-chat',
      baseUrl: mockUrl,
      model: 'deepseek-chat',
      apiKey: 'mock-key-not-a-secret',
    })
    report(
      'create an LLM provider with a key (stored via the OS encryption)',
      r.status === 200 || r.status === 201,
      String(r.status),
    )
  }
  const providers = await apiCall(page, 'GET', '/api/providers')
  const llm = providers.body.items.find((p) => p.kind === 'llm')
  report('an LLM provider with a key exists', Boolean(llm), llm?.label)
  const created = await apiCall(page, 'POST', '/api/projects', {
    name: `Walk ${new Date().toISOString().slice(11, 19)}`,
    aspectRatio: '9:16',
  })
  report(
    'create project',
    created.status === 200 || created.status === 201,
    JSON.stringify(created.body).slice(0, 120),
  )
  const projectId = created.body.id

  const novel = Array.from(
    { length: 4 },
    (_, i) =>
      `第${i + 1}章 雨夜\n\n${'林晚站在旧码头的路灯下，雨水顺着伞沿落下。她把那封信又读了一遍。'.repeat(30)}\n`,
  ).join('\n')
  const upload = await page.evaluate(`(async () => {
    const form = new FormData()
    form.append('file', new File([${JSON.stringify(novel)}], 'novel.txt', { type: 'text/plain' }))
    const res = await fetch('/api/projects/${projectId}/materials', { method: 'POST', body: form })
    return { status: res.status, body: await res.json() }
  })()`)
  report(
    'upload a text',
    upload.status === 200 || upload.status === 201,
    JSON.stringify(upload.body).slice(0, 160),
  )

  const plan = await apiCall(page, 'POST', `/api/projects/${projectId}/episodes/plan`, {})
  report(
    'start "plan episodes"',
    plan.status >= 200 && plan.status < 300,
    JSON.stringify(plan.body).slice(0, 160),
  )
  const jobId = plan.body.job?.id
  const done = await waitFor(
    async () => {
      const r = await apiCall(page, 'GET', `/api/jobs/${jobId}`)
      return ['succeeded', 'failed', 'cancelled'].includes(r.body.status) ? r.body : undefined
    },
    { what: 'plan job to finish', timeoutMs: 60_000, intervalMs: 500 },
  )
  report('plan job succeeded', done.status === 'succeeded', done.status)
  const episodes = await apiCall(page, 'GET', `/api/projects/${projectId}/episodes`)
  report(
    'episodes were planned',
    episodes.body.items?.length > 0,
    `${episodes.body.items?.length} episodes`,
  )
  return { projectId }
}
