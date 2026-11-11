import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildSubtitlesFilter,
  burnSubtitles,
  composeSequence,
  concatClips,
  createFfmpegImageEncoder,
  embedSoftSubtitles,
  escapeFilterValue,
  FfmpegError,
  FfmpegNotFoundError,
  fitReferenceImages,
  locateFfmpeg,
  MediaCapabilityError,
  mixNarration,
  normalizeClip,
  parseFfmpegBanner,
  parseFfprobeJson,
  probeCapabilities,
  probeMedia,
  runFfmpeg,
  runProcess,
} from '../src/media/index.ts'
import type { FfmpegBinaries, FfmpegCapabilities, RenderEnv } from '../src/media/index.ts'
import { readImageSize } from '../src/parsers/image-size.ts'
import { buildSrt } from '../src/subtitles/index.ts'

// 真实 ffmpeg 的测试。找不到 ffmpeg 时整组跳过，并明确说明原因。
const located = await locateFfmpeg().catch(() => undefined)
if (!located) {
  console.warn(
    '[media tests] SKIPPED: ffmpeg not found on PATH. Install ffmpeg or set DRAMAI_FFMPEG to run them.',
  )
}
const realFfmpeg = describe.skipIf(!located)

describe('ffmpeg output parsing (no binary needed)', () => {
  it('parses ffprobe JSON', () => {
    const info = parseFfprobeJson(
      JSON.stringify({
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 720,
            height: 1280,
            avg_frame_rate: '24/1',
          },
          { codec_type: 'audio', codec_name: 'aac' },
        ],
        format: { duration: '3.500000' },
      }),
    )
    expect(info).toEqual({
      durationSec: 3.5,
      hasVideo: true,
      hasAudio: true,
      width: 720,
      height: 1280,
      fps: 24,
      videoCodec: 'h264',
      audioCodec: 'aac',
    })
    expect(parseFfprobeJson('{"streams":[{"codec_type":"audio"}],"format":{}}')).toMatchObject({
      hasVideo: false,
      hasAudio: true,
    })
  })

  it('parses the ffmpeg -i banner as a fallback when ffprobe is missing', () => {
    const banner = `Input #0, mov,mp4, from 'a.mp4':
  Duration: 00:00:02.50, start: 0.000000, bitrate: 100 kb/s
  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 320x240, 24 fps, 24 tbr
  Stream #0:1[0x2](und): Audio: aac (LC), 48000 Hz, stereo, fltp`
    expect(parseFfmpegBanner(banner)).toMatchObject({
      durationSec: 2.5,
      hasVideo: true,
      hasAudio: true,
      width: 320,
      height: 240,
      fps: 24,
      videoCodec: 'h264',
      audioCodec: 'aac',
    })
    expect(parseFfmpegBanner('Stream #0:0: Video: h264, yuv420p, 640x360').hasAudio).toBe(false)
  })

  it('builds and escapes the subtitles filter', () => {
    expect(escapeFilterValue("C:\\a b\\it's,[x];y")).toBe("C\\:\\\\a b\\\\it\\'s\\,\\[x\\]\\;y")
    const f = buildSubtitlesFilter('/tmp/a:b.srt', '/fonts', {
      fontName: 'Noto Sans CJK SC',
      fontSize: 16,
    })
    expect(
      f.startsWith("subtitles=filename='/tmp/a\\:b.srt':fontsdir='/fonts':force_style='"),
    ).toBe(true)
    expect(f).toContain('FontName=Noto Sans CJK SC')
    expect(f).toContain('FontSize=16')
    expect(buildSubtitlesFilter('/x.srt')).not.toContain('fontsdir')
  })
})

describe('locating ffmpeg: option → DRAMAI_FFMPEG → PATH', () => {
  it('rejects a bad explicit path without falling back', async () => {
    await expect(
      locateFfmpeg({ ffmpegPath: '/definitely/not/here/ffmpeg' }),
    ).rejects.toBeInstanceOf(FfmpegNotFoundError)
  })

  it('rejects a bad DRAMAI_FFMPEG without falling back to PATH', async () => {
    await expect(
      locateFfmpeg({ env: { DRAMAI_FFMPEG: '/nope/ffmpeg', PATH: process.env.PATH } }),
    ).rejects.toThrow(/DRAMAI_FFMPEG/)
  })

  it('fails with a helpful message when there is no ffmpeg anywhere', async () => {
    await expect(locateFfmpeg({ env: { PATH: '/nonexistent-dir' } })).rejects.toThrow(
      /DRAMAI_FFMPEG/,
    )
  })

  it.skipIf(!located)('prefers the explicit option over the env var over PATH', async () => {
    const real = located!.ffmpeg
    const viaOption = await locateFfmpeg({
      ffmpegPath: real,
      env: { DRAMAI_FFMPEG: '/nope', PATH: '' },
    })
    expect(viaOption).toMatchObject({ ffmpeg: real, source: 'option' })
    const viaEnv = await locateFfmpeg({ env: { DRAMAI_FFMPEG: real, PATH: '' } })
    expect(viaEnv).toMatchObject({ ffmpeg: real, source: 'env' })
    const viaPath = await locateFfmpeg({ env: { PATH: dirname(real) } })
    expect(viaPath).toMatchObject({ ffmpeg: real, source: 'path' })
  })
})

realFfmpeg('native ffmpeg (real binary, lavfi test sources)', () => {
  let bins: FfmpegBinaries
  let caps: FfmpegCapabilities
  let env: RenderEnv
  let dir: string
  const f = (name: string) => join(dir, name)

  const meanVolume = async (file: string, ss = 0, t = 1) => {
    const r = await runProcess(bins.ffmpeg, [
      '-hide_banner',
      '-ss',
      String(ss),
      '-t',
      String(t),
      '-i',
      file,
      '-vn',
      '-af',
      'volumedetect',
      '-f',
      'null',
      '-',
    ])
    const m = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(r.stderr)
    return m ? (m[1] === '-inf' ? -Infinity : Number(m[1])) : Number.NaN
  }

  beforeAll(async () => {
    bins = located!
    caps = await probeCapabilities(bins)
    env = { bins, caps }
    dir = await mkdtemp(join(tmpdir(), 'dramai-media-test-'))
    // A：320x240，带 440Hz 音轨，1 秒
    await runFfmpeg(bins, [
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x240:rate=24:duration=1',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      f('a_audio.mp4'),
    ])
    // B：640x360，**没有音轨**，1 秒
    await runFfmpeg(bins, [
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=640x360:rate=25:duration=1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-an',
      f('b_silent.mp4'),
    ])
    // C：正方形 300x300，带音轨
    await runFfmpeg(bins, [
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=300x300:rate=24:duration=1',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=880:duration=1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      f('c_square.mp4'),
    ])
    // 旁白：2 秒 660Hz
    await runFfmpeg(bins, [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=660:duration=1',
      '-c:a',
      'pcm_s16le',
      f('narration.wav'),
    ])
    await writeFile(
      f('subs.srt'),
      buildSrt([
        { startMs: 0, endMs: 900, text: '你好 hello' },
        { startMs: 1000, endMs: 1900, text: '第二句' },
      ]),
      'utf8',
    )
  }, 60_000)

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reports capabilities, not just presence — and explains what is missing', () => {
    console.info(
      `[media tests] ffmpeg ${caps.version}; encoder=${caps.videoEncoder}; features=${JSON.stringify(caps.features)}`,
    )
    expect(caps.ok).toBe(true)
    expect(caps.features.h264).toBe(true)
    expect(caps.features.aac).toBe(true)
    expect(caps.version).not.toBe('unknown')
    // 每个缺失的能力都对应 features 里的 false，并且带原因和补救办法
    for (const m of caps.missing) {
      expect(caps.features[m.feature]).toBe(false)
      expect(m.reason.length).toBeGreaterThan(5)
      expect(m.remedy.length).toBeGreaterThan(5)
    }
    for (const [feature, ok] of Object.entries(caps.features)) {
      if (!ok) expect(caps.missing.some((m) => m.feature === feature)).toBe(true)
    }
  })

  it('probes media', async () => {
    expect(await probeMedia(bins, f('a_audio.mp4'))).toMatchObject({
      hasVideo: true,
      hasAudio: true,
      width: 320,
      height: 240,
    })
    expect(await probeMedia(bins, f('b_silent.mp4'))).toMatchObject({
      hasVideo: true,
      hasAudio: false,
      width: 640,
      height: 360,
    })
    // 没有 ffprobe 时退回解析 ffmpeg 输出
    const noProbe = await probeMedia({ ffmpeg: bins.ffmpeg, source: 'path' }, f('a_audio.mp4'))
    expect(noProbe).toMatchObject({ hasVideo: true, hasAudio: true, width: 320, height: 240 })
  })

  it('surfaces ffmpeg failures with the stderr tail', async () => {
    const err = await runFfmpeg(bins, ['-i', f('does-not-exist.mp4'), f('x.mp4')]).catch((e) => e)
    expect(err).toBeInstanceOf(FfmpegError)
    expect((err as FfmpegError).stderrTail).toContain('does-not-exist')
  })

  it('stops a running ffmpeg when aborted', async () => {
    const ac = new AbortController()
    const p = runFfmpeg(
      bins,
      ['-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=60:duration=600', '-f', 'null', '-'],
      { signal: ac.signal },
    )
    setTimeout(() => ac.abort(), 150)
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })

  describe('normalizeClip: project aspect ratio, never a hard-coded 1280×720', () => {
    it.each([
      ['9:16', 360, 360, 640],
      ['16:9', 360, 640, 360],
      ['1:1', 360, 360, 360],
    ] as const)('%s with short side %i → %ix%i', async (ratio, shortSide, w, h) => {
      const out = f(`norm_${ratio.replace(':', 'x')}.mp4`)
      const info = await normalizeClip(env, {
        input: f('a_audio.mp4'),
        output: out,
        aspectRatio: ratio,
        shortSide,
      })
      expect(info).toMatchObject({ width: w, height: h, hasAudio: true, hasVideo: true, fps: 24 })
    })

    it('letterboxes instead of stretching (4:3 source into 9:16 keeps content centred)', async () => {
      const out = f('norm_box.mp4')
      await normalizeClip(env, {
        input: f('a_audio.mp4'),
        output: out,
        aspectRatio: '9:16',
        shortSide: 360,
      })
      // 取一帧，上下黑边：顶部一行几乎全黑
      const r = await runProcess(bins.ffmpeg, [
        '-hide_banner',
        '-i',
        out,
        '-vf',
        'crop=360:4:0:0,signalstats,metadata=print:key=lavfi.signalstats.YAVG',
        '-frames:v',
        '1',
        '-f',
        'null',
        '-',
      ])
      const yavg = Number(/YAVG=([\d.]+)/.exec(r.stderr + r.stdout)?.[1])
      expect(yavg).toBeLessThan(20)
    })

    it('adds a silent audio track to clips that have none, so concat stays in sync', async () => {
      const out = f('norm_silent.mp4')
      const info = await normalizeClip(env, {
        input: f('b_silent.mp4'),
        output: out,
        aspectRatio: '9:16',
        shortSide: 360,
      })
      expect(info.hasAudio).toBe(true)
      expect(info.durationSec).toBeGreaterThan(0.8)
      expect(info.durationSec).toBeLessThan(1.4)
      expect(await meanVolume(out)).toBeLessThan(-80) // 静音
    })

    it('refuses an input without a video stream', async () => {
      await expect(
        normalizeClip(env, { input: f('narration.wav'), output: f('x.mp4'), aspectRatio: '9:16' }),
      ).rejects.toThrow(/没有视频流/)
    })
  })

  describe('composeSequence: 9:16 output that keeps the audio', () => {
    it('concatenates a clip with audio and a clip without audio into one 9:16 file with audio throughout', async () => {
      const out = f('cut_916.mp4')
      const phases: string[] = []
      const res = await composeSequence(env, {
        clips: [f('a_audio.mp4'), f('b_silent.mp4'), f('c_square.mp4')],
        aspectRatio: '9:16',
        shortSide: 360,
        output: out,
        onProgress: (p) => phases.push(p.phase),
      })
      expect(res.info).toMatchObject({ width: 360, height: 640, hasAudio: true, hasVideo: true })
      expect(res.info.durationSec).toBeGreaterThan(2.7)
      expect(res.info.durationSec).toBeLessThan(3.5)
      expect(phases).toEqual(['normalizing', 'normalizing', 'normalizing', 'concatenating', 'done'])
      // 音频真的在：第一段（A）和第三段（C）有声，中间那段（B 没音轨）是静音
      expect(await meanVolume(out, 0.1, 0.7)).toBeGreaterThan(-40)
      expect(await meanVolume(out, 1.15, 0.7)).toBeLessThan(-70)
      expect(await meanVolume(out, 2.2, 0.6)).toBeGreaterThan(-40)
    })

    it('uses the project aspect ratio for 16:9 and 1:1 as well', async () => {
      const wide = await composeSequence(env, {
        clips: [f('a_audio.mp4')],
        aspectRatio: '16:9',
        shortSide: 360,
        output: f('cut_169.mp4'),
      })
      expect([wide.info.width, wide.info.height]).toEqual([640, 360])
      const square = await composeSequence(env, {
        clips: [f('a_audio.mp4'), f('c_square.mp4')],
        aspectRatio: '1:1',
        shortSide: 360,
        output: f('cut_11.mp4'),
      })
      expect([square.info.width, square.info.height]).toEqual([360, 360])
    })

    it('mixes a narration track in at its start time while keeping the source audio', async () => {
      const out = f('cut_narr.mp4')
      const res = await composeSequence(env, {
        clips: [f('a_audio.mp4'), f('c_square.mp4')],
        aspectRatio: '9:16',
        shortSide: 360,
        output: out,
        narration: [{ path: f('narration.wav'), startSec: 1, volume: 1 }],
        sourceVolume: 0.5,
      })
      expect(res.info).toMatchObject({ hasAudio: true, width: 360, height: 640 })
      expect(res.info.durationSec).toBeGreaterThan(1.7)
      expect(res.info.durationSec).toBeLessThan(2.5) // 长度以画面为准，旁白不会拉长成片
      expect(await meanVolume(out, 0.1, 0.7)).toBeGreaterThan(-45) // 原声保留（压低过）
      expect(await meanVolume(out, 1.1, 0.7)).toBeGreaterThan(-40) // 叠上旁白
    })

    it('exports the source audio untouched when no narration is given (sourceVolume ignored)', async () => {
      const res = await composeSequence(env, {
        clips: [f('a_audio.mp4')],
        aspectRatio: '9:16',
        shortSide: 360,
        output: f('plain.mp4'),
        sourceVolume: 0.1,
      })
      expect(await meanVolume(res.output, 0.1, 0.7)).toBeGreaterThan(-40)
    })

    it('rejects an empty clip list', async () => {
      await expect(
        composeSequence(env, { clips: [], aspectRatio: '9:16', output: f('none.mp4') }),
      ).rejects.toThrow()
      await expect(concatClips(env, [], f('none.mp4'), dir)).rejects.toThrow()
    })

    it('cleans up its own temporary directory', async () => {
      const before = await runProcess('ls', [tmpdir()])
      await composeSequence(env, {
        clips: [f('a_audio.mp4')],
        aspectRatio: '9:16',
        shortSide: 240,
        output: f('tidy.mp4'),
      })
      const after = await runProcess('ls', [tmpdir()])
      const count = (s: string) =>
        s.split('\n').filter((l) => l.startsWith('dramai-compose-')).length
      expect(count(after.stdout)).toBe(count(before.stdout))
    })
  })

  describe('mixNarration', () => {
    it('does not change the video stream (copy) and keeps the duration', async () => {
      const base = await normalizeClip(env, {
        input: f('a_audio.mp4'),
        output: f('mix_base.mp4'),
        aspectRatio: '9:16',
        shortSide: 360,
      })
      await mixNarration(env, {
        input: f('mix_base.mp4'),
        tracks: [{ path: f('narration.wav'), startSec: 0 }],
        output: f('mix_out.mp4'),
      })
      const out = await probeMedia(bins, f('mix_out.mp4'))
      expect(out).toMatchObject({ width: 360, height: 640, hasAudio: true })
      expect(Math.abs(out.durationSec! - base.durationSec!)).toBeLessThan(0.15)
    })
    it('rejects an empty track list', async () => {
      await expect(
        mixNarration(env, { input: f('a_audio.mp4'), tracks: [], output: f('x.mp4') }),
      ).rejects.toThrow()
    })
  })

  describe('subtitles', () => {
    it('soft subtitles (mov_text) work without libass', async () => {
      const out = f('soft.mp4')
      await embedSoftSubtitles(env, {
        input: f('a_audio.mp4'),
        srtPath: f('subs.srt'),
        output: out,
      })
      const r = await runProcess(
        bins.ffprobe ?? bins.ffmpeg,
        bins.ffprobe
          ? ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'csv=p=0', out]
          : ['-i', out],
      )
      expect(r.stdout + r.stderr).toMatch(/subtitle|mov_text/)
    })

    it('composeSequence can deliver soft subtitles', async () => {
      const res = await composeSequence(env, {
        clips: [f('a_audio.mp4')],
        aspectRatio: '9:16',
        shortSide: 240,
        output: f('cut_soft.mp4'),
        subtitles: { srtPath: f('subs.srt'), mode: 'soft' },
      })
      expect(res.subtitleMode).toBe('soft')
      expect(res.info).toMatchObject({ width: 234, height: 416 }) // 9:16 在步长 2 下比例零误差的最近值
    })

    if (caps_hasBurnIn()) {
      it('burns subtitles in when libass is available', async () => {
        const out = f('burn.mp4')
        await burnSubtitles(env, { input: f('a_audio.mp4'), srtPath: f('subs.srt'), output: out })
        expect(await probeMedia(bins, out)).toMatchObject({
          width: 320,
          height: 240,
          hasAudio: true,
        })
      })
    } else {
      it('burn-in without libass fails loudly, says what to do, and does not silently skip', async () => {
        console.warn(
          '[media tests] this ffmpeg has no libass: the burn-in render test is replaced by the capability-error check.',
        )
        const err = await burnSubtitles(env, {
          input: f('a_audio.mp4'),
          srtPath: f('subs.srt'),
          output: f('burn.mp4'),
        }).catch((e) => e)
        expect(err).toBeInstanceOf(MediaCapabilityError)
        expect((err as MediaCapabilityError).feature).toBe('subtitleBurnIn')
        expect((err as Error).message).toMatch(/libass/)
        expect((err as Error).message).toMatch(/软字幕|SRT|libass 的构建/)
        // compose 在做任何渲染之前就拒绝，也不会偷偷降级成软字幕
        await expect(
          composeSequence(env, {
            clips: [f('a_audio.mp4')],
            aspectRatio: '9:16',
            shortSide: 240,
            output: f('cut_burn.mp4'),
            subtitles: { srtPath: f('subs.srt'), mode: 'burn' },
          }),
        ).rejects.toBeInstanceOf(MediaCapabilityError)
      })
    }
  })

  describe('reference image compression with the real encoder', () => {
    it('downsizes, keeps the ratio, and writes JPEG 4:4:4', async () => {
      const png = f('big.png')
      await runFfmpeg(bins, [
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=3000x2000:rate=1',
        '-frames:v',
        '1',
        png,
      ])
      const { readFile } = await import('node:fs/promises')
      const bytes = new Uint8Array(await readFile(png))
      expect(readImageSize(bytes)).toMatchObject({ width: 3000, height: 2000 })

      const encode = createFfmpegImageEncoder(bins)
      const res = await fitReferenceImages(
        [{ id: 'big', bytes, mime: 'image/png', width: 3000, height: 2000 }],
        encode,
      )
      const out = res.images[0]
      expect(out.reencoded).toBe(true)
      expect(out.mime).toBe('image/jpeg')
      expect(readImageSize(out.bytes)).toMatchObject({
        width: 2048,
        height: 1365,
        mime: 'image/jpeg',
      })

      if (bins.ffprobe) {
        await writeFile(f('big_out.jpg'), out.bytes)
        const r = await runProcess(bins.ffprobe, [
          '-v',
          'error',
          '-show_entries',
          'stream=pix_fmt',
          '-of',
          'csv=p=0',
          f('big_out.jpg'),
        ])
        expect(r.stdout.trim()).toBe('yuvj444p')
      }
    })

    it('keeps a first frame at full size and only drops quality when it is over the byte budget', async () => {
      const png = f('frame.png')
      await runFfmpeg(bins, [
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=2400x1350:rate=1',
        '-frames:v',
        '1',
        png,
      ])
      const { readFile } = await import('node:fs/promises')
      const bytes = new Uint8Array(await readFile(png))
      const encode = createFfmpegImageEncoder(bins)
      const q92 = await encode({ id: 'f', bytes, mime: 'image/png' }, { quality: 92 })
      const small = await fitReferenceImages(
        [{ id: 'f', bytes, mime: 'image/png', width: 2400, height: 1350, role: 'frame' }],
        encode,
        {
          // 预算比 q92 的结果小一点：需要降质量，但仍不缩尺寸
          limits: {
            maxTotalBytes: 8 * 1024 * 1024,
            maxImageBytes: q92.bytes.byteLength - 1,
            maxLongSide: 2048,
            startQuality: 92,
            minQuality: 80,
          },
        },
      )
      expect(small.images[0].reencoded).toBe(true)
      expect(readImageSize(small.images[0].bytes)).toMatchObject({ width: 2400, height: 1350 }) // 不缩尺寸
    })
  })
})

function caps_hasBurnIn(): boolean {
  // describe 体在收集阶段同步执行，这里同步探测一次 libass 是否可用来选择测试分支。
  if (!located) return false
  const { spawnSync } = require_child_process()
  const r = spawnSync(located.ffmpeg, ['-hide_banner', '-filters'], { encoding: 'utf8' })
  return /\bsubtitles\b/.test(r.stdout ?? '')
}

import { createRequire } from 'node:module'
function require_child_process() {
  return createRequire(import.meta.url)('node:child_process') as typeof import('node:child_process')
}
