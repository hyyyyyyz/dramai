import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildExpectations } from '../src/artifacts/staleness.ts'
import { configFromPreset, PROVIDER_PRESETS } from '../src/providers/presets.ts'
import { runGeneration } from '../src/providers/executor.ts'
import {
  aliyunVideo,
  genericVideo,
  getMediaProtocol,
  klingVideo,
  volcengineVideo,
} from '../src/providers/protocols/index.ts'
import { digestOf } from '../src/util/canonical.ts'
import { computeLegacyVideoGolden } from './legacy-video-cases.ts'
import { makeWorld } from './helpers.ts'

/**
 * 步骤 0：钉死旧视频协议和已实测预设的行为（P3c 的所有后续改动都不能让这些测试变化）。
 *
 * - 黄金文件由 `b06d198`（视频协议改动之前）的代码生成：19 组输入 × 各协议的完整请求
 *   （URL、方法、头、体）、提交响应解析、轮询请求、正常轮询响应的解析结果。
 * - 已实测的 302.AI 通义万相 Wan2.2 Flash 预设走一遍执行器（提交 → 轮询 → 下载）的整个请求序列。
 * - 视频产物的依据（buildExpectations）逐项钉住。
 */

describe('legacy video protocols: requests and normal responses are exactly the b06d198 ones', () => {
  const golden = JSON.parse(
    readFileSync(new URL('./fixtures/legacy-video-golden.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>
  const current = computeLegacyVideoGolden({
    'aliyun-video': aliyunVideo,
    'volcengine-video': volcengineVideo,
    'kling-video': klingVideo,
    'generic-video': genericVideo,
  } as never)

  it.each(['aliyun-video', 'volcengine-video', 'kling-video', 'generic-video'])('%s', (id) => {
    expect(current[id]).toEqual(golden[id])
  })

  it('the registry still returns the same protocol objects', () => {
    expect(getMediaProtocol('aliyun-video')).toBe(aliyunVideo)
    expect(getMediaProtocol('volcengine-video')).toBe(volcengineVideo)
    expect(getMediaProtocol('kling-video')).toBe(klingVideo)
    expect(getMediaProtocol('generic-video')).toBe(genericVideo)
  })
})

describe('the tested preset 302-i2v-wan-flash: the whole request sequence', () => {
  it('submit → poll → download', async () => {
    const preset = PROVIDER_PRESETS.find((p) => p.id === '302-i2v-wan-flash')!
    const config = configFromPreset(preset, { id: 'prov-1', secretRef: 'k' })
    expect(config).toMatchObject({
      protocol: 'aliyun-video',
      baseUrl: 'https://api.302ai.cn',
      model: 'wan2.2-i2v-flash',
    })
    const calls: Array<{ method: string; url: string; headers: unknown; body?: unknown }> = []
    const fetch = async (url: string, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? 'GET',
        url,
        headers: init?.headers,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      })
      if (url.endsWith('/video-synthesis'))
        return new Response(JSON.stringify({ output: { task_id: 'T1', task_status: 'PENDING' } }))
      if (url.includes('/tasks/'))
        return new Response(
          JSON.stringify({
            output: { task_status: 'SUCCEEDED', video_url: 'https://cdn.example/v.mp4' },
          }),
        )
      return new Response(new Uint8Array([7]), { headers: { 'content-type': 'video/mp4' } })
    }
    const res = await runGeneration(
      getMediaProtocol(config.protocol),
      { baseUrl: config.baseUrl, model: config.model, apiKey: 'sk-secret', method: 'api_key' },
      {
        prompt: '镜头缓慢推近',
        cameraInstruction: '固定机位',
        image: { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' },
        durationSec: 8,
        allowedDurations: [5],
        aspectRatio: '9:16',
        resolution: '720P',
        withAudio: false,
      },
      { fetch, sleep: async () => {} },
    )
    expect(res.taskId).toBe('T1')
    expect(calls).toEqual([
      {
        method: 'POST',
        url: 'https://api.302ai.cn/aliyun/api/v1/services/aigc/video-generation/video-synthesis',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer sk-secret',
          'X-DashScope-Async': 'enable',
        },
        body: {
          model: 'wan2.2-i2v-flash',
          input: {
            prompt: '镜头缓慢推近. 固定机位',
            img_url: 'data:image/png;base64,AQID',
          },
          parameters: { resolution: '720P', duration: 5, prompt_extend: true, watermark: false },
        },
      },
      {
        method: 'GET',
        url: 'https://api.302ai.cn/aliyun/api/v1/tasks/T1',
        headers: { Authorization: 'Bearer sk-secret' },
        body: undefined,
      },
      { method: 'GET', url: 'https://cdn.example/v.mp4', headers: {}, body: undefined },
    ])
  })
})

describe('the video artifact basis is unchanged (what makes a video stale)', () => {
  it('shot_video: basis fields and upstream', async () => {
    const w = await makeWorld()
    const exp = buildExpectations(await w.reload())
    const e = exp.get(`shot_video:${w.shot.id}`)!
    expect(e.kind).toBe('shot_video')
    expect(Object.keys(e.basis as object).sort()).toEqual(['aspect', 'durationSec', 'movement', 'prompt'])
    expect(e.basis).toMatchObject({
      prompt: '镜头缓慢推近，她转身看向窗外',
      durationSec: 5,
      aspect: '9:16',
    })
    expect(e.upstream).toEqual([`shot_image:${w.shot.id}`])
    expect(e.requiredUpstream).toEqual([`shot_image:${w.shot.id}`])
  })

  it('the whole expectation map of the fixed world has a fixed digest (any change to a basis shows up here)', async () => {
    const w = await makeWorld()
    const exp = buildExpectations(await w.reload())
    const keys = [...exp.keys()].sort()
    expect(keys.filter((k) => k.startsWith('shot_video:'))).toHaveLength(2)
    expect(digestOf(keys.map((k) => [k, exp.get(k)]))).toBe(
      'c1875d24f401e46d9f8e56c47d5e819234e5f3b3c5679739e304decab5384e58',
    )
  })
})
