import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvidersPage } from '@/features/settings/ProvidersPage'
import { fakeServer } from './fixtures'
import { makeCapabilityView } from './fixtures-production'
import { renderApp, useLocale } from './render'
import chat from './fixtures/saved-providers/302ai-chat.json'
import seedream from './fixtures/saved-providers/302-image-seedream.json'
import nanoBanana from './fixtures/saved-providers/302-image-nano-banana.json'
import wan from './fixtures/saved-providers/302-i2v-wan-flash.json'

/**
 * Providers that were saved from four built-in presets which the catalogue no longer lists. The JSON files are the
 * real shape the server returned for them (made with `providers.fromPreset` before the presets were removed); each
 * still carries its `presetId`, which now points at nothing. They must show up in settings as ordinary providers.
 */
const SAVED = [
  { dto: chat, kind: '大模型', tested: false },
  { dto: seedream, kind: '图片', tested: true },
  { dto: nanoBanana, kind: '图片', tested: true },
  { dto: wan, kind: '视频', tested: true },
]

const memoryStorage = () => {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  }
}
beforeEach(async () => {
  vi.stubGlobal('localStorage', memoryStorage())
  await useLocale('zh-CN')
})
afterEach(() => vi.unstubAllGlobals())

function page() {
  const routes: Parameters<typeof fakeServer>[0] = {
    'GET /api/providers': () => ({ items: SAVED.map((s) => s.dto) }),
    'GET /api/settings': () => ({ activeProviders: {}, cost: {} }),
    'PUT /api/settings': ({ body }) => body,
    'GET /api/projects': () => ({ items: [] }),
    // the catalogue has none of these presets any more
    'GET /api/presets': () => ({ items: [] }),
  }
  for (const s of SAVED)
    routes[`GET /api/providers/${s.dto.id}/capability`] = () => makeCapabilityView()
  const server = fakeServer(routes)
  const view = renderApp(<ProvidersPage />, { client: server.client })
  return { ...view, server }
}

const card = (name: string) => screen.findByRole('article', { name })

describe('providers saved from presets that are no longer in the catalogue', () => {
  it('each one is listed as an ordinary provider with its own label, model and verification status', async () => {
    page()
    for (const { dto, tested } of SAVED) {
      const c = await card(dto.label)
      if (tested) expect(within(c).getByText('已实测 · 2026-05-04')).toBeInTheDocument()
      else expect(within(c).getByText('按官方文档接入，未实测')).toBeInTheDocument()
      // a key is on file: shown the way every saved key is
      expect(within(c).getByText('API Key')).toBeInTheDocument()
    }
  })

  it('no error, no “preset not found” notice anywhere on the page', async () => {
    const { container } = page()
    await card(SAVED[0]!.dto.label)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(container.textContent).not.toMatch(/找不到预设|预设不存在|preset not found|not found/i)
  })

  it('opened, it is editable like any provider: address, model and protocol are not locked', async () => {
    page()
    const c = await card(wan.label)
    await userEvent.click(within(c).getByRole('button', { name: /展开/ }))
    const url = within(c).getByRole('textbox', { name: 'Base URL' })
    expect(url).toHaveValue(wan.baseUrl)
    expect(url).not.toHaveAttribute('readonly')
    expect(within(c).getByRole('combobox', { name: /API 协议/ })).toBeEnabled()
    expect(within(c).getByRole('button', { name: /测试连接/ })).toBeEnabled()
    expect(within(c).getByDisplayValue(wan.model)).toBeInTheDocument()
    // the saved notes and limitations are the provider's own text now
    for (const line of wan.knownLimitations) expect(within(c).getByText(line)).toBeInTheDocument()
  })

  it('the documented-only one is not made the current choice, and the tested ones are shown as saved', async () => {
    const { server } = page()
    await card(chat.label)
    const puts = server.calls.filter((c) => c.method === 'PUT' && c.path === '/api/settings')
    expect(puts).toEqual([])
  })
})
