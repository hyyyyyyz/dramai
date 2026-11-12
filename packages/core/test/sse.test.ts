import { describe, expect, it } from 'vitest'
import { parseSseJson } from '../src/util/sse.ts'

function streamOf(chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === 'string' ? enc.encode(c) : c)
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const out: unknown[] = []
  for await (const f of parseSseJson(stream)) out.push(f.data)
  return out
}

describe('parseSseJson', () => {
  it('parses simple events and stops at [DONE]', async () => {
    const out = await collect(
      streamOf(['data: {"a":1}\n\ndata: {"a":2}\n\ndata: [DONE]\n\ndata: {"a":3}\n\n']),
    )
    expect(out).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('handles CRLF line endings', async () => {
    const out = await collect(streamOf(['data: {"a":1}\r\n\r\ndata: {"a":2}\r\n\r\n']))
    expect(out).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('reassembles events split at arbitrary chunk boundaries (including CRLF split)', async () => {
    const full = 'data: {"msg":"hello"}\r\n\r\ndata: {"msg":"world"}\r\n\r\n'
    for (let cut = 1; cut < full.length; cut++) {
      const out = await collect(streamOf([full.slice(0, cut), full.slice(cut)]))
      expect(out).toEqual([{ msg: 'hello' }, { msg: 'world' }])
    }
  })

  it('does not break a multi-byte character split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: {"t":"你好"}\n\n')
    const out = await collect(streamOf([bytes.slice(0, 11), bytes.slice(11)]))
    expect(out).toEqual([{ t: '你好' }])
  })

  it('skips comments / keep-alives and non-JSON payloads', async () => {
    const out = await collect(
      streamOf([': ping\n\ndata: not json\n\ndata: {"ok":true}\n\n: another\n\n']),
    )
    expect(out).toEqual([{ ok: true }])
  })

  it('joins multiple data lines with a newline', async () => {
    const out = await collect(streamOf(['data: {"a":\ndata: 1}\n\n']))
    expect(out).toEqual([{ a: 1 }])
  })

  it('yields the final event even without a trailing blank line', async () => {
    const out = await collect(streamOf(['data: {"a":1}\n\ndata: {"a":2}']))
    expect(out).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('exposes the event name', async () => {
    const frames: Array<{ event?: string; data: unknown }> = []
    for await (const f of parseSseJson(streamOf(['event: update\ndata: {"x":1}\n\n'])))
      frames.push(f)
    expect(frames).toEqual([{ event: 'update', data: { x: 1 } }])
  })

  it('cancels the underlying stream when the consumer stops early', async () => {
    let cancelled = false
    const enc = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(enc.encode('data: {"n":1}\n\n'))
      },
      cancel() {
        cancelled = true
      },
    })
    for await (const f of parseSseJson(stream)) {
      expect(f.data).toEqual({ n: 1 })
      break
    }
    expect(cancelled).toBe(true)
  })
})
