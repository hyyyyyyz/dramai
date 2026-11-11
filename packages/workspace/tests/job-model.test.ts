import { describe, expect, it } from 'vitest'
import {
  groupJobs,
  jobActions,
  jobCounts,
  mayRecharge,
  RECENT_LIMIT,
} from '@/features/jobs/job-model'
import { failedJob, makeJob } from './fixtures'

describe('job actions follow the job semantics', () => {
  it('queued: cancel only', () => {
    expect(jobActions(makeJob({ status: 'queued' }))).toEqual({
      cancel: true,
      resume: false,
      regenerate: false,
      acknowledge: false,
    })
  })

  it('running: nothing — a submitted call cannot be recalled', () => {
    expect(jobActions(makeJob({ status: 'running' }))).toEqual({
      cancel: false,
      resume: false,
      regenerate: false,
      acknowledge: false,
    })
  })

  it('delivery_failed with an upstream id: resume is offered, regenerate is separate and may recharge', () => {
    const a = jobActions(failedJob('delivery_failed'))
    expect(a.resume).toBe(true)
    expect(a.regenerate).toBe('recharge')
    expect(a.acknowledge).toBe(true)
    expect(a.cancel).toBe(false)
  })

  it('generation_failed: no resume, a plain regenerate (the provider refused, nothing was charged)', () => {
    const a = jobActions(failedJob('generation_failed'))
    expect(a).toMatchObject({ resume: false, regenerate: 'plain', acknowledge: true })
  })

  it('submission_unknown: never resumable, regenerate needs the recharge confirmation', () => {
    const j = failedJob('submission_unknown')
    expect(jobActions(j)).toMatchObject({ resume: false, regenerate: 'recharge' })
    expect(mayRecharge(j)).toBe(true)
  })

  it('unpaid failures (text, render) retry without a recharge warning', () => {
    const j = failedJob('internal', { paid: false, type: 'text', operation: 'episodes_plan' })
    expect(jobActions(j).regenerate).toBe('plain')
    expect(mayRecharge(j)).toBe(false)
  })

  it('an acknowledged failure can no longer be acknowledged but can still be resumed', () => {
    const j = failedJob('delivery_failed', { acknowledgedAt: 123 })
    expect(j.needsAttention).toBe(false)
    expect(jobActions(j)).toMatchObject({ acknowledge: false, resume: true })
  })

  it('finished jobs have no actions', () => {
    for (const status of ['succeeded', 'cancelled'] as const)
      expect(jobActions(makeJob({ status }))).toEqual({
        cancel: false,
        resume: false,
        regenerate: false,
        acknowledge: false,
      })
  })
})

describe('grouping', () => {
  it('needs attention → running → queued → recent, newest first, recent is capped', () => {
    const jobs = [
      makeJob({ id: 'q2', status: 'queued', queuePosition: 2 }),
      makeJob({ id: 'q1', status: 'queued', queuePosition: 1 }),
      makeJob({ id: 'r', status: 'running', startedAt: 5 }),
      failedJob('delivery_failed', { id: 'f1', finishedAt: 10 }),
      failedJob('generation_failed', { id: 'f2', finishedAt: 20 }),
      failedJob('generation_failed', { id: 'f-acked', finishedAt: 30, acknowledgedAt: 31 }),
      ...Array.from({ length: RECENT_LIMIT + 3 }, (_, i) =>
        makeJob({ id: `s${i}`, status: 'succeeded', finishedAt: 100 + i }),
      ),
    ]
    const g = groupJobs(jobs)
    expect(g.attention.map((j) => j.id)).toEqual(['f2', 'f1'])
    expect(g.running.map((j) => j.id)).toEqual(['r'])
    expect(g.queued.map((j) => j.id)).toEqual(['q1', 'q2'])
    expect(g.recent).toHaveLength(RECENT_LIMIT)
    expect(g.recent[0]!.id).toBe(`s${RECENT_LIMIT + 2}`)
    expect(g.recent.map((j) => j.id)).not.toContain('f1')
  })

  it('counts drive the top-bar trigger', () => {
    const jobs = [
      makeJob({ status: 'queued' }),
      makeJob({ status: 'running' }),
      makeJob({ status: 'running' }),
      failedJob('internal'),
      failedJob('internal', { acknowledgedAt: 1 }),
      makeJob({ status: 'succeeded' }),
    ]
    expect(jobCounts(jobs)).toEqual({ running: 2, queued: 1, attention: 1 })
  })
})
