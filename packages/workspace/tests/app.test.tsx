import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ProjectListItem } from '@dramai/api'
import { App } from '@/app/App'
import { apiError, fakeServer, makeSystem } from './fixtures'
import { useLocale } from './render'

const emptyProgress = {
  episodeId: 'e1',
  split: { scenes: 0, shots: 0, shotsReady: 0 },
  candidates: { total: 0, pending: 0, accepted_new: 0, linked: 0, ignored: 0, handled: 0 },
  sheets: { total: 0, done: 0 },
  images: { total: 0, done: 0 },
  videos: { total: 0, done: 0 },
  composition: { done: false },
}
const project = (patch: Partial<ProjectListItem> = {}): ProjectListItem => ({
  schemaVersion: 1,
  id: 'proj_1',
  name: '清朝宫廷',
  aspectRatio: '9:16',
  style: {
    source: 'template',
    templateId: 't',
    label: '古风仙侠漫',
    description: '',
    imageKeywords: '',
    expandedAt: 1,
  },
  narrationDelivery: 'tts',
  episodeOrder: ['e1'],
  counters: { episode: 1, scene: 0, shot: 0, asset: 0, material: 0 },
  createdAt: 1,
  updatedAt: Date.now() - 60_000,
  episodes: [{ id: 'e1', number: 1, title: '入宫', status: 'planned', progress: emptyProgress }],
  shotCounts: { total: 0, withImage: 0, withVideo: 0, failed: 0 },
  thumbnails: [],
  ...patch,
})

const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const base = {
  'GET /api/system': () => makeSystem(),
  'GET /api/jobs': () => ({ items: [] }),
  'GET /api/projects': () => ({ items: [project()] }),
}

beforeEach(async () => {
  await useLocale('zh-CN')
  window.history.pushState({}, '', '/projects')
})

describe('app shell', () => {
  it('demo mode shows a persistent, visible notice', async () => {
    const s = fakeServer({
      ...base,
      'GET /api/system': () =>
        makeSystem({ demo: { active: true, notice: '演示模式：不会产生任何费用' } }),
    })
    render(<App client={s.client} queryClient={queryClient()} />)
    const banner = await screen.findByTestId('demo-banner')
    expect(banner).toHaveTextContent('演示模式')
    expect(banner).toHaveTextContent('不产生费用')
  })

  it('no notice outside demo mode', async () => {
    const s = fakeServer(base)
    render(<App client={s.client} queryClient={queryClient()} />)
    await screen.findByText('清朝宫廷')
    expect(screen.queryByTestId('demo-banner')).toBeNull()
  })

  it('the demo notice follows the UI language (the server text is Chinese only)', async () => {
    await useLocale('en')
    const s = fakeServer({
      ...base,
      'GET /api/system': () => makeSystem({ demo: { active: true, notice: '演示模式：中文' } }),
    })
    render(<App client={s.client} queryClient={queryClient()} />)
    const banner = await screen.findByTestId('demo-banner')
    expect(banner).toHaveTextContent('Demo mode')
    expect(banner.textContent).not.toMatch(/[一-鿿]/)
  })

  it('a missing token is a full-screen explanation, chosen by error code', async () => {
    const s = fakeServer({ ...base, 'GET /api/system': () => apiError(401, 'UNAUTHORIZED') })
    render(<App client={s.client} queryClient={queryClient()} />)
    expect(await screen.findByText('需要访问令牌')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  it('an unreachable server is a full-screen explanation too', async () => {
    const s = fakeServer(base)
    const failing = {
      ...s.client,
      call: async () => Promise.reject(new TypeError('Failed to fetch')),
    }
    render(<App client={failing as typeof s.client} queryClient={queryClient()} />)
    expect(await screen.findByText('连不上本地服务')).toBeInTheDocument()
  })
})

describe('project list', () => {
  it('lists projects with status, aspect and the episode summary', async () => {
    const s = fakeServer(base)
    render(<App client={s.client} queryClient={queryClient()} />)
    const card = (await screen.findByText('清朝宫廷')).closest('a')!
    expect(within(card).getByText('古风仙侠漫')).toBeInTheDocument()
    expect(within(card).getByText('9:16')).toBeInTheDocument()
    expect(within(card).getByText(/1 集 · 0 个镜头/)).toBeInTheDocument()
    expect(within(card).getByText('1 集待拆分')).toBeInTheDocument()
  })

  it('the new-project dialog creates a project with the chosen aspect ratio, narration and style', async () => {
    const s = fakeServer({
      ...base,
      'GET /api/projects': () => ({ items: [] }),
      'GET /api/styles': () => ({
        groups: [
          {
            id: 'g',
            label: '漫剧',
            presets: [{ id: 'xianxia', label: '古风仙侠漫', description: 'd', imageKeywords: 'k' }],
          },
        ],
      }),
      'POST /api/projects': () => ({ ...project(), id: 'proj_new' }),
      'GET /api/projects/proj_new': () => ({ ...project(), id: 'proj_new' }),
      'GET /api/projects/proj_new/episodes': () => ({ items: [] }),
      'GET /api/projects/proj_new/materials': () => ({ items: [] }),
      'GET /api/projects/proj_new/assets': () => ({ items: [] }),
      'GET /api/projects/proj_new/candidates': () => ({
        items: [],
        progress: { total: 0, pending: 0, accepted_new: 0, linked: 0, ignored: 0, handled: 0 },
      }),
      'GET /api/settings': () => ({ activeProviders: {}, cost: {} }),
      'GET /api/providers': () => ({ items: [] }),
    })
    render(<App client={s.client} queryClient={queryClient()} />)
    await userEvent.click((await screen.findAllByRole('button', { name: '新建项目' }))[0]!)
    const dialog = await screen.findByRole('dialog')
    // 刚打开时不能有任何错误提示（只有尝试提交之后才出现）
    expect(within(dialog).queryByRole('alert')).toBeNull()
    // 标题必填：空着提交要给出文字说明，且不发请求
    await userEvent.click(within(dialog).getByRole('button', { name: '创建并打开' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('请填写标题')
    expect(s.calls.some((c) => c.method === 'POST' && c.path === '/api/projects')).toBe(false)

    await userEvent.type(within(dialog).getByRole('textbox', { name: /标题/ }), '清朝宫廷')
    await userEvent.click(within(dialog).getByRole('radio', { name: /横屏/ }))
    await userEvent.click(within(dialog).getByRole('radio', { name: /后期配音/ }))
    await userEvent.click(await within(dialog).findByRole('button', { name: '古风仙侠漫' }))
    await userEvent.click(within(dialog).getByRole('button', { name: '创建并打开' }))
    await waitFor(() =>
      expect(s.calls.some((c) => c.method === 'POST' && c.path === '/api/projects')).toBe(true),
    )
    expect(s.calls.find((c) => c.method === 'POST' && c.path === '/api/projects')!.body).toEqual({
      name: '清朝宫廷',
      aspectRatio: '16:9',
      narrationDelivery: 'post',
      style: { source: 'template', templateId: 'xianxia' },
    })
    await waitFor(() => expect(window.location.pathname).toBe('/projects/proj_new'))
  })

  it('a server-side NO_LLM_PROVIDER error is explained with a way forward', async () => {
    const s = fakeServer({
      ...base,
      'GET /api/projects/proj_1': () => project(),
      'GET /api/projects/proj_1/episodes': () => ({
        items: [
          {
            schemaVersion: 1,
            id: 'e1',
            projectId: 'proj_1',
            number: 1,
            title: '入宫',
            status: 'planned',
            sceneOrder: [],
            createdAt: 1,
            updatedAt: 1,
            progress: emptyProgress,
          },
        ],
      }),
      'GET /api/projects/proj_1/materials': () => ({ items: [] }),
      'GET /api/projects/proj_1/assets': () => ({ items: [] }),
      'GET /api/projects/proj_1/candidates': () => ({
        items: [],
        progress: { total: 0, pending: 0, accepted_new: 0, linked: 0, ignored: 0, handled: 0 },
      }),
      'GET /api/settings': () => ({ activeProviders: {}, cost: {} }),
      'GET /api/providers': () => ({ items: [] }),
      'POST /api/episodes/e1/breakdown': () => apiError(409, 'NO_LLM_PROVIDER'),
    })
    window.history.pushState({}, '', '/projects/proj_1')
    render(<App client={s.client} queryClient={queryClient()} />)
    const buttons = await screen.findAllByRole('button', { name: '拆分镜头' })
    await userEvent.click(buttons[0]!)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('还没有选中可用的大模型服务商')
    expect(within(alert).getByRole('button', { name: '去设置服务商' })).toBeInTheDocument()
  })
})
