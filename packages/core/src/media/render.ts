import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AspectRatio } from '../domain/common.ts'
import { probeMedia, requireFeature, runFfmpeg } from './ffmpeg.ts'
import type { FfmpegBinaries, FfmpegCapabilities, MediaInfo } from './ffmpeg.ts'
import { resolveOutputSize } from './output-size.ts'
import { removeRetry, renameRetry } from '../util/fs.ts'

/**
 * 成片渲染原语：规整、拼接、混旁白、字幕。
 *
 * 与 v0.4 的 `concat.ts` 的区别：不再丢音轨（没有音轨的片段补静音，使拼接后音画对齐），
 * 也不再写死 1280×720——画布由项目画幅 + 短边决定（A12：短边 1080）。
 */

export interface RenderEnv {
  bins: FfmpegBinaries
  caps: FfmpegCapabilities
  signal?: AbortSignal
}

function videoEncoderArgs(caps: FfmpegCapabilities): string[] {
  if (caps.videoEncoder === 'h264_videotoolbox') return ['-c:v', 'h264_videotoolbox', '-b:v', '6M']
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21']
}

const AUDIO_ARGS = ['-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2']

export interface NormalizeOptions {
  input: string
  output: string
  aspectRatio: AspectRatio
  /** 画布短边，默认 1080。 */
  shortSide?: number
  fps?: number
  /** 只取源片段的这一段（秒）。 */
  trimInSec?: number
  trimOutSec?: number
  /** 出点帧静帧延长这么多秒（画面定格，声音补静音）。 */
  holdSec?: number
  /** 该片段原声音量（0..1），默认 1。 */
  volume?: number
}

/**
 * 把一个片段规整到项目画幅：缩放留黑边到目标画布、统一帧率/像素格式、统一 AAC 音轨。
 * 输入没有音轨时补一条静音轨。
 */
export async function normalizeClip(env: RenderEnv, opts: NormalizeOptions): Promise<MediaInfo> {
  requireFeature(env.caps, 'h264')
  const { width, height } = resolveOutputSize({
    aspectRatio: opts.aspectRatio,
    resolution: opts.shortSide ?? 1080,
    step: 2,
  })
  const info = await probeMedia(env.bins, opts.input)
  if (!info.hasVideo) throw new Error(`没有视频流：${opts.input}`)
  const fps = opts.fps ?? 24
  const hold = Math.max(0, opts.holdSec ?? 0)
  const vf = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    `fps=${fps}`,
    ...(hold > 0 ? [`tpad=stop_mode=clone:stop_duration=${hold}`] : []),
    'format=yuv420p',
  ].join(',')
  const trimmed = opts.trimInSec !== undefined || opts.trimOutSec !== undefined
  const inArgs: string[] = []
  if (opts.trimInSec !== undefined) inArgs.push('-ss', String(opts.trimInSec))
  if (opts.trimOutSec !== undefined) {
    inArgs.push('-t', String(Math.max(0.04, opts.trimOutSec - (opts.trimInSec ?? 0))))
  }
  const af = [
    ...(opts.volume !== undefined && opts.volume !== 1 ? [`volume=${opts.volume}`] : []),
    ...(hold > 0 ? [`apad=pad_dur=${hold}`] : []),
  ].join(',')

  const args: string[] = [...inArgs, '-i', opts.input]
  if (!info.hasAudio)
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000')
  args.push('-map', '0:v:0', '-map', info.hasAudio ? '0:a:0' : '1:a:0', '-vf', vf)
  if (af) args.push('-af', af)
  args.push(...videoEncoderArgs(env.caps), '-pix_fmt', 'yuv420p', ...AUDIO_ARGS)
  if (!info.hasAudio || trimmed || hold > 0) args.push('-shortest')
  args.push('-movflags', '+faststart', opts.output)
  await runFfmpeg(env.bins, args, { signal: env.signal })
  return probeMedia(env.bins, opts.output)
}

/**
 * One line of a concat-demuxer list. The list format treats a backslash as an escape, so a Windows path
 * (`C:\\Users\\me\\a.mp4`) is written with forward slashes; a single quote is closed, escaped and reopened.
 */
export function concatListEntry(path: string): string {
  return `file '${path.replace(/\\/g, '/').replace(/'/g, `'\\''`)}'`
}

/** 拼接已经规整过（参数一致）的片段，`-c copy`，音轨保留。 */
export async function concatClips(
  env: RenderEnv,
  inputs: string[],
  output: string,
  workDir: string,
): Promise<void> {
  if (inputs.length === 0) throw new Error('没有可拼接的视频')
  const list = inputs.map((p) => concatListEntry(p)).join('\n')
  const listPath = join(workDir, 'concat.txt')
  await writeFile(listPath, list, 'utf8')
  await runFfmpeg(
    env.bins,
    ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', output],
    { signal: env.signal },
  )
}

export interface NarrationTrack {
  path: string
  /** 在成片上的起点（秒）。 */
  startSec: number
  /** 0..n，默认 1。 */
  volume?: number
}

/**
 * 把旁白轨混进成片：原声按 `sourceVolume` 保留，旁白按各自起点叠加，输出长度以成片画面为准。
 * 视频流直接复制，不重编码。
 */
export async function mixNarration(
  env: RenderEnv,
  opts: { input: string; tracks: NarrationTrack[]; output: string; sourceVolume?: number },
): Promise<void> {
  requireFeature(env.caps, 'aac')
  if (opts.tracks.length === 0) throw new Error('没有旁白轨')
  const args: string[] = ['-i', opts.input]
  for (const t of opts.tracks) args.push('-i', t.path)
  const parts: string[] = [`[0:a]volume=${opts.sourceVolume ?? 1}[src]`]
  const labels: string[] = ['[src]']
  opts.tracks.forEach((t, i) => {
    const ms = Math.max(0, Math.round(t.startSec * 1000))
    parts.push(`[${i + 1}:a]aresample=48000,adelay=${ms}|${ms},volume=${t.volume ?? 1}[n${i}]`)
    labels.push(`[n${i}]`)
  })
  parts.push(
    `${labels.join('')}amix=inputs=${labels.length}:duration=first:normalize=0:dropout_transition=0[aout]`,
  )
  args.push(
    '-filter_complex',
    parts.join(';'),
    '-map',
    '0:v:0',
    '-map',
    '[aout]',
    '-c:v',
    'copy',
    ...AUDIO_ARGS,
    '-movflags',
    '+faststart',
    opts.output,
  )
  await runFfmpeg(env.bins, args, { signal: env.signal })
}

export interface MixTrack {
  path: string
  /** 在成片上的起点（秒）。 */
  startSec: number
  volume?: number
  fadeInSec?: number
  /** 淡出时长（秒），淡出结束在这条轨播放结束处。 */
  fadeOutSec?: number
  /** 这条轨在成片上最长播放多久（秒）；超出的截断。 */
  maxSec?: number
}

/**
 * 通用混音：原声按 `sourceVolume` 保留，叠加任意条轨（旁白、配乐），各自起点 / 音量 / 淡入淡出 / 截断。
 * 输出长度以成片画面为准；视频流直接复制。
 */
export async function mixTracks(
  env: RenderEnv,
  opts: { input: string; tracks: MixTrack[]; output: string; sourceVolume?: number },
): Promise<void> {
  requireFeature(env.caps, 'aac')
  if (opts.tracks.length === 0) throw new Error('没有要混入的轨')
  const args: string[] = ['-i', opts.input]
  for (const t of opts.tracks) args.push('-i', t.path)
  const parts: string[] = [`[0:a]volume=${opts.sourceVolume ?? 1}[src]`]
  const labels: string[] = ['[src]']
  opts.tracks.forEach((t, i) => {
    const ms = Math.max(0, Math.round(t.startSec * 1000))
    const chain = ['aresample=48000']
    if (t.maxSec !== undefined)
      chain.push(`atrim=0:${Math.max(0.01, t.maxSec)}`, 'asetpts=PTS-STARTPTS')
    if (t.fadeInSec) chain.push(`afade=t=in:st=0:d=${t.fadeInSec}`)
    if (t.fadeOutSec) {
      const len = t.maxSec ?? t.fadeOutSec
      chain.push(`afade=t=out:st=${Math.max(0, len - t.fadeOutSec)}:d=${t.fadeOutSec}`)
    }
    chain.push(`volume=${t.volume ?? 1}`, `adelay=${ms}|${ms}`)
    parts.push(`[${i + 1}:a]${chain.join(',')}[n${i}]`)
    labels.push(`[n${i}]`)
  })
  parts.push(
    `${labels.join('')}amix=inputs=${labels.length}:duration=first:normalize=0:dropout_transition=0[aout]`,
  )
  args.push(
    '-filter_complex',
    parts.join(';'),
    '-map',
    '0:v:0',
    '-map',
    '[aout]',
    '-c:v',
    'copy',
    ...AUDIO_ARGS,
    '-movflags',
    '+faststart',
    opts.output,
  )
  await runFfmpeg(env.bins, args, { signal: env.signal })
}

/** 转义 ffmpeg 滤镜参数里的路径（冒号、反斜杠、引号、逗号、方括号、分号）。 */
export function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/[:',[\];]/g, (c) => `\\${c}`)
}

/**
 * 滤镜里的文件路径：Windows 路径（`C:\Users\me\a.srt`）统一写成正斜杠（`C:/Users/me/a.srt`）再转义。
 * 反斜杠在“滤镜图”和“选项值”两层转义里都有特殊含义，正斜杠 Windows 的 ffmpeg 同样认，只剩盘符的冒号需要转义。
 */
export function filterPath(path: string): string {
  return escapeFilterValue(path.replace(/\\/g, '/'))
}

export interface SubtitleStyle {
  fontName?: string
  /** libass 脚本坐标下的字号（默认画布 288 高）。 */
  fontSize?: number
  marginV?: number
  outline?: number
}

export function buildSubtitlesFilter(
  srtPath: string,
  fontsDir?: string,
  style: SubtitleStyle = {},
): string {
  const force = [
    style.fontName ? `FontName=${style.fontName}` : undefined,
    `FontSize=${style.fontSize ?? 14}`,
    'Alignment=2',
    `MarginV=${style.marginV ?? 18}`,
    `Outline=${style.outline ?? 1.5}`,
    'PrimaryColour=&H00FFFFFF',
    'OutlineColour=&H00000000',
  ]
    .filter(Boolean)
    .join(',')
  const parts = [`filename='${filterPath(srtPath)}'`]
  if (fontsDir) parts.push(`fontsdir='${filterPath(fontsDir)}'`)
  parts.push(`force_style='${escapeFilterValue(force)}'`)
  return `subtitles=${parts.join(':')}`
}

/** 把字幕烧进画面。需要 libass；没有就抛带补救建议的 MediaCapabilityError，不静默跳过。 */
export async function burnSubtitles(
  env: RenderEnv,
  opts: {
    input: string
    srtPath: string
    output: string
    fontsDir?: string
    style?: SubtitleStyle
  },
): Promise<void> {
  requireFeature(env.caps, 'subtitleBurnIn')
  const vf = buildSubtitlesFilter(opts.srtPath, opts.fontsDir, opts.style)
  await runFfmpeg(
    env.bins,
    [
      '-i',
      opts.input,
      '-vf',
      vf,
      ...videoEncoderArgs(env.caps),
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
      opts.output,
    ],
    { signal: env.signal },
  )
}

/** 软字幕：把字幕作为 mov_text 轨嵌进 mp4，播放器可开关。不需要 libass。 */
export async function embedSoftSubtitles(
  env: RenderEnv,
  opts: { input: string; srtPath: string; output: string; language?: string },
): Promise<void> {
  await runFfmpeg(
    env.bins,
    [
      '-i',
      opts.input,
      '-i',
      opts.srtPath,
      '-map',
      '0',
      '-map',
      '1:0',
      '-c',
      'copy',
      '-c:s',
      'mov_text',
      '-metadata:s:s:0',
      `language=${opts.language ?? 'chi'}`,
      '-movflags',
      '+faststart',
      opts.output,
    ],
    { signal: env.signal },
  )
}

export type SubtitleMode = 'burn' | 'soft' | 'none'

export interface ComposeOptions {
  clips: string[]
  aspectRatio: AspectRatio
  output: string
  shortSide?: number
  fps?: number
  narration?: NarrationTrack[]
  /** 片段原声音量，默认 1。 */
  sourceVolume?: number
  subtitles?: { srtPath: string; mode: SubtitleMode; fontsDir?: string; style?: SubtitleStyle }
  /** 临时目录；缺省时自建并在结束后清理。 */
  workDir?: string
  onProgress?: (p: ComposeProgress) => void
}

export interface ComposeProgress {
  phase: 'normalizing' | 'concatenating' | 'mixing' | 'subtitles' | 'done'
  index?: number
  total?: number
}

export interface ComposeResult {
  output: string
  info: MediaInfo
  subtitleMode: SubtitleMode
}

/**
 * 顺序拼接成片：规整每个片段 → 拼接 →（混旁白）→（字幕）。
 * 字幕请求 burn 但 ffmpeg 没有 libass 时抛错，由调用方决定是否改用 soft——这里不替用户做降级。
 */
export async function composeSequence(
  env: RenderEnv,
  opts: ComposeOptions,
): Promise<ComposeResult> {
  if (opts.clips.length === 0) throw new Error('没有可拼接的视频')
  if (opts.subtitles?.mode === 'burn') requireFeature(env.caps, 'subtitleBurnIn')

  const ownsDir = !opts.workDir
  const dir = opts.workDir ?? (await mkdtemp(join(tmpdir(), 'dramai-compose-')))
  await mkdir(dir, { recursive: true })
  try {
    const normalized: string[] = []
    for (let i = 0; i < opts.clips.length; i++) {
      opts.onProgress?.({ phase: 'normalizing', index: i + 1, total: opts.clips.length })
      const out = join(dir, `clip_${i}.mp4`)
      await normalizeClip(env, {
        input: opts.clips[i],
        output: out,
        aspectRatio: opts.aspectRatio,
        shortSide: opts.shortSide,
        fps: opts.fps,
      })
      normalized.push(out)
    }

    opts.onProgress?.({ phase: 'concatenating' })
    let current = join(dir, 'concat.mp4')
    await concatClips(env, normalized, current, dir)

    if (opts.narration && opts.narration.length > 0) {
      opts.onProgress?.({ phase: 'mixing' })
      const mixed = join(dir, 'mixed.mp4')
      await mixNarration(env, {
        input: current,
        tracks: opts.narration,
        output: mixed,
        sourceVolume: opts.sourceVolume,
      })
      current = mixed
    }

    let subtitleMode: SubtitleMode = 'none'
    if (opts.subtitles && opts.subtitles.mode !== 'none') {
      opts.onProgress?.({ phase: 'subtitles' })
      const subbed = join(dir, 'subbed.mp4')
      if (opts.subtitles.mode === 'burn') {
        await burnSubtitles(env, {
          input: current,
          srtPath: opts.subtitles.srtPath,
          output: subbed,
          fontsDir: opts.subtitles.fontsDir,
          style: opts.subtitles.style,
        })
      } else {
        await embedSoftSubtitles(env, {
          input: current,
          srtPath: opts.subtitles.srtPath,
          output: subbed,
        })
      }
      current = subbed
      subtitleMode = opts.subtitles.mode
    }

    await mkdir(dirname(opts.output), { recursive: true })
    try {
      await renameRetry(current, opts.output)
    } catch {
      await copyFile(current, opts.output)
    }
    opts.onProgress?.({ phase: 'done' })
    return { output: opts.output, info: await probeMedia(env.bins, opts.output), subtitleMode }
  } finally {
    if (ownsDir) await removeRetry(dir)
  }
}
