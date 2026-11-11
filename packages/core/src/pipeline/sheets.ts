import type { AspectRatio } from '../domain/common.ts'
import type { Asset, AssetKind } from '../domain/asset.ts'
import type { StyleSnapshot } from '../domain/project.ts'
import type { PromptLibrary } from '../prompts/library.ts'
import type { ModelCapability } from '../providers/types.ts'
import { maxRefImagesOf } from '../providers/catalog.ts'

/**
 * 设定图（A3 第 1 层）：后续所有生成都以它为条件。
 *
 * 版式（角色）有两种，按“使用这张图的下游模型”的参考图上限来选：
 * - `multi_view`：一张图里并排画正脸特写 + 正面 / 侧面 / 背面全身。一张图带全了信息，同一张脸由构图保证一致。
 * - `per_angle`：逐角度单图（正面、侧面、背面各一张）。`sheet` 是正面图，其余在 `sheetViews`。
 *
 * 为什么要选：没有哪家图像厂商推荐把同一主体的多视图排进一张图。参考图上限只有 1 的下游模型如果收到
 * 三格拼贴图，可能会把拼贴本身画出来；这时给它一张干净的正面图更稳。反过来，如果生成设定图的模型自己
 * 都不能以图生图（侧面 / 背面没法以正面为参考），逐角度的三张之间就保证不了一致，宁可用一张多视图。
 * 地点、道具、服装只有一种版式（`single`）。
 */
export type SheetLayout = 'multi_view' | 'per_angle' | 'single'

export function chooseSheetLayout(input: {
  kind: AssetKind
  /** 生成设定图的图像模型能力。 */
  imageModel: ModelCapability
  /** 下游（分镜图）模型的参考图上限；未知传 undefined。 */
  consumerMaxRefImages?: number
}): SheetLayout {
  if (input.kind !== 'character') return 'single'
  const canEditOwnSheet =
    input.imageModel.modes.i2i === 'supported' || input.imageModel.modes.i2i === 'unverified'
  if (
    input.consumerMaxRefImages !== undefined &&
    input.consumerMaxRefImages <= 1 &&
    canEditOwnSheet
  ) {
    return 'per_angle'
  }
  return 'multi_view'
}

/** 设定图的画幅（显式传给模型）：多视图是宽图，逐角度是竖图，道具服装方图。 */
export function sheetAspect(kind: AssetKind, layout: SheetLayout): AspectRatio {
  if (kind === 'character') return layout === 'per_angle' ? '9:16' : '16:9'
  if (kind === 'location') return '16:9'
  return '1:1'
}

export type SheetView = 'front' | 'side' | 'back'
const VIEW_NAME: Record<SheetView, string> = { front: '正面', side: '90 度侧面', back: '背面' }

export function buildSheetPrompt(
  prompts: PromptLibrary,
  asset: Pick<Asset, 'kind' | 'name' | 'appearance' | 'styling' | 'description' | 'originals'>,
  style: Pick<StyleSnapshot, 'imageKeywords'>,
  layout: SheetLayout,
  view: SheetView = 'front',
): string {
  const appearance = [asset.appearance, asset.styling, asset.description].filter(Boolean).join('；')
  return prompts.render(`assets.sheet.${asset.kind}`, {
    name: asset.name,
    appearance,
    styleKeywords: style.imageKeywords,
    multiView: layout === 'multi_view',
    viewName: VIEW_NAME[view],
    originalsHint: asset.originals.length > 0,
    wantsExclusion: asset.kind === 'character',
  })
}

export function buildVariantEditPrompt(
  prompts: PromptLibrary,
  instruction: string,
  hasCostumeRef: boolean,
): string {
  return prompts.render('assets.variant.edit', { instruction, hasCostumeRef })
}

/** 设定图上限张数的便捷读取：下游模型的参考图上限。 */
export function consumerRefLimit(cap: ModelCapability): number | undefined {
  return maxRefImagesOf(cap)
}
