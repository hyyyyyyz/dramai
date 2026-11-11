import type { Harness } from './helpers.ts'
import { PROVIDERS, makeNovel } from './fakes.ts'

/** 用公开接口把一个项目推进到“有分镜 / 实体 / 提示词”的状态（HTTP 驱动，不碰内部存储）。 */

export async function waitJobsIdle(
  h: Harness,
  projectId: string,
  options: { timeoutMs?: number; allowFailed?: boolean } = {},
) {
  const deadline = Date.now() + (options.timeoutMs ?? 60_000)
  for (;;) {
    const { items } = await h.client.call('jobs.list', { query: { projectId } })
    const busy = items.filter((j) => j.status === 'queued' || j.status === 'running')
    if (busy.length === 0) {
      const failed = items.filter((j) => j.status === 'failed')
      if (failed.length > 0 && !options.allowFailed) {
        throw new Error(
          `jobs failed: ${JSON.stringify(failed.map((j) => ({ op: j.operation, error: j.error })))}`,
        )
      }
      return items
    }
    if (Date.now() > deadline) {
      throw new Error(
        `timeout waiting for jobs: ${JSON.stringify(busy.map((j) => [j.operation, j.status]))}`,
      )
    }
    await new Promise((r) => setTimeout(r, 25))
  }
}

export async function addProviders(h: Harness): Promise<Record<string, string>> {
  const ids: Record<string, string> = {}
  for (const p of PROVIDERS) {
    const created = await h.client.call('providers.create', {
      body: {
        label: p.label,
        kind: p.kind,
        protocol: p.protocol,
        baseUrl: p.baseUrl,
        model: p.model,
        apiKey: p.kind === 'llm' ? undefined : `sk-test-${p.id}-0123456789`,
      },
    })
    ids[p.id] = created.id
    if (p.acceptedUnverified?.length) {
      await h.client.call('providers.acceptUnverified', {
        params: { providerId: created.id },
        body: { keys: p.acceptedUnverified },
      })
    }
  }
  return ids
}

export function novelForm(chapters = 4, fill = 6): FormData {
  const form = new FormData()
  form.set('file', new File([makeNovel(chapters, 8, fill)], '长篇.txt', { type: 'text/plain' }))
  return form
}

/** 创建项目 → 上传原文 → 分集 → 第 `episode` 集分镜 → 抽实体并全部接受 → 镜头提示词。 */
export async function prepareEpisodeViaApi(
  h: Harness,
  providerIds: Record<string, string>,
  options: { chapters?: number; fill?: number; episode?: number } = {},
) {
  const project = await h.client.call('projects.create', {
    body: {
      name: '雨夜',
      aspectRatio: '9:16',
      style: { source: 'template', templateId: 'mystery_realistic' },
      narrationDelivery: 'tts',
      narrationVoice: { providerConfigId: providerIds.tts!, voice: 'alloy', speed: 1 },
    },
  })
  const projectId = project.id
  const upload = await h.client.call('materials.upload', {
    params: { projectId },
    form: novelForm(options.chapters ?? 4, options.fill ?? 6),
  })
  await h.client.call('episodes.plan', { params: { projectId }, body: {} })
  await waitJobsIdle(h, projectId)
  const { items: episodes } = await h.client.call('episodes.list', { params: { projectId } })
  const ordered = [...episodes].sort((a, b) => a.number - b.number)
  const episode = ordered[options.episode ?? 0]!
  await h.client.call('episodes.breakdown', { params: { episodeId: episode.id }, body: {} })
  await waitJobsIdle(h, projectId)
  await h.client.call('episodes.extractEntities', { params: { episodeId: episode.id }, body: {} })
  await waitJobsIdle(h, projectId)
  const { items: candidates } = await h.client.call('candidates.list', {
    params: { projectId },
    query: {},
  })
  for (const c of candidates.filter((x) => x.status === 'pending')) {
    await h.client.call('candidates.accept', { params: { candidateId: c.id }, body: {} })
  }
  await h.client.call('episodes.generatePrompts', { params: { episodeId: episode.id }, body: {} })
  await waitJobsIdle(h, projectId)
  return { project, projectId, material: upload.material, episodes: ordered, episode }
}
