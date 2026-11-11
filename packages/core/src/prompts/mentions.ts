/**
 * 资产提及（mention）。
 *
 * 库内存的提示词文本里，资产用稳定 id 的占位符表示：`@{assetId}` 或 `@{assetId/变体名}`。
 * 进出大模型时才换成名字：`@名称` / `@名称/变体名`。重命名因此只改资产那一行。
 * 名字不含 "/"，所以变体分隔无歧义。
 */

export interface MentionAsset {
  id: string
  name: string
  aliases?: string[]
}

export interface Mention {
  assetId: string
  variantName?: string
}

const ID_TOKEN = /@\{([^}/]+)(?:\/([^}]+))?\}/g

/** 按首次出现顺序取出文本里的资产提及（去重，按 assetId + variantName）。 */
export function extractMentions(storedText: string): Mention[] {
  const seen = new Set<string>()
  const out: Mention[] = []
  for (const m of storedText.matchAll(ID_TOKEN)) {
    const mention: Mention = { assetId: m[1], variantName: m[2] }
    const key = `${mention.assetId}/${mention.variantName ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(mention)
  }
  return out
}

/** 库内文本 → 给大模型看的文本。未登记的 id 原样保留（由准入检查拦截）。 */
export function renderMentionsForLlm(storedText: string, assets: readonly MentionAsset[]): string {
  const byId = new Map(assets.map((a) => [a.id, a]))
  return storedText.replace(ID_TOKEN, (whole, id: string, variant?: string) => {
    const asset = byId.get(id)
    if (!asset) return whole
    return variant ? `@${asset.name}/${variant}` : `@${asset.name}`
  })
}

/**
 * 大模型写出的文本 → 库内文本。按"已知名字/别名，最长优先"逐个匹配 `@名字`，
 * 不依赖分词（中文名字没有空格）。可选的 `/变体名` 紧跟其后，变体名取到下一个空白或标点。
 */
export function resolveMentionsFromLlm(llmText: string, assets: readonly MentionAsset[]): string {
  const names: Array<{ name: string; id: string }> = []
  for (const a of assets) {
    names.push({ name: a.name, id: a.id })
    for (const alias of a.aliases ?? []) names.push({ name: alias, id: a.id })
  }
  names.sort((x, y) => y.name.length - x.name.length)

  let out = ''
  let i = 0
  while (i < llmText.length) {
    if (llmText[i] !== '@') {
      out += llmText[i]
      i++
      continue
    }
    const rest = llmText.slice(i + 1)
    const hit = names.find((n) => rest.startsWith(n.name))
    if (!hit) {
      out += '@'
      i++
      continue
    }
    let consumed = hit.name.length
    let variant: string | undefined
    if (rest[consumed] === '/') {
      const m = /^\/([^\s,，。.、;；:：!！?？)）\]】"”'’]+)/.exec(rest.slice(consumed))
      if (m) {
        variant = m[1]
        consumed += m[0].length
      }
    }
    out += variant ? `@{${hit.id}/${variant}}` : `@{${hit.id}}`
    i += 1 + consumed
  }
  return out
}
