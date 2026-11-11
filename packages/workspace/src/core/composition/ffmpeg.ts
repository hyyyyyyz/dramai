/**
 * FFmpeg.wasm 单线程版加载器（dynamic import）。
 *
 * **不要**直接在顶层 import @ffmpeg/ffmpeg —— 它和 core wasm 加起来 ~30MB，
 * 用户不点合成永远不该下载。loadFFmpeg() 只在第一次合成时触发拉取，并缓存
 * 单例。
 *
 * 关于多线程：浏览器多线程版需要服务器返回 COOP/COEP headers，GitHub Pages
 * 没法设。所以 dramai 强制用单线程版，速度较慢但能跑——6 个 5 秒视频拼接
 * 大约 30 秒 ~ 2 分钟（取决于分辨率和编码复杂度）。
 */

import type { FFmpeg } from '@ffmpeg/ffmpeg'

let cached: Promise<FFmpeg> | null = null

const CDN_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd'

export async function loadFFmpeg(onLog?: (line: string) => void): Promise<FFmpeg> {
  if (cached) return cached
  cached = (async () => {
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
      import('@ffmpeg/ffmpeg'),
      import('@ffmpeg/util'),
    ])
    const ffmpeg = new FFmpeg()
    if (onLog) {
      ffmpeg.on('log', ({ message }) => onLog(message))
    }
    await ffmpeg.load({
      coreURL: await toBlobURL(`${CDN_BASE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CDN_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
    })
    return ffmpeg
  })()
  try {
    return await cached
  } catch (err) {
    cached = null // 加载失败时允许下次重试
    throw err
  }
}

export async function readFFmpegFile(ffmpeg: FFmpeg, path: string): Promise<Blob> {
  const data = await ffmpeg.readFile(path)
  if (typeof data === 'string') {
    return new Blob([data], { type: 'text/plain' })
  }
  // ffmpeg.wasm 单线程模式下 buffer 永远是 ArrayBuffer（非 SharedArrayBuffer），
  // 但 TS 类型签名宽到 ArrayBufferLike，所以 cast 一下。
  return new Blob([data as Uint8Array<ArrayBuffer>], {
    type: 'application/octet-stream',
  })
}
