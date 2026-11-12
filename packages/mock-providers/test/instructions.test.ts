import { afterEach, describe, expect, it } from 'vitest'
import { createClient } from '@dramai/api'
import { createServer } from '@dramai/server'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMockProviders } from '../src/index.ts'
import { addProviders, waitJobs } from './flow.ts'
import { STORY } from './story.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

describe("the creator's breakdown instructions, end to end through the mock model", () => {
  it('"每镜不超过 N 秒" is honoured by the mock, remembered on the episode and reused when re-splitting', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'dramai-instr-'))
    const mock = await startMockProviders({ config: { streamChunkMs: 0 } })
    const server = await createServer({
      dataDir,
      port: 0,
      workerIntervalMs: 20,
      logger: { error: () => {} },
      validateResponses: true,
    })
    cleanups.push(async () => {
      await server.close({ graceful: false })
      await mock.close()
      await rm(dataDir, { recursive: true, force: true })
    })
    const api = createClient({ baseUrl: server.url })
    await addProviders(api, mock.url)
    const project = await api.call('projects.create', {
      body: { name: '旧信', aspectRatio: '9:16' },
    })
    const form = new FormData()
    form.set('file', new File([STORY], '旧信.txt', { type: 'text/plain' }))
    await api.call('materials.upload', { params: { projectId: project.id }, form })
    await api.call('episodes.plan', {
      params: { projectId: project.id },
      body: { targetChars: 6000 },
    })
    await waitJobs(api, project.id)
    const episodeId = (await api.call('episodes.list', { params: { projectId: project.id } }))
      .items[0]!.id
    const durations = async () =>
      (await api.call('episodes.get', { params: { episodeId } })).shots.map((s) => s.durationSec)

    await api.call('episodes.breakdown', { params: { episodeId }, body: {} })
    await waitJobs(api, project.id)
    const base = await durations()

    await api.call('episodes.breakdown', {
      params: { episodeId },
      body: { instructions: '重点表现主角的心理变化；每镜不超过 5 秒' },
    })
    await waitJobs(api, project.id)
    const capped = await durations()
    // 模拟的大模型照办了“每镜不超过 N 秒”（台词太长的镜头，核心仍会按台词所需时长往上调）
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
    expect(sum(capped) / capped.length).toBeLessThan(sum(base) / base.length)
    expect(capped.filter((d) => d > 5).length).toBeLessThan(base.filter((d) => d > 5).length)

    // 不再传：沿用集上记的要求，结果和上一次完全一样
    await api.call('episodes.breakdown', { params: { episodeId }, body: {} })
    await waitJobs(api, project.id)
    expect(await durations()).toEqual(capped)
    expect(
      (await api.call('episodes.get', { params: { episodeId } })).episode.breakdownInstructions,
    ).toContain('不超过 5 秒')

    // 清掉以后恢复成没有要求时的样子
    await api.call('episodes.breakdown', { params: { episodeId }, body: { instructions: '' } })
    await waitJobs(api, project.id)
    expect(await durations()).toEqual(base)
  }, 60_000)
})
