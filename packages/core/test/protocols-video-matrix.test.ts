import { describe, expect, it } from 'vitest'
import { ProviderError } from '../src/providers/errors.ts'
import { runGeneration } from '../src/providers/executor.ts'
import { arkVideo, dashscopeVideo, klingContents } from '../src/providers/protocols/index.ts'
import type { AuthContext, MediaProtocol, VideoGenInput } from '../src/providers/types.ts'

/**
 * Review item 7 (design 7.1): the input matrix and restart-and-resume for the three new protocols.
 * Not exhaustive: the cases cycle through every value of every field at least once - task type (text to video,
 * first frame, first + last frame, 1 and 3 references, frame + references), each aspect ratio, audio on / off /
 * unset, every resolution tier and a spread of durations - and assert the request follows the rules.
 */

const png = (n: number) => ({ bytes: new Uint8Array([n, n, n]), mime: 'image/png' })
const ref = (n: number) => ({
  kind: 'image' as const,
  media: { kind: 'bytes' as const, ...png(n) },
})
const ASPECTS = ['9:16', '16:9', '1:1'] as const
const AUDIO = [true, false, undefined] as const

type Mode = 't2v' | 'i2v' | 'first_last' | 'ref1' | 'ref3' | 'frame+refs'
const inputFor = (mode: Mode): Partial<VideoGenInput> => {
  switch (mode) {
    case 't2v':
      return {}
    case 'i2v':
      return { image: png(1) }
    case 'first_last':
      return { image: png(1), lastImage: png(2) }
    case 'ref1':
      return { references: [ref(3)] }
    case 'ref3':
      return { references: [ref(3), ref(4), ref(5)] }
    case 'frame+refs':
      return { image: png(1), references: [ref(3), ref(4)] }
  }
}
// the requests are inspected field by field; their exact shape is pinned in each protocol's own test file
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Req = Record<string, any>
const body = (p: MediaProtocol<VideoGenInput>, a: AuthContext, i: VideoGenInput) =>
  (p.buildGenerateRequest(a, i).body as { value: Req }).value
const url = (p: MediaProtocol<VideoGenInput>, a: AuthContext, i: VideoGenInput) =>
  p.buildGenerateRequest(a, i).url

describe('ark-video: input matrix', () => {
  const MODES: Mode[] = ['t2v', 'i2v', 'first_last', 'ref1', 'ref3']
  const RES = ['480p', '720p', '1080p', '4k']
  const DUR = [4, 5, 8, 10, 15]
  const auth: AuthContext = {
    baseUrl: 'https://ark.example/api/v3',
    model: 'm',
    apiKey: 'k',
    method: 'api_key',
  }
  const cases = MODES.flatMap((mode, mi) =>
    ASPECTS.map((aspect, ai) => ({
      mode,
      aspect,
      audio: AUDIO[(mi + ai) % 3],
      resolution: RES[(mi * 3 + ai) % RES.length]!,
      durationSec: DUR[(mi + ai * 2) % DUR.length]!,
    })),
  )
  it.each(cases)(
    '$mode $aspect audio=$audio $resolution $durationSec s',
    ({ mode, aspect, audio, resolution, durationSec }) => {
      const input: VideoGenInput = {
        prompt: 'p',
        aspectRatio: aspect,
        resolution,
        durationSec,
        withAudio: audio,
        ...inputFor(mode),
      }
      const b = body(arkVideo, auth, input)
      expect(url(arkVideo, auth, input)).toBe(
        'https://ark.example/api/v3/contents/generations/tasks',
      )
      const roles = (b.content as Array<{ role?: string; type: string }>).map(
        (c) => c.role ?? c.type,
      )
      const expected: Record<string, string[]> = {
        t2v: ['text'],
        i2v: ['text', 'first_frame'],
        first_last: ['text', 'first_frame', 'last_frame'],
        ref1: ['text', 'reference_image'],
        ref3: ['text', 'reference_image', 'reference_image', 'reference_image'],
      }
      expect(roles).toEqual(expected[mode])
      expect(b.ratio).toBe(mode === 'i2v' || mode === 'first_last' ? 'adaptive' : aspect)
      expect(b.resolution).toBe(resolution)
      expect(b.duration).toBe(durationSec)
      expect(b.generate_audio).toBe(audio ?? false)
      expect(b.watermark).toBe(false)
    },
  )
  it('frame + references is refused (the three task types are exclusive)', () => {
    expect(() =>
      arkVideo.buildGenerateRequest(auth, { prompt: 'p', ...inputFor('frame+refs') }),
    ).toThrow(ProviderError)
  })
})

describe('kling-contents: input matrix (4.0 and 4.0 Flash)', () => {
  const MODES: Mode[] = ['t2v', 'i2v', 'first_last', 'ref1', 'ref3', 'frame+refs']
  const MODELS = ['kling-4.0', 'kling-4.0-flash'] as const
  const RES = { 'kling-4.0': ['720p', '1080p'], 'kling-4.0-flash': ['720p'] } as const
  const DUR = [3, 5, 10, 15, 20]
  const cases = MODELS.flatMap((model, ki) =>
    MODES.flatMap((mode, mi) =>
      ASPECTS.map((aspect, ai) => ({
        model,
        mode,
        aspect,
        audio: AUDIO[(mi + ai + ki) % 3],
        resolution: RES[model][(mi + ai) % RES[model].length]!,
        durationSec: DUR[(mi * 2 + ai + ki) % DUR.length]!,
      })),
    ),
  )
  it.each(cases)(
    '$model $mode $aspect audio=$audio $resolution $durationSec s',
    ({ model, mode, aspect, audio, resolution, durationSec }) => {
      const auth: AuthContext = {
        baseUrl: 'https://kling.example',
        model,
        apiKey: 'k',
        method: 'api_key',
      }
      const input: VideoGenInput = {
        prompt: 'p',
        aspectRatio: aspect,
        resolution,
        durationSec,
        withAudio: audio,
        ...inputFor(mode),
      }
      const b = body(klingContents, auth, input)
      const omni =
        model.endsWith('flash') || mode === 'ref1' || mode === 'ref3' || mode === 'frame+refs'
      const path = omni
        ? `/omni-video/${model}`
        : mode === 't2v'
          ? `/text-to-video/${model}`
          : `/image-to-video/${model}`
      expect(url(klingContents, auth, input)).toBe(`https://kling.example${path}`)
      expect(b.settings.duration).toBe(durationSec)
      expect(b.settings.resolution).toBe(resolution)
      expect(b.options).toEqual({ watermark_info: { enabled: false } })
      if (path.startsWith('/text-to-video')) {
        expect(b.prompt).toBe('p')
        expect(b).not.toHaveProperty('contents')
        expect(b.settings.aspect_ratio).toBe(aspect)
        return
      }
      const types = (b.contents as Array<{ type: string }>).map((c) => c.type)
      const refs = mode === 'ref1' ? 1 : mode === 'ref3' ? 3 : mode === 'frame+refs' ? 2 : 0
      expect(types).toEqual([
        'prompt',
        ...(mode === 'i2v' || mode === 'first_last' || mode === 'frame+refs'
          ? ['first_frame']
          : []),
        ...Array(refs).fill('refer_image'),
        ...(mode === 'first_last' ? ['last_frame'] : []),
      ])
      if (omni) {
        expect(b.settings.aspect_ratio).toBe(input.image ? 'adaptive' : aspect)
        if (audio) expect(b.settings.audio).toBe('native')
        else expect(b.settings).not.toHaveProperty('audio')
      } else {
        expect(b.settings).not.toHaveProperty('aspect_ratio')
        expect(b.settings).not.toHaveProperty('audio')
      }
      const ids = (b.contents as Array<{ type: string; id?: string }>)
        .filter((c) => c.type === 'refer_image')
        .map((c) => c.id)
      expect(ids).toEqual(Array.from({ length: refs }, (_, i) => `image_${i + 1}`))
    },
  )
})

describe('dashscope-video: input matrix', () => {
  const MODES: Mode[] = ['t2v', 'i2v', 'first_last', 'ref1', 'ref3']
  const RES = ['480P', '720P', '1080P']
  const DUR = [2, 5, 10, 15, 30]
  const auth: AuthContext = {
    baseUrl: 'https://ws.example',
    model: 'wan3.0-video',
    apiKey: 'k',
    method: 'api_key',
  }
  const cases = MODES.flatMap((mode, mi) =>
    ASPECTS.map((aspect, ai) => ({
      mode,
      aspect,
      audio: AUDIO[(mi + ai) % 3],
      resolution: RES[(mi + ai) % RES.length]!,
      durationSec: DUR[(mi + ai * 2) % DUR.length]!,
    })),
  )
  it.each(cases)(
    '$mode $aspect audio=$audio $resolution $durationSec s',
    ({ mode, aspect, audio, resolution, durationSec }) => {
      const input: VideoGenInput = {
        prompt: 'p',
        aspectRatio: aspect,
        resolution,
        durationSec,
        withAudio: audio,
        ...inputFor(mode),
      }
      const b = body(dashscopeVideo, auth, input)
      expect(url(dashscopeVideo, auth, input)).toBe(
        'https://ws.example/api/v1/services/aigc/video-generation/video-synthesis',
      )
      const types = ((b.input.media ?? []) as Array<{ type: string }>).map((m) => m.type)
      const expected: Record<string, string[]> = {
        t2v: [],
        i2v: ['first_frame'],
        first_last: ['first_frame', 'last_frame'],
        ref1: ['reference_image'],
        ref3: ['reference_image', 'reference_image', 'reference_image'],
      }
      expect(types).toEqual(expected[mode])
      expect('media' in b.input).toBe(mode !== 't2v')
      expect(b.parameters).toEqual({
        resolution,
        ratio: mode === 'i2v' || mode === 'first_last' ? 'adaptive' : aspect,
        duration: durationSec,
        audio: audio ?? false,
        prompt_extend: true,
        watermark: false,
      })
    },
  )
  it('frame + references is refused (white-list of material combinations)', () => {
    expect(() =>
      dashscopeVideo.buildGenerateRequest(auth, { prompt: 'p', ...inputFor('frame+refs') }),
    ).toThrow(ProviderError)
  })
})

describe('restart and resume: a task that was submitted is polled again, never submitted twice', () => {
  const frame = { prompt: 'p', durationSec: 5, image: png(1) } as VideoGenInput
  const SPECS = [
    {
      name: 'ark-video',
      protocol: arkVideo,
      auth: {
        baseUrl: 'https://ark.example/api/v3',
        model: 'm',
        apiKey: 'k',
        method: 'api_key',
      } as AuthContext,
      isSubmit: (u: string, m: string) => m === 'POST' && u.endsWith('/contents/generations/tasks'),
      submitBody: { id: 'TASK-1' },
      pollUrl: 'https://ark.example/api/v3/contents/generations/tasks/TASK-1',
      done: { status: 'succeeded', content: { video_url: 'https://cdn/a.mp4' } },
    },
    {
      name: 'kling-contents',
      protocol: klingContents,
      auth: {
        baseUrl: 'https://kling.example',
        model: 'kling-4.0',
        apiKey: 'k',
        method: 'api_key',
      } as AuthContext,
      isSubmit: (u: string, m: string) => m === 'POST' && u.includes('/image-to-video/'),
      submitBody: { code: 0, data: { id: 'TASK-1' } },
      pollUrl: 'https://kling.example/tasks?task_ids=TASK-1',
      done: {
        code: 0,
        data: [
          {
            id: 'TASK-1',
            status: 'succeeded',
            outputs: [{ type: 'video', url: 'https://cdn/a.mp4' }],
          },
        ],
      },
    },
    {
      name: 'dashscope-video',
      protocol: dashscopeVideo,
      auth: {
        baseUrl: 'https://ws.example',
        model: 'wan3.0-video',
        apiKey: 'k',
        method: 'api_key',
      } as AuthContext,
      isSubmit: (u: string, m: string) => m === 'POST' && u.endsWith('/video-synthesis'),
      submitBody: { output: { task_id: 'TASK-1', task_status: 'PENDING' } },
      pollUrl: 'https://ws.example/api/v1/tasks/TASK-1',
      done: { output: { task_status: 'SUCCEEDED', video_url: 'https://cdn/a.mp4' } },
    },
  ] as const

  it.each(SPECS)(
    '$name: resumeTaskId skips the submit and polls that very task, then downloads',
    async (spec) => {
      const calls: Array<{ method: string; url: string }> = []
      const fetch = async (u: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        calls.push({ method, url: u })
        if (u === spec.pollUrl) return new Response(JSON.stringify(spec.done))
        if (u === 'https://cdn/a.mp4')
          return new Response(new Uint8Array([9]), { headers: { 'content-type': 'video/mp4' } })
        return new Response('unexpected', { status: 500 })
      }
      let submitted = 0
      const res = await runGeneration(
        spec.protocol as MediaProtocol<VideoGenInput>,
        spec.auth,
        frame,
        { fetch, sleep: async () => {} },
        {
          resumeTaskId: 'TASK-1',
          onSubmitted: () => {
            submitted++
          },
        },
      )
      expect(calls.map((c) => c.url)).toEqual([spec.pollUrl, 'https://cdn/a.mp4'])
      expect(calls.some((c) => spec.isSubmit(c.url, c.method))).toBe(false)
      expect(submitted).toBe(0)
      expect(res.taskId).toBe('TASK-1')
      expect(res.outputs[0]!.bytes[0]).toBe(9)
    },
  )

  it.each(SPECS)(
    '$name: a run that dies while polling (network gone) leaves the task id; the second run resumes it - one submit in total',
    async (spec) => {
      const calls: Array<{ method: string; url: string }> = []
      let online = false
      const fetch = async (u: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        calls.push({ method, url: u })
        if (spec.isSubmit(u, method)) return new Response(JSON.stringify(spec.submitBody))
        if (!online && u === spec.pollUrl) throw new TypeError('network down')
        if (u === spec.pollUrl) return new Response(JSON.stringify(spec.done))
        return new Response(new Uint8Array([9]), { headers: { 'content-type': 'video/mp4' } })
      }
      let checkpoint: string | undefined
      try {
        await runGeneration(
          spec.protocol as MediaProtocol<VideoGenInput>,
          spec.auth,
          frame,
          { fetch, sleep: async () => {} },
          {
            onSubmitted: (id) => {
              checkpoint = id
            },
          },
        )
        throw new Error('should have failed')
      } catch (e) {
        expect((e as ProviderError).code).toBe('POLL_FAILED')
        expect((e as ProviderError).recoverable).toBe(true)
      }
      expect(checkpoint).toBe('TASK-1')
      online = true
      await runGeneration(
        spec.protocol as MediaProtocol<VideoGenInput>,
        spec.auth,
        frame,
        { fetch, sleep: async () => {} },
        { resumeTaskId: checkpoint },
      )
      expect(calls.filter((c) => spec.isSubmit(c.url, c.method))).toHaveLength(1)
    },
  )
})
