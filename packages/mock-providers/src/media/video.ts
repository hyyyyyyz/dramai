import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { locateFfmpeg, probeCapabilities, runFfmpeg } from '@dramai/core'
import type { FfmpegBinaries, FfmpegCapabilities } from '@dramai/core'

export interface VideoRequest {
  /** 起始帧（PNG / JPEG 字节）。没有就用测试图案。 */
  image?: Uint8Array
  durationSec: number
  /** 输出短边（像素）；起始帧存在时按它的比例缩放。 */
  width: number
  height: number
  withAudio: boolean
}

export interface MediaEnv {
  bins: FfmpegBinaries
  caps: FfmpegCapabilities
}

let cached: Promise<MediaEnv | undefined> | undefined

/** 定位 ffmpeg（只探测一次）。找不到返回 undefined——图片 / 配音 / 对话不需要它，只有视频需要。 */
export function locateMedia(): Promise<MediaEnv | undefined> {
  cached ??= (async () => {
    try {
      const bins = await locateFfmpeg()
      return { bins, caps: await probeCapabilities(bins) }
    } catch {
      return undefined
    }
  })()
  return cached
}

/** Height of the ink control bar under a placeholder video (even, as the encoder wants). */
export const videoBarHeight = (h: number): number => Math.max(12, Math.round((h * 0.06) / 2) * 2)

/**
 * What tells a placeholder video from the placeholder picture it came from, with no fonts needed (drawbox only):
 * an ink control bar under the picture with a blinking cinnabar record square and a timeline whose cinnabar fill
 * grows with the playhead. Colours are the product's ink and cinnabar. The picture itself is scaled into the area
 * above the bar, so the output keeps the requested size.
 */
export function videoBar(w: number, h: number, durationSec: number): string {
  const bar = videoBarHeight(h)
  const y0 = h - bar
  const dot = Math.max(4, Math.round(bar * 0.38))
  const pad = Math.round(bar * 0.4)
  const dy = y0 + Math.round((bar - dot) / 2)
  const tl0 = pad * 2 + dot
  const tl1 = w - pad
  const th = Math.max(2, Math.round(bar * 0.16))
  const ty = y0 + Math.round((bar - th) / 2)
  const steps = 24
  const parts = [
    `pad=${w}:${h}:0:0:color=0x100E0C`,
    `drawbox=x=${pad}:y=${dy}:w=${dot}:h=${dot}:color=0xDF500C:t=fill:enable='lt(mod(t,1),0.6)'`,
    `drawbox=x=${tl0}:y=${ty}:w=${Math.max(1, tl1 - tl0)}:h=${th}:color=0x4A453F:t=fill`,
  ]
  for (let k = 0; k < steps; k++) {
    const x0 = tl0 + Math.floor(((tl1 - tl0) * k) / steps)
    const x1 = tl0 + Math.floor(((tl1 - tl0) * (k + 1)) / steps)
    parts.push(
      `drawbox=x=${x0}:y=${ty}:w=${Math.max(1, x1 - x0)}:h=${th}:color=0xDF500C:t=fill:enable='gte(t,${((durationSec * (k + 0.5)) / steps).toFixed(3)})'`,
    )
  }
  return parts.join(',')
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/**
 * 占位视频：把起始帧做成缓慢推近的片段（没有起始帧就用测试图案），时长按请求。
 * 需要 withAudio 时附一条低音量的音轨（模拟模型自带人声）。
 */
export async function renderPlaceholderVideo(
  env: MediaEnv,
  req: VideoRequest,
): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'dramai-mock-video-'))
  try {
    const w = even(req.width)
    const h = even(req.height)
    const out = join(dir, 'out.mp4')
    const encoder = env.caps.videoEncoder ?? 'libx264'
    const encodeArgs =
      encoder === 'libx264'
        ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30']
        : ['-c:v', encoder, '-b:v', '600k']
    const fps = 24
    const frames = Math.max(1, Math.round(req.durationSec * fps))
    const args: string[] = ['-y']
    if (req.image) {
      const img = join(dir, 'in.img')
      await writeFile(img, req.image)
      args.push('-i', img)
    } else {
      // no start frame: a blank sheet of storyboard paper (the overlay below says it is a video placeholder)
      args.push('-f', 'lavfi', '-i', `color=c=0xF6F2EA:size=${w}x${h}:rate=${fps}`)
    }
    if (req.withAudio) {
      args.push(
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=330:sample_rate=44100:duration=${req.durationSec}`,
      )
    }
    const picH = h - videoBarHeight(h)
    const motion = req.image
      ? `scale=${w * 2}:${picH * 2},zoompan=z='min(zoom+0.0006,1.1)':d=${frames}:s=${w}x${picH}:fps=${fps}`
      : `scale=${w}:${picH}`
    const filter = `${motion},${videoBar(w, h, req.durationSec)},format=yuv420p`
    args.push('-vf', filter)
    if (req.withAudio) args.push('-af', 'volume=0.15', '-c:a', 'aac', '-shortest')
    else args.push('-an')
    args.push(...encodeArgs, '-t', String(req.durationSec), '-movflags', '+faststart', out)
    await runFfmpeg(env.bins, args)
    return new Uint8Array(await readFile(out))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
