import { buildExpectations, buildRecord, loadProjection } from '@dramai/core'
import type { MediaVersion, Store } from '@dramai/core'
import type { ServerContext } from '../context.ts'

/**
 * 用户选用某个版本作为当前版本时，让产物记录跟上：
 * - 记录里的“生成依据”用这个版本自己的依据摘要（`version.basisDigest`）——选用的是旧版本、
 *   或是之前被“忽略结果”的版本，依据和现在不一致时如实显示为过期，不会因为被选中就冒充最新；
 * - 还没有记录（例如被忽略的结果，当时没有登记）就按当前的上游快照新建一条；
 * - 作者上传的版本按图本身登记，不随描述变化失效。
 */
export async function registerVersionArtifact(
  ctx: ServerContext,
  tx: Store,
  projectId: string,
  key: string,
  version: MediaVersion,
): Promise<void> {
  const projection = await loadProjection(tx, projectId)
  const expectation = buildExpectations(projection).get(key)
  if (!expectation) {
    await tx.artifacts.delete(projectId, key)
    return
  }
  const uploaded = version.source === 'uploaded'
  try {
    const rec = buildRecord({
      projectId,
      // 上传的成品不因设定图还没生成而被拦住，按它当前能确定的依据登记。
      expectation: uploaded
        ? { ...expectation, blockedBy: undefined, requiredUpstream: [] }
        : expectation,
      upstreamRecords: projection.artifacts,
      file: version.file,
      versionId: version.id,
      origin: uploaded ? 'uploaded' : 'generated',
      facts: version.facts,
      now: ctx.clock.now(),
    })
    await tx.artifacts.put({ ...rec, basisDigest: version.basisDigest ?? rec.basisDigest })
  } catch {
    // 依据被阻断（缺必需的上游），登记不了：没有记录就是“缺失”，比冒充当前更诚实。
    await tx.artifacts.delete(projectId, key)
  }
}
