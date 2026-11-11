import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'

/**
 * 原生 ffmpeg 封装（A12）：定位、探测能力（而不只是"存不存在"）、运行。
 * 不引入 fluent-ffmpeg（仓库已归档），直接 spawn。
 */

export interface FfmpegBinaries {
  ffmpeg: string
  ffprobe?: string
  /** 来自哪里：显式选项 > 环境变量 DRAMAI_FFMPEG > PATH。 */
  source: 'option' | 'env' | 'path'
}

export class FfmpegNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FfmpegNotFoundError'
  }
}

export class FfmpegError extends Error {
  readonly exitCode: number | null
  readonly stderrTail: string
  constructor(message: string, exitCode: number | null, stderrTail: string) {
    super(message)
    this.name = 'FfmpegError'
    this.exitCode = exitCode
    this.stderrTail = stderrTail
  }
}

export class MediaCapabilityError extends Error {
  readonly feature: string
  constructor(feature: string, message: string) {
    super(message)
    this.name = 'MediaCapabilityError'
    this.feature = feature
  }
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function findOnPath(name: string, pathEnv: string | undefined): Promise<string | undefined> {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']
  for (const dir of (pathEnv ?? '').split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, name + ext)
      if (await isExecutable(candidate)) return candidate
    }
  }
  return undefined
}

export interface LocateOptions {
  /** 显式路径（最高优先级）。给了但不可执行 → 报错，不回退。 */
  ffmpegPath?: string
  ffprobePath?: string
  env?: Record<string, string | undefined>
}

/** 按 显式选项 → 环境变量 DRAMAI_FFMPEG → PATH 的顺序定位。 */
export async function locateFfmpeg(options: LocateOptions = {}): Promise<FfmpegBinaries> {
  const env = options.env ?? process.env
  let ffmpeg: string | undefined
  let source: FfmpegBinaries['source'] = 'path'
  if (options.ffmpegPath) {
    if (!(await isExecutable(options.ffmpegPath))) {
      throw new FfmpegNotFoundError(`指定的 ffmpeg 不存在或不可执行：${options.ffmpegPath}`)
    }
    ffmpeg = options.ffmpegPath
    source = 'option'
  } else if (env.DRAMAI_FFMPEG) {
    if (!(await isExecutable(env.DRAMAI_FFMPEG))) {
      throw new FfmpegNotFoundError(
        `DRAMAI_FFMPEG 指向的文件不存在或不可执行：${env.DRAMAI_FFMPEG}`,
      )
    }
    ffmpeg = env.DRAMAI_FFMPEG
    source = 'env'
  } else {
    ffmpeg = await findOnPath('ffmpeg', env.PATH)
    if (!ffmpeg) {
      throw new FfmpegNotFoundError(
        '找不到 ffmpeg。请安装 ffmpeg 并放进 PATH，或通过 DRAMAI_FFMPEG 环境变量 / 启动选项指定路径。',
      )
    }
  }
  let ffprobe: string | undefined
  if (options.ffprobePath) ffprobe = options.ffprobePath
  else if (env.DRAMAI_FFPROBE) ffprobe = env.DRAMAI_FFPROBE
  else {
    const sibling = join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
    ffprobe = (await isExecutable(sibling)) ? sibling : await findOnPath('ffprobe', env.PATH)
  }
  return { ffmpeg, ffprobe, source }
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** 跑一个子进程并收集输出。被 signal 中止时杀进程并抛 AbortError。 */
export function runProcess(
  command: string,
  args: string[],
  options: { signal?: AbortSignal; onStdoutLine?: (line: string) => void } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(abortError())
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let lineBuf = ''
    child.stdout.on('data', (d: Buffer) => {
      const text = d.toString('utf8')
      stdout += text
      if (options.onStdoutLine) {
        lineBuf += text
        const lines = lineBuf.split('\n')
        lineBuf = lines.pop() ?? ''
        for (const l of lines) options.onStdoutLine(l.trim())
      }
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000)
    })
    const onAbort = () => {
      child.kill('SIGKILL')
      reject(abortError())
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (err) => {
      options.signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', onAbort)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

function abortError(): Error {
  const e = new Error('已取消')
  e.name = 'AbortError'
  return e
}

export interface RunFfmpegOptions {
  signal?: AbortSignal
  /** 已处理的输出时间（秒）。需要总时长才能折算比例。 */
  onProgress?: (processedSec: number) => void
}

/** 运行 ffmpeg；退出码非 0 抛 FfmpegError（带 stderr 尾部）。 */
export async function runFfmpeg(
  bins: Pick<FfmpegBinaries, 'ffmpeg'>,
  args: string[],
  options: RunFfmpegOptions = {},
): Promise<RunResult> {
  const full = ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', ...args]
  const result = await runProcess(bins.ffmpeg, full, {
    signal: options.signal,
    onStdoutLine: options.onProgress
      ? (line) => {
          const m = /^out_time_(?:us|ms)=(\d+)/.exec(line)
          if (m) options.onProgress!(Number(m[1]) / 1_000_000)
        }
      : undefined,
  })
  if (result.code !== 0) {
    const tail = result.stderr.trim().split('\n').slice(-12).join('\n')
    throw new FfmpegError(`ffmpeg 退出码 ${result.code}\n${tail}`, result.code, tail)
  }
  return result
}

// === 能力探测 ===

export type MediaFeature =
  | 'h264'
  | 'aac'
  | 'baseFilters'
  | 'subtitleBurnIn'
  | 'transitions'
  | 'loudness'
  | 'probe'

export interface FfmpegCapabilities {
  version: string
  /** 选中的 H.264 编码器（libx264 优先，其次 macOS 硬件编码）。 */
  videoEncoder?: 'libx264' | 'h264_videotoolbox'
  features: Record<MediaFeature, boolean>
  /** 缺什么、为什么、怎么办——给 UI/CLI 原样展示。 */
  missing: Array<{ feature: MediaFeature; required: boolean; reason: string; remedy: string }>
  /** 基础合成（拼接 + 混音）所需的必要能力都在。 */
  ok: boolean
}

export async function probeCapabilities(bins: FfmpegBinaries): Promise<FfmpegCapabilities> {
  const [ver, enc, fil] = await Promise.all([
    runProcess(bins.ffmpeg, ['-hide_banner', '-version']),
    runProcess(bins.ffmpeg, ['-hide_banner', '-encoders']),
    runProcess(bins.ffmpeg, ['-hide_banner', '-filters']),
  ])
  const version = /ffmpeg version (\S+)/.exec(ver.stdout)?.[1] ?? 'unknown'
  const encoders = new Set([...enc.stdout.matchAll(/^\s*[VAS][.\w]{5}\s+(\S+)/gm)].map((m) => m[1]))
  // 滤镜表的标志列是 2–3 个字符（T=时间线 S=切片线程 C=命令），旧版本 3 个，新版本 2 个。
  const filters = new Set([...fil.stdout.matchAll(/^\s*[TSC.]{2,3}\s+(\S+)\s/gm)].map((m) => m[1]))

  const videoEncoder = encoders.has('libx264')
    ? 'libx264'
    : encoders.has('h264_videotoolbox')
      ? 'h264_videotoolbox'
      : undefined
  const base = ['scale', 'pad', 'amix', 'adelay', 'aresample', 'concat']
  const missingFilters = base.filter((f) => !filters.has(f))
  const features: Record<MediaFeature, boolean> = {
    h264: videoEncoder !== undefined,
    aac: encoders.has('aac'),
    baseFilters: missingFilters.length === 0,
    subtitleBurnIn: filters.has('subtitles'),
    transitions: filters.has('xfade'),
    loudness: filters.has('ebur128'),
    probe: bins.ffprobe !== undefined,
  }
  const missing: FfmpegCapabilities['missing'] = []
  if (!features.h264) {
    missing.push({
      feature: 'h264',
      required: true,
      reason: '这个 ffmpeg 没有 H.264 编码器（libx264）',
      remedy: '换用带 libx264 的构建（例如官方静态构建，或 brew install ffmpeg）。',
    })
  }
  if (!features.aac) {
    missing.push({
      feature: 'aac',
      required: true,
      reason: '这个 ffmpeg 没有 AAC 编码器',
      remedy: '换用带 AAC 编码器的构建。',
    })
  }
  if (missingFilters.length > 0) {
    missing.push({
      feature: 'baseFilters',
      required: true,
      reason: `缺少基础滤镜：${missingFilters.join(', ')}`,
      remedy: '换用完整构建的 ffmpeg。',
    })
  }
  if (!features.subtitleBurnIn) {
    missing.push({
      feature: 'subtitleBurnIn',
      required: false,
      reason: '没有 subtitles 滤镜（ffmpeg 未启用 libass），无法把字幕烧进画面',
      remedy:
        '换用带 libass 的构建（官方静态构建、jellyfin-ffmpeg，或 Homebrew 的 homebrew-ffmpeg/ffmpeg tap）；或改用“软字幕”（mov_text 字幕轨）/ 只导出 SRT。',
    })
  }
  if (!features.transitions) {
    missing.push({
      feature: 'transitions',
      required: false,
      reason: '没有 xfade 滤镜，无法做转场',
      remedy: '升级到 ffmpeg 4.3 以上。',
    })
  }
  if (!features.loudness) {
    missing.push({
      feature: 'loudness',
      required: false,
      reason: '没有 ebur128 滤镜，无法测响度',
      remedy: '换用完整构建的 ffmpeg。',
    })
  }
  if (!features.probe) {
    missing.push({
      feature: 'probe',
      required: false,
      reason: '找不到 ffprobe，媒体信息改用解析 ffmpeg 输出的方式获取（较不稳）',
      remedy: '安装 ffprobe（通常随 ffmpeg 一起提供）。',
    })
  }
  return {
    version,
    videoEncoder,
    features,
    missing,
    ok: missing.every((m) => !m.required),
  }
}

export function requireFeature(caps: FfmpegCapabilities, feature: MediaFeature): void {
  if (caps.features[feature]) return
  const m = caps.missing.find((x) => x.feature === feature)
  throw new MediaCapabilityError(
    feature,
    `${m?.reason ?? `ffmpeg 缺少能力：${feature}`}。${m?.remedy ?? ''}`.trim(),
  )
}

// === 媒体信息 ===

export interface MediaInfo {
  durationSec?: number
  hasVideo: boolean
  hasAudio: boolean
  width?: number
  height?: number
  fps?: number
  videoCodec?: string
  audioCodec?: string
}

export async function probeMedia(bins: FfmpegBinaries, file: string): Promise<MediaInfo> {
  if (bins.ffprobe) {
    const res = await runProcess(bins.ffprobe, [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      file,
    ])
    if (res.code !== 0) {
      throw new FfmpegError(
        `ffprobe 失败：${file}`,
        res.code,
        res.stderr.trim().split('\n').slice(-6).join('\n'),
      )
    }
    return parseFfprobeJson(res.stdout)
  }
  const res = await runProcess(bins.ffmpeg, ['-hide_banner', '-i', file])
  return parseFfmpegBanner(res.stderr)
}

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  duration?: string
}

export function parseFfprobeJson(json: string): MediaInfo {
  const data = JSON.parse(json) as { streams?: FfprobeStream[]; format?: { duration?: string } }
  const streams = data.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video')
  const audio = streams.find((s) => s.codec_type === 'audio')
  const durationRaw = data.format?.duration ?? video?.duration ?? audio?.duration
  const duration = durationRaw !== undefined ? Number(durationRaw) : undefined
  let fps: number | undefined
  const fr = video?.avg_frame_rate
  if (fr && fr.includes('/')) {
    const [n, d] = fr.split('/').map(Number)
    if (d) fps = n / d
  }
  return {
    durationSec: duration !== undefined && Number.isFinite(duration) ? duration : undefined,
    hasVideo: video !== undefined,
    hasAudio: audio !== undefined,
    width: video?.width,
    height: video?.height,
    fps: fps && Number.isFinite(fps) ? fps : undefined,
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
  }
}

export function parseFfmpegBanner(stderr: string): MediaInfo {
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  const durationSec = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : undefined
  const videoLine = /Stream #\S+.*?: Video: ([^\s,]+).*?,\s*(\d{2,5})x(\d{2,5})/.exec(stderr)
  const audioLine = /Stream #\S+.*?: Audio: ([^\s,]+)/.exec(stderr)
  const fps = /(\d+(?:\.\d+)?)\s*fps/.exec(stderr)
  return {
    durationSec,
    hasVideo: videoLine !== null,
    hasAudio: audioLine !== null,
    width: videoLine ? Number(videoLine[2]) : undefined,
    height: videoLine ? Number(videoLine[3]) : undefined,
    fps: fps ? Number(fps[1]) : undefined,
    videoCodec: videoLine?.[1],
    audioCodec: audioLine?.[1],
  }
}
