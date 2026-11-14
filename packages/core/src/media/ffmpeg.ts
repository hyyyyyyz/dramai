import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { dirname, join, posix, win32 } from 'node:path'

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

/**
 * Every path where `name` could live on `PATH`, in lookup order. On Windows the entries are separated by `;`, the
 * executable carries an extension, and `PATH` may be written `Path`; `platform` is a parameter so the Windows rules can
 * be tested anywhere.
 */
export function pathCandidates(
  name: string,
  pathEnv: string | undefined,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const win = platform === 'win32'
  const api = win ? win32 : posix
  const exts = win ? ['.exe', '.cmd', '.bat', ''] : ['']
  const out: string[] = []
  for (const raw of (pathEnv ?? '').split(api.delimiter)) {
    // Windows allows quoted entries in PATH: "C:\Program Files\ffmpeg\bin"
    const dir = win ? raw.trim().replace(/^"(.*)"$/, '$1') : raw
    if (!dir) continue
    for (const ext of exts) out.push(api.join(dir, name + ext))
  }
  return out
}

async function findOnPath(name: string, pathEnv: string | undefined): Promise<string | undefined> {
  for (const candidate of pathCandidates(name, pathEnv)) {
    if (await isExecutable(candidate)) return candidate
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
  /** The container's duration: the end of its longest stream. */
  durationSec?: number
  /** The video stream's own duration (ffprobe only). */
  videoDurationSec?: number
  /** The audio stream's own duration (ffprobe only). */
  audioDurationSec?: number
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
  const streamSec = (stream: FfprobeStream | undefined): number | undefined => {
    const n = stream?.duration === undefined ? Number.NaN : Number(stream.duration)
    return Number.isFinite(n) ? n : undefined
  }
  return {
    durationSec: duration !== undefined && Number.isFinite(duration) ? duration : undefined,
    videoDurationSec: streamSec(video),
    audioDurationSec: streamSec(audio),
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

/**
 * 一段服务商返回的“音频”能不能当成品。四个结论，**只有 `not_audio` 才拒绝**：
 * - `ok`：探测工具正常运行，是可用的音频（`info` 是探测到的事实）；
 * - `not_audio`（第一档，**确定不是音频**，几乎不可能误判）：探测工具**正常运行**，并且文件根本打不开
 *   （`Invalid data found`、`End of file`、`moov atom not found`…），或者里面没有音频流；`reason` 是工具的原话（一行）。任务失败、不保存；
 * - `flawed`（第二档，**是音频但有问题**，可能误判，所以只提醒不丢弃）：能打开、有音频流，但读不出时长，或者再解码一遍时报了解码错误
 *   （被截断 / 局部损坏的 WAV、FLAC 等）。照常保存、任务成功，另发一条提醒试听的 `job.notice`；`info` 是能读到的事实
 *   （读不出时长就没有时长，和探测工具不可用时一样）；
 * - `unknown`：探测工具不可用、起不来、崩了或输出读不懂——这是本机的问题，不是音频的问题，调用方保持原来的行为（照常保存，不记时长）。
 *
 * 已知看不出来的：被截断的 MP3 仍然是一段合法的、更短的 MP3，没有任何工具能判断它被截断了。
 */
export type AudioInspection =
  | { verdict: 'ok'; info: MediaInfo }
  | { verdict: 'not_audio'; reason: string }
  | { verdict: 'flawed'; info: MediaInfo; reason: string }
  | { verdict: 'unknown' }

/**
 * ffprobe / ffmpeg 对“这个文件的**内容**不是它能认的媒体”的原话——只放格式层面的、不可能由我们自己的处理造成的那几句。
 * 故意**不放**：`Error opening input`（文件不存在、没有权限也会这样说）、`Invalid argument`（参数不对）、`Unsupported codec`
 * （合法音频只是工具不会解），这些落到 `unknown`，不会被判成“确定不是音频”。
 */
const INPUT_ERROR =
  /Invalid data found when processing input|End of file|moov atom not found|could not find codec parameters|no 'data' tag found|Failed to find two consecutive MPEG audio frames/i
/** 说明是我们自己的处理出了问题（文件没写好、目录不可读写）而不是文件内容的问题：一律不算第一档。 */
const OUR_OWN_PROBLEM =
  /No such file or directory|Permission denied|Is a directory|Input\/output error/i
const DECODE_ERROR =
  /Decoding error|Error while decoding|decode_frame\(\) failed|Invalid PCM packet/i

const firstLine = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? ''

export async function inspectAudio(bins: FfmpegBinaries, file: string): Promise<AudioInspection> {
  let info: MediaInfo
  try {
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
        return INPUT_ERROR.test(res.stderr) && !OUR_OWN_PROBLEM.test(res.stderr)
          ? { verdict: 'not_audio', reason: firstLine(res.stderr) }
          : { verdict: 'unknown' }
      }
      info = parseFfprobeJson(res.stdout)
    } else {
      const res = await runProcess(bins.ffmpeg, ['-hide_banner', '-i', file])
      if (
        INPUT_ERROR.test(res.stderr) &&
        !OUR_OWN_PROBLEM.test(res.stderr) &&
        !/Stream #/.test(res.stderr)
      ) {
        return { verdict: 'not_audio', reason: firstLine(res.stderr) }
      }
      info = parseFfmpegBanner(res.stderr)
    }
  } catch {
    return { verdict: 'unknown' } // 起不来 / 输出读不懂：工具的问题
  }
  if (!info.hasAudio) return { verdict: 'not_audio', reason: '文件里没有音频流' }
  // 以下都是“是音频，但有问题”：不拒绝（可能误判），照常保存并提醒
  const goodDuration = info.durationSec !== undefined && info.durationSec > 0
  const noDuration = bins.ffprobe !== undefined && !goodDuration
  const usable: MediaInfo = goodDuration ? info : { ...info, durationSec: undefined }
  // 解码一遍：被截断 / 损坏的数据解码时会报错（退出码仍然是 0，要看错误输出）
  try {
    const dec = await runProcess(bins.ffmpeg, ['-v', 'error', '-i', file, '-f', 'null', '-'])
    if (DECODE_ERROR.test(dec.stderr)) {
      return { verdict: 'flawed', info: usable, reason: firstLine(dec.stderr) }
    }
  } catch {
    // 解码检查本身起不来：不影响结论
  }
  if (noDuration) return { verdict: 'flawed', info: usable, reason: '读不出音频的时长' }
  return { verdict: 'ok', info }
}
