import type { MaterialKind } from '@/types/domain'
import type { ParsedMaterial } from '@/core/parsers'

/**
 * 解析 txt / md。md 不展开为 HTML，原样保留 — LLM 自己能读懂 markdown 语法，
 * 而且原文里的列表 / 标题对 LLM 抽分镜更友好。
 */
export async function parsePlainTextFile(
  file: File,
  kind: Extract<MaterialKind, 'txt' | 'md'>,
): Promise<ParsedMaterial> {
  const text = (await file.text()).trim()
  return {
    kind,
    name: file.name,
    text,
    blob: file,
    mimeType: file.type || (kind === 'md' ? 'text/markdown' : 'text/plain'),
  }
}
