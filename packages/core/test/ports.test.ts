import { describe, expect, it } from 'vitest'
import { createMemoryPorts } from '../src/testing/index.ts'
import { createProject, createShot } from '../src/domain/index.ts'
import type { Job } from '../src/jobs/index.ts'

describe('in-memory ports', () => {
  it('stores copies: mutating a returned value does not change the store', async () => {
    const { store } = createMemoryPorts()
    const p = createProject({ id: 'p1', name: 'n', aspectRatio: '9:16', now: 1 })
    await store.projects.put(p)
    const got = (await store.projects.get('p1'))!
    got.name = 'mutated'
    expect((await store.projects.get('p1'))!.name).toBe('n')
    p.name = 'mutated too'
    expect((await store.projects.get('p1'))!.name).toBe('n')
  })

  it('hides soft-deleted projects and assets unless asked', async () => {
    const { store } = createMemoryPorts()
    await store.projects.put({
      ...createProject({ id: 'a', name: 'a', aspectRatio: '9:16', now: 1 }),
      deletedAt: 5,
    })
    await store.projects.put(createProject({ id: 'b', name: 'b', aspectRatio: '9:16', now: 1 }))
    expect((await store.projects.list()).map((p) => p.id)).toEqual(['b'])
    expect((await store.projects.list({ includeDeleted: true })).map((p) => p.id).sort()).toEqual([
      'a',
      'b',
    ])
  })

  it('rolls a transaction back on failure', async () => {
    const { store } = createMemoryPorts()
    await store.projects.put(
      createProject({ id: 'p', name: 'before', aspectRatio: '9:16', now: 1 }),
    )
    await expect(
      store.transaction(async (tx) => {
        await tx.projects.put(
          createProject({ id: 'p', name: 'after', aspectRatio: '9:16', now: 1 }),
        )
        await tx.shots.put(createShot({ id: 's', projectId: 'p', sceneId: 'x', number: 1, now: 1 }))
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect((await store.projects.get('p'))!.name).toBe('before')
    expect(await store.shots.get('s')).toBeUndefined()
    await store.transaction(async (tx) => {
      await tx.shots.put(createShot({ id: 's', projectId: 'p', sceneId: 'x', number: 1, now: 1 }))
    })
    expect(await store.shots.get('s')).toBeDefined()
  })

  it('job transition is a compare-and-set', async () => {
    const { store } = createMemoryPorts()
    const job = {
      schemaVersion: 1,
      id: 'j',
      type: 'image',
      operation: 'x',
      projectId: 'p',
      params: {},
      paid: true,
      status: 'queued',
      attempt: 1,
      previousProviderJobIds: [],
      createdAt: 1,
      updatedAt: 1,
    } as Job
    await store.jobs.insert(job)
    expect(await store.jobs.transition('j', ['running'], { status: 'failed' })).toBeUndefined()
    expect((await store.jobs.transition('j', ['queued'], { status: 'running' }))?.status).toBe(
      'running',
    )
    expect(await store.jobs.transition('j', ['queued'], { status: 'cancelled' })).toBeUndefined()
    await expect(store.jobs.insert(job)).rejects.toThrow(/duplicate/)
  })

  it('file store round-trips bytes, reports hashes and can materialise a local path', async () => {
    const { files } = createMemoryPorts()
    const info = await files.put('p', 'images/a.png', new Uint8Array([1, 2, 3]))
    expect(info).toMatchObject({ bytes: 3 })
    expect(info.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(await files.get('p', 'images/a.png')).toEqual(new Uint8Array([1, 2, 3]))
    expect(await files.exists('p', 'images/a.png')).toBe(true)
    expect(await files.exists('q', 'images/a.png')).toBe(false)
    const local = await files.localPath('p', 'images/a.png')
    expect(local.endsWith('images/a.png')).toBe(true)
    await files.remove('p', 'images/a.png')
    await expect(files.get('p', 'images/a.png')).rejects.toThrow(/not found/)
  })

  it('secret store keeps values out of everything else', async () => {
    const { secrets } = createMemoryPorts()
    await secrets.set('k', 'sk-123')
    expect(await secrets.get('k')).toBe('sk-123')
    expect(await secrets.has('k')).toBe(true)
    await secrets.delete('k')
    expect(await secrets.get('k')).toBeUndefined()
  })

  it('id generator never repeats and fake clock only moves when told to', () => {
    const { ids, clock } = createMemoryPorts()
    const seen = new Set(Array.from({ length: 100 }, () => ids.next('x')))
    expect(seen.size).toBe(100)
    const t = clock.now()
    expect(clock.now()).toBe(t)
    clock.advance(500)
    expect(clock.now()).toBe(t + 500)
  })
})
