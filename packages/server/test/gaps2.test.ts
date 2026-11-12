import { afterEach, describe, expect, it } from 'vitest'
import { cleanupAll, startServer } from './helpers.ts'
import type { Harness } from './helpers.ts'
import { addProviders, prepareEpisodeViaApi, waitJobsIdle } from './api-flow.ts'
import { fakeLlm } from './fakes.ts'

afterEach(cleanupAll)

async function prepared() {
  const llm = fakeLlm()
  const h = await startServer({ llm: llm.client, workerIntervalMs: 20 })
  const ids = await addProviders(h)
  const p = await prepareEpisodeViaApi(h, ids, { chapters: 2, fill: 1 })
  return { h, llm, ids, ...p }
}

const userMessage = (llm: ReturnType<typeof fakeLlm>, task: string, n = -1) => {
  const calls = llm.log.filter((l) => l.task === task)
  return String(calls.at(n)!.messages[1]!.content)
}

describe('1. the creator can tell the breakdown what they want', () => {
  it('instructions reach the model, are remembered on the episode, and re-splitting reuses them until cleared', async () => {
    const { h, llm, projectId, episode } = await prepared()
    const episodeId = episode.id
    expect(userMessage(llm, 'shots.breakdown')).not.toContain('创作者的额外要求') // 第一次没写

    const res = await h.client.call('episodes.breakdown', {
      params: { episodeId },
      body: { instructions: '  重点表现主角的心理变化；每镜不超过 8 秒  ' },
    })
    expect(res.job.params).toMatchObject({
      instructions: '重点表现主角的心理变化；每镜不超过 8 秒',
    })
    await waitJobsIdle(h, projectId)
    expect(userMessage(llm, 'shots.breakdown')).toContain('重点表现主角的心理变化；每镜不超过 8 秒')
    const stored = (await h.client.call('episodes.get', { params: { episodeId } })).episode
    expect(stored.breakdownInstructions).toBe('重点表现主角的心理变化；每镜不超过 8 秒')

    // 重新拆分不再传：默认沿用
    const again = await h.client.call('episodes.breakdown', { params: { episodeId }, body: {} })
    expect(again.job.params).toMatchObject({
      instructions: '重点表现主角的心理变化；每镜不超过 8 秒',
    })
    await waitJobsIdle(h, projectId)
    expect(userMessage(llm, 'shots.breakdown')).toContain('每镜不超过 8 秒')

    // 单独改 / 清（不重新拆分）
    const edited = await h.client.call('episodes.update', {
      params: { episodeId },
      body: { breakdownInstructions: '节奏放慢' },
    })
    expect(edited.breakdownInstructions).toBe('节奏放慢')
    const cleared = await h.client.call('episodes.update', {
      params: { episodeId },
      body: { breakdownInstructions: null },
    })
    expect(cleared.breakdownInstructions).toBeUndefined()
    await h.client.call('episodes.update', {
      params: { episodeId },
      body: { breakdownInstructions: '又写了一条' },
    })
    // 传空字符串 = 清掉，并且这一次不带任何要求
    const none = await h.client.call('episodes.breakdown', {
      params: { episodeId },
      body: { instructions: '' },
    })
    expect(none.job.params).toEqual({ mode: 'replace' })
    await waitJobsIdle(h, projectId)
    expect(userMessage(llm, 'shots.breakdown')).not.toContain('创作者的额外要求')
    expect(
      (await h.client.call('episodes.get', { params: { episodeId } })).episode
        .breakdownInstructions,
    ).toBeUndefined()
  })

  it('too long is refused; a failed enqueue does not keep the instruction', async () => {
    const { h, episode } = await prepared()
    const long = await h.raw(`/api/episodes/${episode.id}/breakdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instructions: 'x'.repeat(1001) }),
    })
    expect(long.status).toBe(400)
    // 没有可用的大模型 → 入队失败，整个请求回滚，不会留下一条没用上的要求
    for (const p of (await h.client.call('providers.list')).items.filter((x) => x.kind === 'llm')) {
      await h.client.call('providers.delete', { params: { providerId: p.id } })
    }
    const blocked = await h.client
      .call('episodes.breakdown', {
        params: { episodeId: episode.id },
        body: { instructions: '不会被记住' },
      })
      .catch((e) => e as { status: number; code: string })
    expect(blocked).toMatchObject({ status: 409, code: 'NO_LLM_PROVIDER' })
    expect(
      (await h.client.call('episodes.get', { params: { episodeId: episode.id } })).episode
        .breakdownInstructions,
    ).toBeUndefined()
  })

  it('episode planning takes a requirement too — for that run only', async () => {
    const llm = fakeLlm()
    const h = await startServer({ llm: llm.client, workerIntervalMs: 20 })
    await addProviders(h)
    const p = await h.client.call('projects.create', { body: { name: 'p', aspectRatio: '9:16' } })
    const form = new FormData()
    form.set(
      'file',
      new File(
        ['第一章 开始\n这是第一章的内容。'.repeat(40) + '\n\n第二章 继续\n这是第二章。'.repeat(40)],
        'a.txt',
      ),
    )
    await h.client.call('materials.upload', { params: { projectId: p.id }, form })
    const res = await h.client.call('episodes.plan', {
      params: { projectId: p.id },
      body: { instructions: '每集结尾留悬念' },
    })
    expect(res.job.params).toMatchObject({ instructions: '每集结尾留悬念' })
    await waitJobsIdle(h, p.id)
    expect(userMessage(llm, 'episodes.plan')).toContain('每集结尾留悬念')
    expect(
      (await h.client.call('projects.get', { params: { projectId: p.id } })) as object,
    ).not.toHaveProperty('planInstructions')
  })
})

describe('3. generatePrompts onlyMissing judges each part', () => {
  it('a shot missing only its video prompt is filled (and only that part); a complete shot is left alone', async () => {
    const { h, episode, projectId } = await prepared()
    const { store } = h.server.ctx
    const shots = (await h.client.call('episodes.get', { params: { episodeId: episode.id } })).shots
    const [a, b] = shots
    await store.shots.put({
      ...(await store.shots.get(a!.id))!,
      prompts: { ...a!.prompts, keyFrame: '用户手写的首帧', video: undefined },
    })
    const res = await h.client.call('episodes.generatePrompts', {
      params: { episodeId: episode.id },
      body: { onlyMissing: true },
    })
    await waitJobsIdle(h, projectId)
    const job = await h.client.call('jobs.get', { params: { jobId: res.job.id } })
    expect(job.result).toMatchObject({ shots: 1, filled: { image: 0, video: 1 } })
    const after = (await store.shots.get(a!.id))!
    expect(after.prompts.keyFrame).toBe('用户手写的首帧')
    expect(after.prompts.video).toBeTruthy()
    expect((await store.shots.get(b!.id))!.prompts).toEqual(b!.prompts)
  })
})

describe("7. a character's voice description", () => {
  const mk = (h: Harness, projectId: string, body: Record<string, unknown>) =>
    h.client.call('assets.create', { params: { projectId }, body: body as never })

  it('characters can have one (create, update, clear); it is trimmed and returned', async () => {
    const h = await startServer({ startWorker: false })
    const p = await h.client.call('projects.create', { body: { name: 'p', aspectRatio: '9:16' } })
    const hero = await mk(h, p.id, {
      kind: 'character',
      name: '林夏',
      voiceDescription: '  低沉沙哑的中年男声，语速慢  ',
    })
    expect(hero.voiceDescription).toBe('低沉沙哑的中年男声，语速慢')
    expect(
      (await h.client.call('assets.get', { params: { assetId: hero.id } })).asset.voiceDescription,
    ).toBe('低沉沙哑的中年男声，语速慢')
    const changed = await h.client.call('assets.update', {
      params: { assetId: hero.id },
      body: { voiceDescription: '清亮的少女声' },
    })
    expect(changed.voiceDescription).toBe('清亮的少女声')
    // 其他字段的更新不碰它
    expect(
      (
        await h.client.call('assets.update', {
          params: { assetId: hero.id },
          body: { appearance: '短发' },
        })
      ).voiceDescription,
    ).toBe('清亮的少女声')
    expect(
      (
        await h.client.call('assets.update', {
          params: { assetId: hero.id },
          body: { voiceDescription: null },
        })
      ).voiceDescription,
    ).toBeUndefined()
    expect(
      (
        await h.client.call('assets.update', {
          params: { assetId: hero.id },
          body: { voiceDescription: '   ' },
        })
      ).voiceDescription,
    ).toBeUndefined()
  })

  it('only characters: a place or a prop gets VOICE_NOT_ALLOWED; and it never makes anything stale', async () => {
    const h = await startServer({ startWorker: false })
    const p = await h.client.call('projects.create', { body: { name: 'p', aspectRatio: '9:16' } })
    const place = await mk(h, p.id, { kind: 'location', name: '老茶馆' })
    expect(
      await mk(h, p.id, { kind: 'prop', name: '青瓷杯', voiceDescription: '嗡嗡' }).catch((e) => e),
    ).toMatchObject({ status: 400, code: 'VOICE_NOT_ALLOWED' })
    expect(
      await h.client
        .call('assets.update', {
          params: { assetId: place.id },
          body: { voiceDescription: '回声' },
        })
        .catch((e) => e),
    ).toMatchObject({ status: 400, code: 'VOICE_NOT_ALLOWED' })
    // 声线描述不参与任何生成依据：加上 / 改掉它，已有产物的状态不变
    const hero = await mk(h, p.id, { kind: 'character', name: '林夏' })
    const { buildExpectations, loadProjection } = await import('@dramai/core')
    const basis = async () =>
      JSON.stringify(
        [...buildExpectations(await loadProjection(h.server.ctx.store, p.id)).values()].map(
          (e) => e.basis,
        ),
      )
    const before = await basis()
    await h.client.call('assets.update', {
      params: { assetId: hero.id },
      body: { voiceDescription: '温柔的女声' },
    })
    expect(await basis()).toBe(before)
  })
})
