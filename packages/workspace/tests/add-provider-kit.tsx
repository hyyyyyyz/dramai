import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProvidersPage } from '@/features/settings/ProvidersPage'
import { fakeServer } from './fixtures'
import { renderApp } from './render'
import recorded from './fixtures/add-provider/recorded.json'
import probed from './fixtures/add-provider/recorded-probe.json'

/** Shared by the tests of the "Add provider" form: the page, the way to open the form, and the recorded answers. */
export { recorded, probed }

export type Kind = 'llm' | 'image' | 'video' | 'tts'
export const SECTION: Record<Kind, RegExp> = {
  llm: /大模型/,
  image: /文生图/,
  video: /图生视频/,
  tts: /配音/,
}
export const PROVIDERS = recorded.providers
export const LOGIN_CHANNELS = probed.loginChannels

export type KnownModel = { id: string; kind: string; protocols: string[]; displayName?: string }
/** What `GET /api/models/known` answers, from the recorded real answers (the recorded ones for kind + protocol where there are, else the kind's list narrowed by protocol the way the server does). */
export const knownFor = (kind: string, protocol?: string): KnownModel[] => {
  const known = probed.known as Record<string, KnownModel[]>
  if (protocol && known[`${kind}.${protocol}`]) return known[`${kind}.${protocol}`]!
  return (known[kind] ?? []).filter((m) => !protocol || m.protocols.includes(protocol))
}

export function page(
  opts: {
    providers?: unknown[]
    channels?: unknown[]
    routes?: Parameters<typeof fakeServer>[0]
  } = {},
) {
  let list = opts.providers ?? []
  const server = fakeServer({
    'GET /api/providers': () => ({ items: list }),
    'GET /api/settings': () => ({ activeProviders: {}, cost: {} }),
    'PUT /api/settings': ({ body }) => body,
    'GET /api/projects': () => ({ items: [] }),
    'GET /api/login-channels': () => ({ items: opts.channels ?? LOGIN_CHANNELS }),
    'GET /api/models/known': ({ url }) => ({
      items: knownFor(
        url.searchParams.get('kind') ?? '',
        url.searchParams.get('protocol') ?? undefined,
      ),
    }),
    ...opts.routes,
  })
  const view = renderApp(<ProvidersPage />, { client: server.client })
  return { ...view, server, setList: (l: unknown[]) => (list = l) }
}

export async function openForm(kind: Kind = 'llm') {
  const section = await screen.findByRole('region', { name: SECTION[kind] })
  await userEvent.click(within(section).getByRole('button', { name: '添加服务商' }))
  return screen.findByRole('dialog', { name: /添加服务商/ })
}
export const type = async (el: HTMLElement, text: string) => {
  await userEvent.clear(el)
  if (text !== '') await userEvent.type(el, text)
}
export const posts = (server: ReturnType<typeof page>['server']) =>
  server.calls.filter((c) => c.method === 'POST' && c.path === '/api/providers')
export const noWrites = (server: ReturnType<typeof page>['server']) =>
  server.calls.filter((c) => c.method !== 'GET')

/** The model control: a drop-down while there are choices, a box when there are none (or after “Type it in”). */
export const modelControl = (d: HTMLElement) => within(d).getByLabelText(/^模型/)
/** The model ids the drop-down offers (not the placeholder, not “Type it in”). */
export const modelOptions = (d: HTMLElement): string[] => {
  const c = modelControl(d)
  if (c.tagName !== 'SELECT') return []
  return [...c.querySelectorAll('option')]
    .map((o) => o.getAttribute('value') ?? '')
    .filter((v) => v !== '' && !v.startsWith('__dramai'))
}
/** Put a model in, the way a person would: choose it if it is offered, else switch to “Type it in” and type it. */
export async function setModel(d: HTMLElement, text: string) {
  let c = modelControl(d)
  if (c.tagName === 'SELECT') {
    if (text !== '' && modelOptions(d).includes(text)) {
      await userEvent.selectOptions(c, text)
      return
    }
    await userEvent.selectOptions(c, within(c).getByRole('option', { name: /手动输入|Type it in/ }))
    c = modelControl(d)
  }
  await type(c, text)
}
