import { describe, expect, it } from 'vitest'
import { downloadOutput, runGeneration } from '../src/providers/executor.ts'
import { ProviderError } from '../src/providers/errors.ts'
import { aliyunVideo } from '../src/providers/protocols/index.ts'
import type { MediaProtocol } from '../src/providers/types.ts'

const auth = { baseUrl: 'https://api.example.com', model: 'm', apiKey: 'sk' }
const image = { bytes: new Uint8Array([1]), mime: 'image/png' }

const withHook: MediaProtocol<{ prompt: string; image: typeof image }> = {
  ...(aliyunVideo as unknown as MediaProtocol<{ prompt: string; image: typeof image }>),
  parseHttpError: (raw) => {
    const j = raw.json as { code?: string; message?: string } | undefined
    return { code: j?.code, message: j?.message, recoverable: j?.code === 'Throttled' }
  },
}

const failing = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status })

async function fail(p: Promise<unknown>): Promise<ProviderError> {
  try {
    await p
  } catch (e) {
    return e as ProviderError
  }
  throw new Error('expected failure')
}

describe('parseHttpError hook (optional per protocol)', () => {
  it('a protocol without the hook keeps HTTP_<status> and the response text', async () => {
    const err = await fail(
      runGeneration(
        aliyunVideo,
        auth,
        { prompt: 'p', image },
        { fetch: failing(429, { code: 'Throttled', message: 'slow down' }) },
      ),
    )
    expect(err.code).toBe('HTTP_429')
    expect(err.message).toContain('HTTP 429')
    expect(err.message).toContain('slow down') // the raw text snippet, as before
    expect(err.recoverable).toBe(false)
  })

  it('a protocol with the hook gets its own stable code, message and recoverable flag (submit)', async () => {
    const err = await fail(
      runGeneration(
        withHook,
        auth,
        { prompt: 'p', image },
        { fetch: failing(429, { code: 'Throttled', message: 'slow down' }) },
      ),
    )
    expect(err).toMatchObject({
      code: 'Throttled',
      status: 429,
      recoverable: true,
      submission: 'rejected',
    })
    expect(err.message).toBe('HTTP 429 · slow down')
  })

  it('also on a refused poll', async () => {
    let n = 0
    const fetch = async () =>
      ++n === 1
        ? new Response(JSON.stringify({ output: { task_id: 'T' } }))
        : new Response(JSON.stringify({ code: 'InvalidApiKey', message: 'bad key' }), {
            status: 401,
          })
    const err = await fail(
      runGeneration(withHook, auth, { prompt: 'p', image }, { fetch, sleep: async () => {} }),
    )
    expect(err).toMatchObject({ code: 'InvalidApiKey', status: 401 })
    expect(err.message).toContain('bad key')
  })

  it('a hook that throws never hides the original error', async () => {
    const broken = {
      ...withHook,
      parseHttpError: () => {
        throw new Error('hook bug')
      },
    }
    const err = await fail(
      runGeneration(broken, auth, { prompt: 'p', image }, { fetch: failing(500, { x: 1 }) }),
    )
    expect(err.code).toBe('HTTP_500')
  })
})

describe('download headers', () => {
  it('an output may carry the headers its download needs; without them the request has none', async () => {
    const seen: Array<Record<string, string>> = []
    const fetch = async (_u: string, init?: RequestInit) => {
      seen.push({ ...(init?.headers as Record<string, string>) })
      return new Response(new Uint8Array([1]), { headers: { 'content-type': 'video/mp4' } })
    }
    await downloadOutput({ kind: 'url', url: 'https://cdn/x.mp4' }, { fetch })
    await downloadOutput(
      { kind: 'url', url: 'https://cdn/x.mp4', headers: { Referer: 'https://app/' } },
      { fetch },
    )
    expect(seen).toEqual([{}, { Referer: 'https://app/' }])
  })
})
