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
      args.push('-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=${fps}`)
    }
    if (req.withAudio) {
      args.push(
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=330:sample_rate=44100:duration=${req.durationSec}`,
      )
    }
    const filter = req.image
      ? `scale=${w * 2}:${h * 2},zoompan=z='min(zoom+0.0006,1.1)':d=${frames}:s=${w}x${h}:fps=${fps},format=yuv420p`
      : `format=yuv420p`
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
