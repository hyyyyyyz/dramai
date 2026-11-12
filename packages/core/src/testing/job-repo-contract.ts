import assert from 'node:assert/strict'
import type { Job } from '../jobs/types.ts'
import type { JobRepo } from '../ports/index.ts'

/**
 * `JobRepo` 的契约检查。任何实现（内存、SQLite）都应通过它：
 * 并发的 `insertIfNoConflict` 最多只有一次插入成功；去重与互斥只看在途任务。
 * 用法：`await checkJobRepoContract(() => createFreshRepo())`。失败时抛 AssertionError。
 */
export async function checkJobRepoContract(
  makeRepo: () => JobRepo | Promise<JobRepo>,
): Promise<void> {
  let n = 0
  const job = (over: Partial<Job> = {}): Job => ({
    schemaVersion: 1,
    id: `job_${++n}`,
    type: 'video',
    operation: 'shot_video',
    projectId: 'p1',
    params: {},
    paid: true,
    status: 'queued',
    attempt: 1,
    previousProviderJobIds: [],
    createdAt: n,
    updatedAt: n,
    ...over,
  })

  // 1. 并发 + 同一 dedupeKey：只有一个插入，其余全是 dedupe 并指向它。
  {
    const repo = await makeRepo()
    const results = await Promise.all(
      Array.from({ length: 12 }, () => repo.insertIfNoConflict(job({ dedupeKey: 'k1' }))),
    )
    const inserted = results.filter((r) => r.inserted)
    assert.equal(inserted.length, 1, 'exactly one concurrent insert may win (dedupeKey)')
    const winner = (inserted[0] as { job: Job }).job.id
    for (const r of results) {
      if (!r.inserted) {
        assert.equal(r.conflict, 'dedupe')
        assert.equal(r.existing.id, winner)
      }
    }
    assert.equal((await repo.list({ status: ['queued', 'running'] })).length, 1)
  }

  // 2. 并发 + 同一 exclusiveKey、不同 dedupeKey：只有一个插入，其余是 exclusive 冲突。
  {
    const repo = await makeRepo()
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        repo.insertIfNoConflict(job({ dedupeKey: `d${i}`, exclusiveKey: 'shot_video:s1' })),
      ),
    )
    assert.equal(
      results.filter((r) => r.inserted).length,
      1,
      'exactly one concurrent insert may win (exclusiveKey)',
    )
    for (const r of results) if (!r.inserted) assert.equal(r.conflict, 'exclusive')
  }

  // 3. 只有在途任务算冲突：结束 / 失败 / 取消的不占位。
  for (const status of ['succeeded', 'failed', 'cancelled'] as const) {
    const repo = await makeRepo()
    await repo.insert(job({ status, dedupeKey: 'k', exclusiveKey: 'x' }))
    const r = await repo.insertIfNoConflict(job({ dedupeKey: 'k', exclusiveKey: 'x' }))
    assert.equal(r.inserted, true, `a ${status} job must not block a new one`)
  }

  // 4. running 的占位；占位在任务结束后释放。
  {
    const repo = await makeRepo()
    const first = await repo.insertIfNoConflict(job({ exclusiveKey: 'x', status: 'running' }))
    assert.equal(first.inserted, true)
    const second = await repo.insertIfNoConflict(job({ exclusiveKey: 'x' }))
    assert.equal(second.inserted, false)
    await repo.patch((first as { job: Job }).job.id, { status: 'succeeded' })
    assert.equal((await repo.insertIfNoConflict(job({ exclusiveKey: 'x' }))).inserted, true)
  }

  // 5. 不同项目互不影响；没有 key 的任务总能插入；dedupe 优先于 exclusive 报告。
  {
    const repo = await makeRepo()
    assert.equal(
      (await repo.insertIfNoConflict(job({ dedupeKey: 'k', exclusiveKey: 'x' }))).inserted,
      true,
    )
    assert.equal(
      (await repo.insertIfNoConflict(job({ projectId: 'p2', dedupeKey: 'k', exclusiveKey: 'x' })))
        .inserted,
      true,
    )
    assert.equal((await repo.insertIfNoConflict(job())).inserted, true)
    assert.equal((await repo.insertIfNoConflict(job())).inserted, true)
    const both = await repo.insertIfNoConflict(job({ dedupeKey: 'k', exclusiveKey: 'x' }))
    assert.equal(both.inserted, false)
    if (!both.inserted) assert.equal(both.conflict, 'dedupe')
  }

  // 6. id 重复抛错，且不改变已有任务。
  {
    const repo = await makeRepo()
    const j = job()
    await repo.insert(j)
    await assert.rejects(() => repo.insertIfNoConflict({ ...j }), /duplicate/)
  }
}
