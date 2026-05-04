import type { ParsedMaterial } from '@/core/parsers'

/**
 * 读取图片宽高（用 createImageBitmap 比 <img> 更省事 + 无 DOM 副作用）。
 * 文本字段为空 — 图片本身后续会作为 Asset Blob 存进 IndexedDB，
 * 在生成阶段以 multimodal 输入或图生图参考图的形式注入。
 */
export async function parseImageFile(file: File): Promise<ParsedMaterial> {
  let width = 0
  let height = 0
  try {
    const bitmap = await createImageBitmap(file)
    width = bitmap.width
    height = bitmap.height
    bitmap.close()
  } catch {
    // createImageBitmap 不支持的 GIF / 异常文件就降级，不阻断上传
  }

  return {
    kind: 'image',
    name: file.name,
    text: '',
    preview: width && height ? { width, height } : undefined,
    blob: file,
    mimeType: file.type || 'image/*',
  }
}
