import type { Asset } from '@dramai/api'

/**
 * 库里的提示词用稳定 id 引用资产：`@{assetId}` / `@{assetId/形态名}`（改名不会破坏引用）。
 * 界面里给人看、给人改的时候换成名字：`@小宫女` / `@小宫女/冬装`，保存时再换回 id。
 */
const MENTION = /@\{([^}/]+)(?:\/([^}]+))?\}/g

export function mentionsToNames(text: string, assets: ReadonlyMap<string, Asset>): string {
  return text.replace(MENTION, (whole, id: string, variant?: string) => {
    const a = assets.get(id)
    return a ? `@${a.name}${variant ? `/${variant}` : ''}` : whole
  })
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function namesToMentions(text: string, assets: ReadonlyMap<string, Asset>): string {
  // 名字长的先换，避免“小宫女”吃掉“小宫女长”
  const list = [...assets.values()].sort((a, b) => b.name.length - a.name.length)
  let out = text
  for (const a of list) {
    const re = new RegExp(`@${escape(a.name)}(?:/([^\\s@，。,.]+))?`, 'g')
    out = out.replace(re, (_w, variant?: string) => `@{${a.id}${variant ? `/${variant}` : ''}}`)
  }
  return out
}
