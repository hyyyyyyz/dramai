import { afterEach, describe, expect, it } from 'vitest'
import { NOT_FOUND_ENTITIES, routes } from '@dramai/api'
import { cleanupAll, startServer } from './helpers.ts'

afterEach(cleanupAll)

describe('every "not found" says what was not found', () => {
  it('sweeps all routes with a bogus id: each 404 NOT_FOUND carries { entity, id } with a known entity', async () => {
    const h = await startServer({ startWorker: false })
    const bogus = 'nope_123'
    const seen = new Map<string, number>() // entity → 次数
    let notFounds = 0
    for (const [name, def] of Object.entries(routes)) {
      if (!/:/.test(def.path)) continue
      const path = def.path.replace(/:[A-Za-z]+/g, bogus)
      let init: RequestInit = { method: def.method }
      if (def.body === 'multipart') {
        const form = new FormData()
        form.set('file', new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' }))
        init = { ...init, body: form }
      } else if (def.body) {
        init = { ...init, headers: { 'Content-Type': 'application/json' }, body: '{}' }
      }
      const res = await h.raw(path, init)
      if (res.status !== 404) continue
      const body = (await res.json()) as {
        error: { code: string; details?: { entity?: string; id?: string } }
      }
      if (body.error.code !== 'NOT_FOUND') continue
      notFounds++
      expect(body.error.details, `${name} → 404 without details`).toBeDefined()
      expect(NOT_FOUND_ENTITIES as readonly string[], name).toContain(body.error.details!.entity)
      expect(typeof body.error.details!.id, name).toBe('string')
      seen.set(body.error.details!.entity!, (seen.get(body.error.details!.entity!) ?? 0) + 1)
    }
    expect(notFounds).toBeGreaterThan(30)
    for (const e of [
      'project',
      'episode',
      'shot',
      'asset',
      'candidate',
      'job',
      'provider',
      'material',
    ]) {
      expect([...seen.keys()], e).toContain(e)
    }
  })

  it('projects.get names the project; unknown paths name the route; files name the file', async () => {
    const h = await startServer({ startWorker: false })
    expect(
      await h.client.call('projects.get', { params: { projectId: 'p_x' } }).catch((e) => e),
    ).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      details: { entity: 'project', id: 'p_x' },
    })
    const route = (await (await h.raw('/api/definitely/not/here')).json()) as {
      error: { details: unknown }
    }
    expect(route.error.details).toEqual({ entity: 'route', id: 'GET /api/definitely/not/here' })
    const p = await h.client.call('projects.create', { body: { name: 'p', aspectRatio: '9:16' } })
    const file = (await (await h.raw(`/api/projects/${p.id}/files/nope/x.png`)).json()) as {
      error: { details: unknown }
    }
    expect(file.error.details).toEqual({ entity: 'file', id: 'nope/x.png' })
  })

  it('a trashed project is "not found" too, with its id', async () => {
    const h = await startServer({ startWorker: false })
    const p = await h.client.call('projects.create', { body: { name: 'p', aspectRatio: '9:16' } })
    await h.client.call('projects.delete', { params: { projectId: p.id } })
    expect(
      await h.client.call('projects.get', { params: { projectId: p.id } }).catch((e) => e),
    ).toMatchObject({
      details: { entity: 'project', id: p.id },
    })
  })
})
