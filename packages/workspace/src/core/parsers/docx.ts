import type { ParsedMaterial } from '@/core/parsers'

/**
 * 从 .docx 抽出纯文本内容。
 * 旧版 .doc（OLE）格式 mammoth 不支持，会以错误回退。
 *
 * mammoth 是一个体积较大的依赖（含 jszip 等），只在用户实际上传 docx 时
 * 才动态加载，避免首屏 bundle 爆炸。
 */
export async function parseDocxFile(file: File): Promise<ParsedMaterial> {
  const arrayBuffer = await file.arrayBuffer()
  const mammoth = await import('mammoth')
  let text: string
  try {
    const result = await mammoth.extractRawText({ arrayBuffer })
    text = result.value.trim()
  } catch (err) {
    throw new Error(
      `无法解析文档 ${file.name}：${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  }

  return {
    kind: 'doc',
    name: file.name,
    text,
    blob: file,
    mimeType:
      file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }
}
