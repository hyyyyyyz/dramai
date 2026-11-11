import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runFfmpeg } from './ffmpeg.ts'
import type { FfmpegBinaries } from './ffmpeg.ts'

/**
 * 参考图压缩（A3，ArcReel ADR 0012）。
 *
 * 在所有生成的唯一汇流点，对"上传副本"做压缩（源文件和产物不动）：
 * - 总请求 ≤ 8MB、单图 ≤ 4MB（保守通用上限，可按服务商覆盖）；
 * - JPEG、4:4:4；先降分辨率（长边 ≤ 2048），再降质量（下限 q80）；
 * - 被动捕获 HTTP 413 → 降一档重试（`startTier`）；
 * - 单张首/尾帧只在超字节时重编码，**永不缩尺寸**（保护 i2v 首帧）。
 *
 * 与规格的差异：规格写"统一 JPEG q92"。这里在预算之内的参考图原样放行（避免无谓的二次有损），
 * 只有超预算、超尺寸时才重编码；一旦进入更严的档位（总量超限），所有参考图统一重编码。
 */

export interface CompressionLimits {
  maxTotalBytes: number
  maxImageBytes: number
  maxLongSide: number
  startQuality: number
  minQuality: number
}

export const DEFAULT_COMPRESSION_LIMITS: CompressionLimits = {
  maxTotalBytes: 8 * 1024 * 1024,
  maxImageBytes: 4 * 1024 * 1024,
  maxLongSide: 2048,
  startQuality: 92,
  minQuality: 80,
}

export interface CompressionTier {
  longSide: number
  quality: number
}

/** 先降分辨率档位前先降质量到下限：(2048,92) → (2048,86) → (2048,80) → (1536,80) → (1024,80) → (768,80)。 */
export function compressionTiers(
  limits: CompressionLimits = DEFAULT_COMPRESSION_LIMITS,
): CompressionTier[] {
  const mid = Math.round((limits.startQuality + limits.minQuality) / 2)
  const tiers: CompressionTier[] = [
    { longSide: limits.maxLongSide, quality: limits.startQuality },
    { longSide: limits.maxLongSide, quality: mid },
    { longSide: limits.maxLongSide, quality: limits.minQuality },
  ]
  for (const side of [1536, 1024, 768]) {
    if (side < limits.maxLongSide) tiers.push({ longSide: side, quality: limits.minQuality })
  }
  return tiers
}

export interface ReferenceImageInput {
  id: string
  bytes: Uint8Array
  mime: string
  width?: number
  height?: number
  /** frame：单张首/尾帧，永不缩尺寸。reference：普通参考图。 */
  role?: 'frame' | 'reference'
}

export interface ReferenceImageOutput {
  id: string
  bytes: Uint8Array
  mime: string
  reencoded: boolean
}

export type ImageEncoder = (
  input: ReferenceImageInput,
  options: { quality: number; maxLongSide?: number },
) => Promise<{ bytes: Uint8Array; mime: string }>

export class ReferenceTooLargeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReferenceTooLargeError'
  }
}

export interface FitResult {
  images: ReferenceImageOutput[]
  /** 实际使用的档位下标，413 重试时作为 `startTier + 1` 传回。 */
  tier: number
  totalBytes: number
}

export async function fitReferenceImages(
  inputs: ReferenceImageInput[],
  encode: ImageEncoder,
  options: { limits?: CompressionLimits; startTier?: number } = {},
): Promise<FitResult> {
  const limits = options.limits ?? DEFAULT_COMPRESSION_LIMITS
  const tiers = compressionTiers(limits)
  const startTier = options.startTier ?? 0
  if (startTier >= tiers.length) {
    throw new ReferenceTooLargeError('参考图已经压到最低档位仍被服务商拒绝（413）')
  }

  for (let t = startTier; t < tiers.length; t++) {
    const tier = tiers[t]
    const images: ReferenceImageOutput[] = []
    for (const input of inputs) {
      images.push(await fitOne(input, tier, t > 0 || startTier > 0, encode, limits))
    }
    const total = images.reduce((sum, i) => sum + i.bytes.byteLength, 0)
    const overImage = images.some((i) => i.bytes.byteLength > limits.maxImageBytes)
    if (total <= limits.maxTotalBytes && !overImage) {
      return { images, tier: t, totalBytes: total }
    }
  }
  throw new ReferenceTooLargeError(
    `参考图压到最低档位后仍超限（上限：总计 ${limits.maxTotalBytes} 字节，单张 ${limits.maxImageBytes} 字节）`,
  )
}

async function fitOne(
  input: ReferenceImageInput,
  tier: CompressionTier,
  forceEncode: boolean,
  encode: ImageEncoder,
  limits: CompressionLimits,
): Promise<ReferenceImageOutput> {
  const bytes = input.bytes.byteLength
  const isFrame = input.role === 'frame'
  const longSide = Math.max(input.width ?? 0, input.height ?? 0)

  if (isFrame) {
    // 首/尾帧：只在超字节时重编码，且不缩尺寸。
    if (bytes <= limits.maxImageBytes && !forceEncode) {
      return { id: input.id, bytes: input.bytes, mime: input.mime, reencoded: false }
    }
    if (bytes <= limits.maxImageBytes && forceEncode) {
      // 413 重试时帧也需要变小，但仍不缩尺寸，只降质量。
    }
    const out = await encode(input, { quality: tier.quality })
    return { id: input.id, bytes: out.bytes, mime: out.mime, reencoded: true }
  }

  const needsResize = longSide > tier.longSide
  if (!forceEncode && !needsResize && bytes <= limits.maxImageBytes) {
    return { id: input.id, bytes: input.bytes, mime: input.mime, reencoded: false }
  }
  const out = await encode(input, { quality: tier.quality, maxLongSide: tier.longSide })
  return { id: input.id, bytes: out.bytes, mime: out.mime, reencoded: true }
}

/** 用 ffmpeg 做 JPEG 4:4:4 编码；`maxLongSide` 缺省时不缩放。 */
export function createFfmpegImageEncoder(bins: Pick<FfmpegBinaries, 'ffmpeg'>): ImageEncoder {
  return async (input, options) => {
    const dir = await mkdtemp(join(tmpdir(), 'dramai-img-'))
    try {
      const src = join(dir, 'in')
      const dst = join(dir, 'out.jpg')
      await writeFile(src, input.bytes)
      const L = options.maxLongSide
      const filters: string[] = []
      if (L) {
        // 只缩不放；保持比例。
        filters.push(`scale='if(gt(iw,ih),min(${L},iw),-1)':'if(gt(iw,ih),-1,min(${L},ih))'`)
      }
      const args = ['-i', src]
      if (filters.length > 0) args.push('-vf', filters.join(','))
      args.push(
        '-frames:v',
        '1',
        '-q:v',
        String(jpegQualityToQscale(options.quality)),
        '-pix_fmt',
        'yuvj444p',
        dst,
      )
      await runFfmpeg(bins, args)
      return { bytes: new Uint8Array(await readFile(dst)), mime: 'image/jpeg' }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
}

/** JPEG 质量百分数 → ffmpeg mjpeg 的 qscale（2 最好 … 31 最差）。 */
export function jpegQualityToQscale(quality: number): number {
  const q = Math.min(100, Math.max(1, quality))
  return Math.min(31, Math.max(2, Math.round(2 + (100 - q) * 0.3)))
}
