import { loadFFmpeg } from '@/core/composition/ffmpeg'

export interface ConcatProgress {
  phase: 'loading' | 'transcoding' | 'concatenating' | 'done'
  currentClip?: number
  totalClips?: number
  ratio?: number
  log?: string
}

/**
 * 把多个 mp4 / webm 拼接成一个 mp4，同时把每段统一编码成 H.264/AAC，
 * 避免 concat demuxer 因为编码参数不一致出错。
 *
 * 单线程 ffmpeg.wasm 速度大概 0.2-0.5x 实时，6 个 5 秒视频要等 1-2 分钟。
 */
export async function concatVideos(
  inputs: Array<{ blob: Blob; name: string }>,
  options: {
    outputWidth?: number
    outputHeight?: number
    onProgress?: (p: ConcatProgress) => void
    signal?: AbortSignal
  } = {},
): Promise<Blob> {
  const { outputWidth = 1280, outputHeight = 720, onProgress, signal } = options
  if (inputs.length === 0) throw new Error('没有可拼接的视频')

  onProgress?.({ phase: 'loading' })
  const [ffmpeg, { fetchFile }] = await Promise.all([
    loadFFmpeg((line) =>
      onProgress?.({
        phase: 'transcoding',
        log: line,
      }),
    ),
    import('@ffmpeg/util'),
  ])

  // ffmpeg.wasm 没原生 abort——signal 我们用来在阶段切换时检查
  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  }

  // Step 1: 把每段视频转码成相同参数的中间 mp4
  for (let i = 0; i < inputs.length; i++) {
    checkAbort()
    onProgress?.({
      phase: 'transcoding',
      currentClip: i + 1,
      totalClips: inputs.length,
    })
    const inputName = `in_${i}.bin`
    const outputName = `mid_${i}.mp4`
    const data = await fetchFile(inputs[i].blob)
    await ffmpeg.writeFile(inputName, data)
    await ffmpeg.exec([
      '-i',
      inputName,
      '-vf',
      `scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease,pad=${outputWidth}:${outputHeight}:(ow-iw)/2:(oh-ih)/2:color=black`,
      '-r',
      '24',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-an', // 拼接阶段不带音轨；TTS / 字幕音轨在 v0.5+ 处理
      outputName,
    ])
    await ffmpeg.deleteFile(inputName)
  }

  // Step 2: 写 concat list 文件
  checkAbort()
  onProgress?.({ phase: 'concatenating' })
  const listLines = inputs.map((_, i) => `file 'mid_${i}.mp4'`).join('\n')
  await ffmpeg.writeFile('concat.txt', new TextEncoder().encode(listLines))

  // Step 3: concat demuxer + copy（中间文件已经统一编码，这一步快）
  await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'output.mp4'])

  // Step 4: 读出来 + 清理
  checkAbort()
  const data = await ffmpeg.readFile('output.mp4')
  for (let i = 0; i < inputs.length; i++) {
    try {
      await ffmpeg.deleteFile(`mid_${i}.mp4`)
    } catch {
      /* noop */
    }
  }
  try {
    await ffmpeg.deleteFile('concat.txt')
    await ffmpeg.deleteFile('output.mp4')
  } catch {
    /* noop */
  }

  onProgress?.({ phase: 'done' })

  if (typeof data === 'string') {
    throw new Error('FFmpeg readFile 返回了 string，期望 Uint8Array')
  }
  // 单线程 ffmpeg.wasm 下 buffer 是普通 ArrayBuffer。TS 签名宽，cast 一下；
  // 同时通过 .slice(0) 拷贝出来，避免 Blob 引用整个 wasm heap。
  const copy = data.slice(0)
  return new Blob([copy as Uint8Array<ArrayBuffer>], { type: 'video/mp4' })
}
