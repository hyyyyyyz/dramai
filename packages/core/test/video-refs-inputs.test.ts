import { describe, expect, it } from 'vitest'
import { resolveInputs } from '../src/generation/inputs.ts'
import { putFile, slotWith, makeWorld } from './helpers.ts'

/** 视频目标默认不解析参考图（和以前一样）；withReferences 才解析，规则与生图共用同一份。 */

async function withStartFrame() {
  const w = await makeWorld()
  const f = await putFile(w.ports, w.project.id, 'images/shot1.png', 'frame')
  await w.ports.store.shots.put({
    ...(await w.ports.store.shots.get(w.shot.id))!,
    image: slotWith('image', 'shot1_v1', f),
  })
  return w
}

describe('shot_video inputs: references are opt-in', () => {
  it('by default there are no references at all (the start frame only)', async () => {
    const w = await withStartFrame()
    const inputs = resolveInputs(await w.reload(), { kind: 'shot_video', shotId: w.shot.id })
    expect(inputs.references).toEqual([])
    expect(inputs.trimmed).toEqual([])
    expect(inputs.startFrame).toBeDefined()
    expect(inputs.gaps).toEqual([])
  })

  it('with references: the same assets and the same order the shot image would use', async () => {
    const w = await withStartFrame()
    const p = await w.reload()
    const video = resolveInputs(
      p,
      { kind: 'shot_video', shotId: w.shot.id },
      { withReferences: true },
    )
    const image = resolveInputs(p, { kind: 'shot_image', shotId: w.shot.id })
    expect(video.references.map((r) => [r.role, r.assetName, r.index])).toEqual([
      ['character', '林夏', 1],
      ['location', '老茶馆', 2],
    ])
    // the picked assets and order equal the image side (which also may carry a style image)
    expect(video.references.map((r) => r.assetId)).toEqual(
      image.references.filter((r) => r.role !== 'style').map((r) => r.assetId),
    )
    expect(video.startFrame?.role).toBe('start_frame') // the frame is still its own thing
  })

  it('the model limit trims by the shared priority and warns', async () => {
    const w = await withStartFrame()
    const v = resolveInputs(
      await w.reload(),
      { kind: 'shot_video', shotId: w.shot.id },
      { withReferences: true, maxRefImages: 1 },
    )
    expect(v.references.map((r) => r.assetName)).toEqual(['林夏'])
    expect(v.trimmed.map((r) => r.assetName)).toEqual(['老茶馆'])
    expect(v.gaps.map((g) => g.code)).toContain('REFS_TRIMMED')
  })

  it('an asset without a sheet blocks, like for images', async () => {
    const w = await makeWorld({ sheets: false })
    const f = await putFile(w.ports, w.project.id, 'images/shot1.png', 'frame')
    await w.ports.store.shots.put({
      ...(await w.ports.store.shots.get(w.shot.id))!,
      image: slotWith('image', 'shot1_v1', f),
    })
    const v = resolveInputs(
      await w.reload(),
      { kind: 'shot_video', shotId: w.shot.id },
      { withReferences: true },
    )
    expect(v.gaps.map((g) => g.code)).toContain('ASSET_SHEET_MISSING')
    const off = resolveInputs(await w.reload(), { kind: 'shot_video', shotId: w.shot.id })
    expect(off.gaps.map((g) => g.code)).not.toContain('ASSET_SHEET_MISSING')
  })
})
