import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'
import { MOCK } from './env'

/** 把界面语言固定下来（必须在 goto 之前）。 */
export async function setLocale(page: Page, locale: 'zh-CN' | 'en') {
  await page.addInitScript((l) => {
    try {
      localStorage.setItem('dramai.locale', l)
    } catch {
      /* 存储不可用 */
    }
  }, locale)
}

/** 控制模拟服务商：故障规则（见 `pnpm demo --help`）。 */
export const mock = {
  /** 让流式文本快一点（默认是慢速的，为了看得清）。 */
  async fastStream(ms = 2) {
    const r = await fetch(`${MOCK}/__mock/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ streamChunkMs: ms }),
    })
    expect(r.ok).toBe(true)
  },
  async rule(rule: { fault: string; on: 'image' | 'video' | 'tts' | 'llm'; times?: number }) {
    const r = await fetch(`${MOCK}/__mock/rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rule),
    })
    expect(r.ok).toBe(true)
  },
  async clear() {
    await fetch(`${MOCK}/__mock/rules`, { method: 'DELETE' })
  },
  async heal() {
    await fetch(`${MOCK}/__mock/heal`, { method: 'POST' })
  },
}

/** 页面没有横向滚动条（任何页面、任何宽度都不该有）。 */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

/** 等所有任务都结束（没有排队的、没有进行中的）。任务面板和各页面都是靠事件自己更新的，这里只是等服务端干完。 */
export async function waitJobsIdle(page: Page, timeout = 120_000) {
  await expect
    .poll(
      async () => {
        const r = await page.request.get('/api/jobs?limit=200')
        const { items } = (await r.json()) as { items: { status: string }[] }
        return items.filter((j) => j.status === 'queued' || j.status === 'running').length
      },
      { timeout, intervals: [500] },
    )
    .toBe(0)
}

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * 用接口准备一个项目（界面上走一遍很慢，而且那是 happy-path 用例的事）：原文、分集、分镜、提示词，
 * 可选地把分镜图出好。返回项目和第一集的 id。
 */
export async function seedProject(
  page: Page,
  name: string,
  opts: { images?: boolean; videos?: boolean } = {},
) {
  const api = page.request
  const post = async <T>(url: string, data?: unknown): Promise<T> => {
    const r = await api.post(url, { data: data ?? {} })
    expect(r.ok(), `${url}: ${r.status()} ${await r.text()}`).toBe(true)
    return (await r.json()) as T
  }
  const project = await post<{ id: string }>('/api/projects', {
    name,
    aspectRatio: '9:16',
    narrationDelivery: 'tts',
    style: { source: 'none' },
  })
  const up = await api.post(`/api/projects/${project.id}/materials`, {
    multipart: {
      file: {
        name: 'story.txt',
        mimeType: 'text/plain',
        buffer: readFileSync(path.join(here, 'fixtures/story.txt')),
      },
    },
  })
  expect(up.ok()).toBe(true)
  await post(`/api/projects/${project.id}/episodes/plan`)
  await waitJobsIdle(page)
  const eps = (await (await api.get(`/api/projects/${project.id}/episodes`)).json()) as {
    items: { id: string }[]
  }
  const episodeId = eps.items[0]!.id
  await post(`/api/episodes/${episodeId}/breakdown`)
  await waitJobsIdle(page)
  await post(`/api/episodes/${episodeId}/shot-prompts`)
  await waitJobsIdle(page)
  if (opts.images) {
    const detail = (await (await api.get(`/api/episodes/${episodeId}`)).json()) as {
      shots: { id: string }[]
    }
    await post(`/api/projects/${project.id}/generate`, {
      items: detail.shots
        .slice(0, 3)
        .map((s) => ({ target: { kind: 'shot_image', shotId: s.id } })),
      confirmUnverified: true,
    })
    await waitJobsIdle(page)
  }
  return { projectId: project.id, episodeId }
}
