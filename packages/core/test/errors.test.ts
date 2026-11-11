import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../src/data-dir.ts'
import { createAsset, decideCandidate, emptySlot, setCurrentVersion } from '../src/domain/index.ts'
import type { EntityCandidate } from '../src/domain/index.ts'
import { DOMAIN_ERROR_CODES, DomainError, isDomainError } from '../src/errors.ts'
import { expandStyle } from '../src/prompts/styles.ts'
import { breakdownEpisode } from '../src/pipeline/breakdown.ts'
import { confirmCandidate, undoCandidateLink } from '../src/pipeline/entities.ts'
import { createMemoryPorts } from '../src/testing/index.ts'
import type { PipelineDeps } from '../src/pipeline/deps.ts'
import { fakeLlm } from './fakes.ts'

function deps(): PipelineDeps {
  const ports = createMemoryPorts()
  return {
    store: ports.store,
    files: ports.files,
    secrets: ports.secrets,
    clock: ports.clock,
    ids: ports.ids,
    events: ports.events,
    catalog: loadCatalog(),
    llm: fakeLlm().client,
    providers: { get: async () => undefined, list: async () => [] },
  }
}

async function caught(p: Promise<unknown> | (() => unknown)): Promise<DomainError> {
  try {
    await (typeof p === 'function' ? p() : p)
  } catch (err) {
    expect(isDomainError(err)).toBe(true)
    return err as DomainError
  }
  throw new Error('expected a DomainError')
}

const candidate = (over: Partial<EntityCandidate> = {}): EntityCandidate => ({
  schemaVersion: 1,
  id: 'cand_1',
  projectId: 'p',
  kind: 'character',
  name: '总管',
  aliases: [],
  shotIds: [],
  variants: [],
  status: 'pending',
  extractedAt: 1,
  createdAt: 1,
  ...over,
})

describe('business errors carry stable codes and kinds (nobody matches on message text)', () => {
  it('the catalogue maps every code to one of the four kinds', () => {
    for (const kind of Object.values(DOMAIN_ERROR_CODES)) {
      expect(['not_found', 'conflict', 'invalid', 'precondition']).toContain(kind)
    }
  })

  it('NOT_FOUND names the entity and id in details', async () => {
    const d = deps()
    const err = await caught(confirmCandidate(d, 'nope', { action: 'ignore' }))
    expect(err).toMatchObject({
      code: 'NOT_FOUND',
      kind: 'not_found',
      details: { entity: 'candidate', id: 'nope' },
    })
    expect(await caught(breakdownEpisode(d, 'ep_x'))).toMatchObject({
      code: 'NOT_FOUND',
      details: { entity: 'episode', id: 'ep_x' },
    })
    expect(await caught(() => setCurrentVersion(emptySlot(), 'v9'))).toMatchObject({
      code: 'NOT_FOUND',
      details: { entity: 'media_version' },
    })
  })

  it('an already-handled candidate is a conflict', async () => {
    const err = await caught(() =>
      decideCandidate(candidate({ status: 'ignored' }), { action: 'ignore' }, 2),
    )
    expect(err).toMatchObject({ code: 'CANDIDATE_ALREADY_HANDLED', kind: 'conflict' })
  })

  it('undoing a candidate that is not linked is a conflict', async () => {
    const d = deps()
    await d.store.candidates.put(candidate({ status: 'pending' }))
    expect(await caught(undoCandidateLink(d, 'cand_1'))).toMatchObject({
      code: 'CANDIDATE_NOT_LINKED',
      kind: 'conflict',
    })
  })

  it('linking across kinds is invalid input; a duplicate name is a conflict that points at the existing asset', async () => {
    const d = deps()
    await d.store.assets.put(
      createAsset({
        id: 'a_place',
        projectId: 'p',
        number: 1,
        kind: 'location',
        name: '老茶馆',
        now: 1,
      }),
    )
    await d.store.assets.put(
      createAsset({
        id: 'a_hero',
        projectId: 'p',
        number: 2,
        kind: 'character',
        name: '总管',
        now: 1,
      }),
    )
    await d.store.candidates.put(candidate())
    expect(
      await caught(confirmCandidate(d, 'cand_1', { action: 'link', assetId: 'a_place' })),
    ).toMatchObject({
      code: 'KIND_MISMATCH',
      kind: 'invalid',
    })
    expect(await caught(confirmCandidate(d, 'cand_1', { action: 'accept_new' }))).toMatchObject({
      code: 'ASSET_NAME_TAKEN',
      kind: 'conflict',
      details: { assetId: 'a_hero' },
    })
  })

  it('an unknown style template is invalid input', async () => {
    const catalog = loadCatalog().styles
    const err = await caught(() =>
      expandStyle(catalog, { source: 'template', templateId: 'no_such' }, 1),
    )
    expect(err).toMatchObject({ code: 'UNKNOWN_STYLE_TEMPLATE', kind: 'invalid' })
  })

  it('a stale message wording change cannot change the code', () => {
    const err = new DomainError('NOT_FOUND', '完全不同的文案', {
      details: { entity: 'asset', id: 'x' },
    })
    expect(err.code).toBe('NOT_FOUND')
    expect(err.kind).toBe('not_found')
  })
})
