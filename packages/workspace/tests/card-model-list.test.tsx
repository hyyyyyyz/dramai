import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvidersPage } from '@/features/settings/ProvidersPage'
import { ALL_PROTOCOLS, LISTS_MODELS, kindOfProtocol } from '@/features/settings/protocols'
import { fakeServer } from './fixtures'
import { makeCapabilityView } from './fixtures-production'
import { makeKeyProvider } from './fixtures-providers'
import { renderApp, useLocale } from './render'
import probed from './fixtures/add-provider/recorded-probe.json'
import wan from './fixtures/saved-providers/302-i2v-wan-flash.json'

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

const answers = probed.modelsByProtocol as Record<string, { outcome: string }>

describe('which saved providers offer “Get model list”', () => {
  it('the list of interface types that can list is the list the real server answers with a model list, for every interface type', () => {
    expect(Object.keys(answers).sort()).toEqual([...ALL_PROTOCOLS].sort())
    const listed = Object.entries(answers)
      .filter(([, a]) => a.outcome === 'models')
      .map(([p]) => p)
    expect([...LISTS_MODELS].sort()).toEqual(listed.sort())
    // and the ones that cannot say so, rather than failing
    for (const [p, a] of Object.entries(answers))
      if (!LISTS_MODELS.has(p as never)) expect(a.outcome, p).toBe('no_model_list')
  })

  it.each([...ALL_PROTOCOLS])(
    '%s: the button is there exactly when its interface type can list',
    async (protocol) => {
      const provider = makeKeyProvider({
        id: 'prov_p',
        label: `P ${protocol}`,
        kind: kindOfProtocol(protocol),
        protocol,
      })
      const server = fakeServer({
        'GET /api/providers': () => ({ items: [provider] }),
        'GET /api/settings': () => ({ activeProviders: {}, cost: {} }),
        'GET /api/projects': () => ({ items: [] }),
        'GET /api/providers/prov_p/capability': () => makeCapabilityView(),
      })
      renderApp(<ProvidersPage />, { client: server.client })
      const card = await screen.findByRole('article', { name: `P ${protocol}` })
      await userEvent.click(within(card).getByRole('button', { name: /展开/ }))
      const button = within(card).queryByRole('button', { name: '获取模型列表' })
      if (LISTS_MODELS.has(protocol)) expect(button).not.toBeNull()
      else expect(button).toBeNull()
      // nothing is asked of the provider until the button is pressed
      expect(server.calls.some((c) => c.path.endsWith('/models'))).toBe(false)
    },
  )
})

describe('saved providers with an interface type that can no longer be added', () => {
  it.each(['aliyun-video', 'volcengine-video', 'kling-video'] as const)(
    '%s: the card shows, opens and edits as before, and the interface type keeps its name in the box',
    async (protocol) => {
      const saved = { ...wan, id: `prov_${protocol}`, protocol }
      const server = fakeServer({
        'GET /api/providers': () => ({ items: [saved] }),
        'GET /api/settings': () => ({ activeProviders: {}, cost: {} }),
        'GET /api/projects': () => ({ items: [] }),
        [`GET /api/providers/${saved.id}/capability`]: () => makeCapabilityView(),
      })
      renderApp(<ProvidersPage />, { client: server.client })
      const card = await screen.findByRole('article', { name: saved.label })
      await userEvent.click(within(card).getByRole('button', { name: /展开/ }))
      const select = within(card).getByRole('combobox', { name: /API 协议/ })
      expect(select).toHaveValue(protocol)
      expect(select).toBeEnabled()
      const values = within(select)
        .getAllByRole('option')
        .map((o) => (o as HTMLOptionElement).value)
      expect(values).toContain('aliyun-video')
      expect(values).toContain('volcengine-video')
      expect(values).toContain('kling-video')
      expect(within(card).getByRole('button', { name: /测试连接/ })).toBeEnabled()
    },
  )
})
