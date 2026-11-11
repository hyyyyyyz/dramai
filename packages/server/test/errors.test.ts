import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ERROR_CODES, NOT_FOUND_ENTITIES } from '@dramai/api'
import { DOMAIN_ERROR_CODES, DomainError } from '@dramai/core'
import { afterEach, describe, expect, it } from 'vitest'
import { fromDomainError } from '../src/errors.ts'
import { cleanupAll, startServer } from './helpers.ts'

afterEach(cleanupAll)

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : []
  })
}

describe('error codes are a closed, documented set', () => {
  it('every core DomainError code is listed in the API contract, with the status its kind implies', () => {
    const byKind = { not_found: 404, conflict: 409, invalid: 400, precondition: 409 } as const
    for (const [code, kind] of Object.entries(DOMAIN_ERROR_CODES)) {
      const info = (ERROR_CODES as Record<string, { status: number } | undefined>)[code]
      expect(info, `${code} missing from @dramai/api ERROR_CODES`).toBeDefined()
      expect(info!.status, code).toBe(byKind[kind])
    }
  })

  it('every code the server throws is documented with the status it really uses', () => {
    const used = new Map<string, Set<number>>()
    const add = (code: string, status: number) =>
      used.set(code, (used.get(code) ?? new Set()).add(status))
    for (const file of sourceFiles(join(import.meta.dirname, '../src'))) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/HttpError\(\s*(\d{3})\s*,\s*'([A-Z][A-Z_]+)'/g))
        add(m[2]!, Number(m[1]))
      for (const m of text.matchAll(/conflict\(\s*'([A-Z][A-Z_]+)'/g)) add(m[1]!, 409)
    }
    expect(used.size).toBeGreaterThan(30)
    for (const [code, statuses] of used) {
      const info = (ERROR_CODES as Record<string, { status: number } | undefined>)[code]
      expect(
        info,
        `${code} is thrown by the server but not documented in ERROR_CODES`,
      ).toBeDefined()
      expect([...statuses], code).toEqual([info!.status])
    }
  })

  it('the server never decides an error by its message text', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(join(import.meta.dirname, '../src'))) {
      const text = readFileSync(file, 'utf8')
      if (
        /\.message\s*\.(startsWith|includes|match|endsWith)\(|\/[^/\n]+\/[a-z]*\.test\(\s*\w*\.?message/.test(
          text,
        )
      ) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
    const nf = NOT_FOUND_ENTITIES.length
    expect(nf).toBeGreaterThan(5)
  })
})

describe('DomainError → HTTP', () => {
  it('maps by kind and passes the code and details through', () => {
    const e = fromDomainError(
      new DomainError('ASSET_NAME_TAKEN', 'x', { details: { assetId: 'a' } }),
    )
    expect(e).toMatchObject({ status: 409, code: 'ASSET_NAME_TAKEN', details: { assetId: 'a' } })
    expect(fromDomainError(new DomainError('KIND_MISMATCH', 'x'))).toMatchObject({ status: 400 })
    expect(fromDomainError(new DomainError('EPISODE_HAS_NO_SHOTS', 'x'))).toMatchObject({
      status: 409,
    })
    expect(
      fromDomainError(
        new DomainError('NOT_FOUND', 'x', { details: { entity: 'episode', id: 'e' } }),
      ),
    ).toMatchObject({ status: 404, details: { entity: 'episode', id: 'e' } })
  })

  it('a changed message does not change what the client sees', async () => {
    const h = await startServer({ startWorker: false })
    const err = await h.client
      .call('episodes.get', { params: { episodeId: 'ep_missing' } })
      .catch((e) => e)
    expect(err).toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })
})

describe('typed core errors surface through real routes', () => {
  it('a corrupt .docx is MATERIAL_PARSE_FAILED (400), an unknown style template is UNKNOWN_STYLE_TEMPLATE (400)', async () => {
    const h = await startServer({ startWorker: false })
    const bad = await h.client
      .call('projects.create', {
        body: {
          name: 'x',
          aspectRatio: '9:16',
          style: { source: 'template', templateId: 'no_such_style' },
        },
      })
      .catch((e) => e)
    expect(bad).toMatchObject({
      status: 400,
      code: 'UNKNOWN_STYLE_TEMPLATE',
      details: { templateId: 'no_such_style' },
    })

    const project = await h.client.call('projects.create', {
      body: { name: 'p', aspectRatio: '9:16' },
    })
    const form = new FormData()
    form.set('file', new File(['not a real docx'], 'broken.docx'))
    const parse = await h.client
      .call('materials.upload', { params: { projectId: project.id }, form })
      .catch((e) => e)
    expect(parse).toMatchObject({ status: 400, code: 'MATERIAL_PARSE_FAILED' })
  })
})
