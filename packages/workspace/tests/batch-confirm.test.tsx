import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { GenerateItem } from '@dramai/api'
import { BatchConfirmDialog } from '@/features/storyboard/BatchConfirmDialog'
import type { BatchCandidate } from '@/features/storyboard/batch-model'
import { fakeServer } from './fixtures'
import { makeCapabilityView, makePreflight, makeProvider, makeVerdict } from './fixtures-production'
import { renderApp, useLocale } from './render'

beforeEach(async () => {
  await useLocale('zh-CN')
})

const candidates: BatchCandidate[] = [1, 2, 3].map((i) => ({
  shotId: `s${i}`,
  index: i,
  label: `镜头 0${i} · 回廊`,
  target: { kind: 'shot_video', shotId: `s${i}` },
}))

type Handler = (
  items: GenerateItem[],
  confirmUnverified: boolean,
) => ReturnType<typeof makePreflight>

function open(preflight: Handler, extra: Parameters<typeof fakeServer>[0] = {}) {
  const server = fakeServer({
    'GET /api/settings': () => ({ activeProviders: { video: 'prov_v' }, cost: {} }),
    'GET /api/providers': () => ({ items: [makeProvider()] }),
    'GET /api/providers/prov_v/capability': () => makeCapabilityView('unsupported'),
    'POST /api/projects/proj_1/preflight': ({ body }) => {
      const b = body as { items: GenerateItem[]; confirmUnverified?: boolean }
      return preflight(b.items, Boolean(b.confirmUnverified))
    },
    ...extra,
  })
  const view = renderApp(
    <BatchConfirmDialog
      projectId="proj_1"
      episodeNumber={2}
      aspect="9:16"
      kind="shot_video"
      candidates={candidates}
      assets={new Map()}
      onClose={() => {}}
    />,
    { client: server.client },
  )
  return { ...view, server }
}

const tid = (i: number) => `shot_video:s${i}`
const ok = (items: GenerateItem[]) =>
  makePreflight(
    items.map((it) =>
      makeVerdict(`shot_video:${(it.target as { shotId: string }).shotId}`, {
        estimate: { priced: true, currency: 'PTC', amount: 0.2, approx: true },
      }),
    ),
    { byCurrency: { PTC: { amount: 0.2 * items.length, approx: true } } },
  )

describe('BatchConfirmDialog', () => {
  it('all runnable: says what happens on confirm, shows the cost per currency, and sends exactly the selected items', async () => {
    const { server } = open(ok, {
      'POST /api/projects/proj_1/generate': ({ body }) => {
        const items = (body as { items: GenerateItem[] }).items
        return {
          requested: items.map((_, i) => tid(i + 1)),
          succeeded: items.map((_, i) => ({
            targetId: tid(i + 1),
            jobId: `job_${i}`,
            deduped: false,
          })),
          failed: [],
          blocked: [],
          admission: ok(items),
        }
      },
    })
    expect(await screen.findByText(/共生成 3 项。确认后才会创建任务/)).toBeInTheDocument()
    expect(screen.getAllByText('可运行')).toHaveLength(3)
    expect(screen.getByTestId('cost-headline')).toHaveTextContent('0.6')
    expect(screen.getByText(/估算，不是账单/)).toBeInTheDocument()
    // 模型和能力
    expect(screen.getByText('Wan Flash')).toBeInTheDocument()
    expect(await screen.findByText('不支持')).toBeInTheDocument()

    // 点确认之前不会创建任务
    expect(server.calls.some((c) => c.path.endsWith('/generate'))).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: /确认并加入队列/ }))
    await waitFor(() =>
      expect(server.calls.some((c) => c.path === '/api/projects/proj_1/generate')).toBe(true),
    )
    const sent = server.calls.find((c) => c.path === '/api/projects/proj_1/generate')!.body as {
      items: GenerateItem[]
    }
    expect(sent.items.map((i) => i.target)).toEqual(candidates.map((c) => c.target))
    expect(sent).not.toHaveProperty('confirmUnverified')
  })

  it('one blocked item blocks the whole batch: nothing is created, no cost, the reason is written, the others say who blocked them', async () => {
    const { server } = open((items) =>
      makePreflight([
        makeVerdict(tid(1), {
          status: 'blocked',
          reasons: [{ code: 'PROMPT_EMPTY', message: 'shot has no video prompt' }],
        }),
        ...items.slice(1).map((it) =>
          makeVerdict(`shot_video:${(it.target as { shotId: string }).shotId}`, {
            status: 'blocked_by_batch',
            blockedBy: [tid(1)],
            reasons: [{ code: 'BLOCKED_BY_BATCH', message: 'x' }],
          }),
        ),
      ]),
    )
    expect(await screen.findByText('整批不会运行')).toBeInTheDocument()
    expect(screen.getByText(/你选了 3 项，其中 1 项没通过检查/)).toBeInTheDocument()
    expect(screen.getByText(/现在没有任何任务被创建，也不会产生费用/)).toBeInTheDocument()
    // 原因按码取本地化文案，不是服务端的英文
    expect(screen.getByText('这个镜头还没有提示词，生成需要它')).toBeInTheDocument()
    expect(screen.queryByText(/shot has no video prompt/)).toBeNull()
    expect(screen.getAllByText('被整批拦下')).toHaveLength(2)
    expect(screen.getAllByText(/被 镜头 01 · 回廊 整批拦下/)).toHaveLength(2)
    expect(screen.getByRole('button', { name: /确认并加入队列/ })).toBeDisabled()
    expect(screen.queryByTestId('cost-headline')).toBeInTheDocument() // 费用框仍在，但确认不可用
    expect(server.calls.some((c) => c.path.endsWith('/generate'))).toBe(false)
  })

  it('a shot with no narration text is blocked with one clear reason (not also “project is not TTS”), and the way out is offered', async () => {
    open((items) =>
      makePreflight([
        makeVerdict(tid(1), {
          status: 'blocked',
          reasons: [
            { code: 'NARRATION_EMPTY', message: 'shot has no narration' },
            { code: 'NARRATION_NOT_TTS', message: 'wrong for a TTS project' },
          ],
        }),
        ...items.slice(1).map((it) =>
          makeVerdict(`shot_video:${(it.target as { shotId: string }).shotId}`, {
            status: 'blocked_by_batch',
            blockedBy: [tid(1)],
          }),
        ),
      ]),
    )
    expect(await screen.findByText('整批不会运行')).toBeInTheDocument()
    expect(screen.getByText('这个镜头没有旁白文字，没有东西可配音')).toBeInTheDocument()
    expect(screen.queryByText(/项目的旁白不是 TTS 交付/)).toBeNull()
    expect(screen.getByRole('button', { name: '不选被拦下的' })).toBeInTheDocument()
  })

  it('“deselect the blocked ones” re-runs the preflight for the rest, and then the batch can run', async () => {
    const { server } = open((items) =>
      items.some((it) => (it.target as { shotId: string }).shotId === 's1')
        ? makePreflight([
            makeVerdict(tid(1), {
              status: 'blocked',
              reasons: [{ code: 'START_FRAME_MISSING', message: 'x' }],
            }),
            ...items.slice(1).map((it) =>
              makeVerdict(`shot_video:${(it.target as { shotId: string }).shotId}`, {
                status: 'blocked_by_batch',
                blockedBy: [tid(1)],
              }),
            ),
          ])
        : ok(items),
    )
    await userEvent.click(await screen.findByRole('button', { name: '不选被拦下的' }))
    await screen.findByText(/共生成 2 项/)
    expect(screen.getByText('没选')).toBeInTheDocument()
    const calls = server.calls.filter((c) => c.path.endsWith('/preflight'))
    expect((calls.at(-1)!.body as { items: unknown[] }).items).toHaveLength(2)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /确认并加入队列/ })).toBeEnabled(),
    )
  })

  it('unverified capabilities need an explicit confirmation, which is sent as confirmUnverified', async () => {
    const { server } = open((items, confirmed) =>
      confirmed
        ? ok(items)
        : makePreflight(
            items.map((it) =>
              makeVerdict(`shot_video:${(it.target as { shotId: string }).shotId}`, {
                status: 'needs_confirmation',
                unverified: [
                  { key: 'mode:i2v', code: 'UNVERIFIED', message: 'x', confirmed: false },
                ],
              }),
            ),
          ),
    )
    expect(await screen.findByText('这批依赖没验证过的能力')).toBeInTheDocument()
    expect(screen.getByText(/服务商没有验证过这种生成方式/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /确认并加入队列/ })).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: /我了解这些能力没验证过/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /确认并加入队列/ })).toBeEnabled(),
    )
    const last = server.calls.filter((c) => c.path.endsWith('/preflight')).at(-1)!.body as {
      confirmUnverified?: boolean
    }
    expect(last.confirmUnverified).toBe(true)
  })

  it('a partially failed submission is reported, not silently closed', async () => {
    const { server } = open(ok, {
      'POST /api/projects/proj_1/generate': () => ({
        requested: [tid(1), tid(2), tid(3)],
        succeeded: [{ targetId: tid(1), jobId: 'j1', deduped: false }],
        failed: [{ targetId: tid(2), reason: { code: 'ENQUEUE_FAILED', message: 'x' } }],
        blocked: [{ targetId: tid(3), reasons: [{ code: 'IN_FLIGHT_CONFLICT', message: 'x' }] }],
        admission: makePreflight([]),
      }),
    })
    await userEvent.click(await screen.findByRole('button', { name: /确认并加入队列/ }))
    await waitFor(() => expect(server.calls.some((c) => c.path.endsWith('/generate'))).toBe(true))
    expect(await screen.findByText('有的没有加入队列')).toBeInTheDocument()
    expect(screen.getByText(/1 项已加入队列，2 项没有成功/)).toBeInTheDocument()
  })

  it('cost is shown per currency; items without a price are counted, not guessed', async () => {
    open(() =>
      makePreflight([makeVerdict(tid(1)), makeVerdict(tid(2)), makeVerdict(tid(3))], {
        byCurrency: { PTC: { amount: 0.2, approx: true } },
        unpriced: 2,
      }),
    )
    expect(await screen.findByTestId('cost-headline')).toHaveTextContent('PTC')
    expect(screen.getByText('2 项查不到单价，没有计入')).toBeInTheDocument()
    expect(
      within(screen.getByTestId('cost-headline').parentElement!).getByText('预估费用'),
    ).toBeInTheDocument()
  })

  it('English copy, including the plural of the batch size', async () => {
    await useLocale('en')
    open(ok)
    expect(await screen.findByText(/3 items will be generated/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirm and queue/ })).toBeInTheDocument()
  })
})
