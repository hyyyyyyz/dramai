import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskItem } from '@/features/jobs/TaskItem'
import { TaskPanel } from '@/features/jobs/TaskPanel'
import { apiError, failedJob, fakeServer, makeJob } from './fixtures'
import { renderApp, useLocale } from './render'

beforeEach(async () => {
  await useLocale('zh-CN')
})

const noop = () => {}
const item = (
  job: ReturnType<typeof makeJob>,
  over: Partial<Parameters<typeof TaskItem>[0]> = {},
) =>
  renderApp(
    <ul>
      <TaskItem
        job={job}
        now={1_700_000_100_000}
        onCancel={noop}
        onResume={noop}
        onRegenerate={noop}
        onAcknowledge={noop}
        {...over}
      />
    </ul>,
    { client: fakeServer({}).client },
  )

describe('TaskItem states', () => {
  it('queued: shows its position and only a cancel button', () => {
    item(makeJob({ status: 'queued', queuePosition: 2 }))
    expect(screen.getByText(/排在第 2 位/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消排队' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /重新生成|恢复/ })).toBeNull()
  })

  it('running: no cancel, says why, shows a progress bar and elapsed time', () => {
    item(makeJob({ status: 'running', startedAt: 1_700_000_028_000 }))
    expect(screen.queryByRole('button', { name: '取消排队' })).toBeNull()
    expect(screen.getByText(/不能取消/)).toBeInTheDocument()
    expect(screen.getByText(/已进行 1 分 12 秒/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('delivery_failed: "resume the original task" is separate from "regenerate (may be charged again)"', () => {
    item(failedJob('delivery_failed'))
    expect(screen.getByRole('button', { name: '恢复原任务' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新生成（可能再次计费）' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument()
    expect(screen.getByText(/上游任务还在，可以恢复/)).toBeInTheDocument()
  })

  it('generation_failed: only a plain regenerate', () => {
    item(failedJob('generation_failed'))
    expect(screen.queryByRole('button', { name: '恢复原任务' })).toBeNull()
    expect(screen.getByRole('button', { name: '重新生成' })).toBeInTheDocument()
    expect(screen.queryByText(/可能再次计费/)).toBeNull()
  })

  it('submission_unknown: explains that nothing is resubmitted automatically and offers "I have checked"', () => {
    item(failedJob('submission_unknown'))
    expect(screen.getByText(/提交结果待确认/)).toBeInTheDocument()
    expect(screen.getByText(/不会自动重新提交/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '我已核对，关闭' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '恢复原任务' })).toBeNull()
  })

  it('an acknowledged failure no longer offers to dismiss', () => {
    item(failedJob('generation_failed', { acknowledgedAt: 5 }))
    expect(screen.queryByRole('button', { name: '关闭' })).toBeNull()
  })

  it('English copy', async () => {
    await useLocale('en')
    item(failedJob('delivery_failed'))
    expect(screen.getByRole('button', { name: 'Resume original task' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Regenerate (may be charged again)' }),
    ).toBeInTheDocument()
  })

  it('wires the callbacks to the right job', async () => {
    const onResume = vi.fn()
    const onAck = vi.fn()
    const job = failedJob('delivery_failed')
    item(job, { onResume, onAcknowledge: onAck })
    await userEvent.click(screen.getByRole('button', { name: '恢复原任务' }))
    await userEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onResume).toHaveBeenCalledWith(job)
    expect(onAck).toHaveBeenCalledWith(job)
  })
})

function panel(jobs: ReturnType<typeof makeJob>[], routes: Parameters<typeof fakeServer>[0] = {}) {
  const server = fakeServer({
    'GET /api/jobs': () => ({ items: jobs }),
    'GET /api/projects': () => ({ items: [] }),
    ...routes,
  })
  const view = renderApp(<TaskPanel />, { client: server.client })
  return { ...view, server }
}

describe('TaskPanel', () => {
  it('groups tasks: needs action, running, queued, recently finished', async () => {
    panel([
      failedJob('delivery_failed', { id: 'f' }),
      makeJob({ id: 'r', status: 'running', startedAt: 1 }),
      makeJob({ id: 'q', status: 'queued', queuePosition: 1 }),
      makeJob({ id: 's', status: 'succeeded', startedAt: 1, finishedAt: 7000 }),
    ])
    await screen.findByRole('region', { name: '需处理' })
    for (const name of ['需处理', '进行中', '排队', '最近完成'])
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: '需处理' })).getAllByRole('listitem'),
    ).toHaveLength(1)
  })

  it('the tabs filter, and the counts match', async () => {
    panel([
      failedJob('internal'),
      makeJob({ status: 'running' }),
      makeJob({ status: 'queued' }),
      makeJob({ status: 'queued' }),
    ])
    await screen.findByRole('region', { name: '需处理' })
    expect(screen.getByRole('tab', { name: /排队\s*2/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /排队/ }))
    expect(screen.queryByRole('region', { name: '需处理' })).toBeNull()
    expect(screen.getByRole('region', { name: '排队' })).toBeInTheDocument()
  })

  it('cancel calls the cancel endpoint for that job', async () => {
    const { server } = panel([makeJob({ id: 'q1', status: 'queued', queuePosition: 1 })], {
      'POST /api/jobs/q1/cancel': () => makeJob({ id: 'q1', status: 'cancelled' }),
    })
    await userEvent.click(await screen.findByRole('button', { name: '取消排队' }))
    await waitFor(() =>
      expect(
        server.calls.some((c) => c.path === '/api/jobs/q1/cancel' && c.method === 'POST'),
      ).toBe(true),
    )
  })

  it('resume the original task calls resume, never retry', async () => {
    const { server } = panel([failedJob('delivery_failed', { id: 'f1' })], {
      'POST /api/jobs/f1/resume': () => makeJob({ id: 'f1', status: 'queued' }),
    })
    await userEvent.click(await screen.findByRole('button', { name: '恢复原任务' }))
    await waitFor(() =>
      expect(server.calls.some((c) => c.path === '/api/jobs/f1/resume')).toBe(true),
    )
    expect(server.calls.some((c) => c.path === '/api/jobs/f1/retry')).toBe(false)
  })

  it('"I have checked, dismiss" acknowledges the job', async () => {
    const { server } = panel([failedJob('submission_unknown', { id: 'u1' })], {
      'POST /api/jobs/u1/acknowledge': () =>
        failedJob('submission_unknown', { id: 'u1', acknowledgedAt: 9 }),
    })
    await userEvent.click(await screen.findByRole('button', { name: '我已核对，关闭' }))
    await waitFor(() =>
      expect(server.calls.some((c) => c.path === '/api/jobs/u1/acknowledge')).toBe(true),
    )
  })

  it('regenerate that may recharge asks for an explicit confirmation before calling retry', async () => {
    const { server } = panel([failedJob('submission_unknown', { id: 'u1' })], {
      'POST /api/jobs/u1/retry': () => makeJob({ id: 'u1', status: 'queued' }),
    })
    await userEvent.click(await screen.findByRole('button', { name: '重新生成（可能再次计费）' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/可能再扣一次费/)).toBeInTheDocument()
    expect(server.calls.some((c) => c.path.endsWith('/retry'))).toBe(false) // 还没确认，不能发
    await userEvent.click(
      within(dialog).getByRole('button', { name: '确认重新生成（可能再次计费）' }),
    )
    await waitFor(() =>
      expect(server.calls.some((c) => c.path === '/api/jobs/u1/retry')).toBe(true),
    )
    expect(server.calls.find((c) => c.path === '/api/jobs/u1/retry')!.body).toEqual({
      confirmRecharge: true,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('cancelling the confirmation sends nothing', async () => {
    const { server } = panel([failedJob('submission_unknown', { id: 'u1' })])
    await userEvent.click(await screen.findByRole('button', { name: '重新生成（可能再次计费）' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '取消' }),
    )
    expect(server.calls.some((c) => c.path.endsWith('/retry'))).toBe(false)
  })

  it('a plain regenerate (no recharge) goes straight through without a dialog', async () => {
    const { server } = panel([failedJob('generation_failed', { id: 'g1' })], {
      'POST /api/jobs/g1/retry': () => makeJob({ id: 'g1', status: 'queued' }),
    })
    await userEvent.click(await screen.findByRole('button', { name: '重新生成' }))
    await waitFor(() =>
      expect(server.calls.some((c) => c.path === '/api/jobs/g1/retry')).toBe(true),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(server.calls.find((c) => c.path === '/api/jobs/g1/retry')!.body).toEqual({})
  })

  it('if the server says CONFIRM_RECHARGE_REQUIRED the dialog opens — decided by the code, not the text', async () => {
    let first = true
    const { server } = panel([failedJob('generation_failed', { id: 'g1' })], {
      'POST /api/jobs/g1/retry': ({ body }) => {
        if (first && !(body as { confirmRecharge?: boolean }).confirmRecharge) {
          first = false
          return apiError(409, 'CONFIRM_RECHARGE_REQUIRED', { requires: 'confirmRecharge' })
        }
        return makeJob({ id: 'g1', status: 'queued' })
      },
    })
    await userEvent.click(await screen.findByRole('button', { name: '重新生成' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /确认重新生成/ }))
    await waitFor(() =>
      expect(server.calls.filter((c) => c.path === '/api/jobs/g1/retry')).toHaveLength(2),
    )
    expect(server.calls.filter((c) => c.path === '/api/jobs/g1/retry')[1]!.body).toEqual({
      confirmRecharge: true,
    })
  })

  it('an action that the server refuses shows a localized message for its code', async () => {
    panel([makeJob({ id: 'q1', status: 'queued', queuePosition: 1 })], {
      'POST /api/jobs/q1/cancel': () => apiError(409, 'RUNNING_NOT_CANCELLABLE'),
    })
    await userEvent.click(await screen.findByRole('button', { name: '取消排队' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('任务已经开始运行')
  })

  it('shows an empty state with no jobs', async () => {
    panel([])
    expect(await screen.findByText(/还没有任务/)).toBeInTheDocument()
  })
})
