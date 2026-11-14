import { describe, expect, it } from 'vitest'
import { PROTECTED_REQUEST_HEADERS, TIMELINE_REVISION_REASONS_KNOWN } from '@dramai/api'
import { mergeHeaders, PROTECTED_HEADERS, TIMELINE_REVISION_REASONS } from '@dramai/core'

describe('the global list of protected request headers, exported by the contract', () => {
  it('is exactly the list the server enforces (one edit without the other turns this red)', () => {
    expect([...PROTECTED_REQUEST_HEADERS].sort()).toEqual([...PROTECTED_HEADERS].sort())
  })

  it('is lower case and has no duplicates, so the front end can compare names case-insensitively', () => {
    expect(PROTECTED_REQUEST_HEADERS.every((h) => h === h.toLowerCase())).toBe(true)
    expect(new Set(PROTECTED_REQUEST_HEADERS).size).toBe(PROTECTED_REQUEST_HEADERS.length)
  })

  it('every name in it really is ignored when a user sets it, in any case', () => {
    for (const name of PROTECTED_REQUEST_HEADERS) {
      for (const spelled of [name, name.toUpperCase()]) {
        const out = mergeHeaders({ 'X-Base': '1' }, { [spelled]: 'evil' })
        expect(Object.keys(out), spelled).toEqual(['X-Base'])
      }
    }
  })
})

describe('the known timeline revision reasons in the contract', () => {
  it('are exactly the ones the server writes (a new reason added on one side only turns this red)', () => {
    expect([...TIMELINE_REVISION_REASONS_KNOWN].sort()).toEqual(
      [...TIMELINE_REVISION_REASONS].sort(),
    )
  })
})
