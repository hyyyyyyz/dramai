import { aspectParts } from '../domain/common.ts'
import type { AspectRatio } from '../domain/common.ts'

/**
 * 输出尺寸规则（A3，ArcReel ADR 0011）。
 *
 * - 画幅比例由项目 `aspectRatio` 唯一决定、永远优先；"分辨率"只决定清晰度。
 * - 分辨率统一规范化成**短边**：档位名查表；用户填 `1920x1080` 取 `min=1080` 并丢掉它自带的比例；
 *   纯数字当短边；没填兜底 720。
 * - 合法尺寸 = (aw·k·t, ah·k·t)，aw:ah 是约简后的比例，k 是该模型要求的整除步长，t 是正整数：
 *   比例零误差，且宽高都能被 k 整除。
 * - 再按各后端的最长边/总像素上限夹取（减小 t）。
 * - 官方有总像素**下限**的模型（模型画像的 `minPixels`）：t 不够就增大，直到面积达到下限；
 *   仍保持比例、仍是步长 k 的整数倍；下限和上限互相矛盾时报 `OutputSizeError`，不发出会被拒绝的尺寸。
 *   这是所有按像素出图的协议共用的唯一入口（Seedream 的协议内放大只作为没有画像时的兜底）。
 */

export const RESOLUTION_TIERS: Record<string, number> = {
  '360p': 360,
  '480p': 480,
  '540p': 540,
  '720p': 720,
  '1k': 1024,
  '1080p': 1080,
  '1440p': 1440,
  '2k': 1440,
  '2160p': 2160,
  '4k': 2160,
}

export const DEFAULT_SHORT_SIDE = 720

export function normalizeShortSide(resolution?: string | number): number {
  if (resolution === undefined || resolution === null) return DEFAULT_SHORT_SIDE
  if (typeof resolution === 'number') {
    return Number.isFinite(resolution) && resolution > 0
      ? Math.round(resolution)
      : DEFAULT_SHORT_SIDE
  }
  const text = resolution.trim().toLowerCase()
  if (!text || text === 'none') return DEFAULT_SHORT_SIDE
  if (text in RESOLUTION_TIERS) return RESOLUTION_TIERS[text]
  const wh = /^(\d+)\s*[x×*]\s*(\d+)$/.exec(text)
  if (wh) return Math.min(Number(wh[1]), Number(wh[2]))
  const num = /^(\d+)p?$/.exec(text)
  if (num) return Number(num[1])
  return DEFAULT_SHORT_SIDE
}

export class OutputSizeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutputSizeError'
  }
}

export interface OutputSizeInput {
  aspectRatio: AspectRatio
  /** 档位名 / "1920x1080" / 短边像素数；缺省 720。 */
  resolution?: string | number
  /** 模型要求的整除步长 k，默认 2（H.264 yuv420p 的底线）。 */
  step?: number
  maxLongSide?: number
  maxPixels?: number
  /** 总像素下限；缺省不限。 */
  minPixels?: number
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

export function resolveOutputSize(input: OutputSizeInput): { width: number; height: number } {
  const k = input.step ?? 2
  const { w: rw, h: rh } = aspectParts(input.aspectRatio)
  const g = gcd(rw, rh)
  const aw = rw / g
  const ah = rh / g
  const shortSide = normalizeShortSide(input.resolution)
  const unit = Math.min(aw, ah) * k
  // 面积 = aw·ah·k²·t²：满足下限的最小 t
  const tMin = input.minPixels
    ? Math.max(1, Math.ceil(Math.sqrt(input.minPixels / (aw * ah * k * k))))
    : 1
  let t = Math.max(tMin, Math.round(shortSide / unit))
  const dims = (tt: number) => ({ width: aw * k * tt, height: ah * k * tt })
  const fits = (tt: number) => {
    const { width, height } = dims(tt)
    if (input.maxLongSide && Math.max(width, height) > input.maxLongSide) return false
    if (input.maxPixels && width * height > input.maxPixels) return false
    return true
  }
  while (t > tMin && !fits(t)) t--
  if (!fits(t)) {
    throw new OutputSizeError(
      `no valid size for ${input.aspectRatio} at step ${k} within the backend limits (minPixels=${input.minPixels ?? '-'}, maxLongSide=${input.maxLongSide ?? '-'}, maxPixels=${input.maxPixels ?? '-'})`,
    )
  }
  return dims(t)
}

/**
 * 没有模型画像时的兜底：尺寸低于总像素下限就按比例放大（宽高各取 2 的倍数）。
 * 有画像的模型走 `resolveOutputSize({ minPixels })`，不会走到这里。
 */
export function scaleUpToMinPixels(
  size: { width: number; height: number },
  minPixels: number,
): { width: number; height: number } {
  const { width, height } = size
  if (width * height >= minPixels) return size
  const k = Math.sqrt(minPixels / (width * height))
  return { width: Math.ceil((width * k) / 2) * 2, height: Math.ceil((height * k) / 2) * 2 }
}
