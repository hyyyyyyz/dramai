import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/i18n/locales/en'
import zh from '@/i18n/locales/zh-CN'
import zhTW from '@/i18n/locales/zh-TW'
import { apiError } from './fixtures'
import { makeCapabilityView } from './fixtures-production'
import { useLocale } from './render'
import {
  PROVIDERS,
  knownFor,
  modelControl,
  modelOptions,
  setModel,
  noWrites,
  openForm,
  page,
  posts,
  probed,
  type,
  type Kind,
} from './add-provider-kit'

/**
 * The optional questions the "Add provider" form can ask before anything is saved: list the models, test the
 * connection (`providers.probe`), and the suggestions from the model data (`models.known`). Every answer here is what
 * the real server answered (fixtures/add-provider/recorded-probe.json, made by record-probe.mjs).
 */

const setLocale = useLocale
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

type Case = keyof typeof probed.probes
const P = probed.probes
const KEY = 'sk-record-123456789012'
const replay = (name: Case) => () => P[name].response
const probeCalls = (server: ReturnType<typeof page>['server']) =>
  server.calls.filter((c) => c.method === 'POST' && c.path === '/api/providers/probe')
/** Every write except the probes themselves. */
const otherWrites = (server: ReturnType<typeof page>['server']) =>
  noWrites(server).filter((c) => c.path !== '/api/providers/probe')
const listButton = (d: HTMLElement) => within(d).getByRole('button', { name: '获取模型列表' })
const testButton = (d: HTMLElement) => within(d).getByRole('button', { name: '测试连接' })
/** A response that is held back until `release()`. */
const gate = <T,>(value: () => T) => {
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  return { release, answer: async () => (await held, value()) }
}

async function fill(
  d: HTMLElement,
  opts: { protocol?: string; url: string; key?: string; model?: string; none?: boolean },
) {
  if (opts.protocol)
    await userEvent.selectOptions(
      within(d).getByRole('combobox', { name: /API 协议/ }),
      opts.protocol,
    )
  await type(within(d).getByRole('textbox', { name: /Base URL/ }), opts.url)
  if (opts.none) await userEvent.click(within(d).getByRole('radio', { name: '无需鉴权' }))
  else if (opts.key) await userEvent.type(within(d).getByLabelText('API Key'), opts.key)
  if (opts.model) await setModel(d, opts.model)
}

describe('list the models of a draft', () => {
  it('large model: the request is the recorded one, the models become the choices, a model that is not in the list can still be typed, and only the add writes anything', async () => {
    const { request, response } = P['llm.models']
    const { server } = page({
      routes: {
        'POST /api/providers/probe': replay('llm.models'),
        'POST /api/providers': () => PROVIDERS.llm.stored,
      },
    })
    const d = await openForm('llm')
    await fill(d, { url: request.baseUrl, key: KEY })
    await userEvent.click(listButton(d))
    expect(await within(d).findByText(/取到 2 个模型/)).toBeInTheDocument()
    expect(probeCalls(server).map((c) => c.body)).toEqual([request])
    expect(modelOptions(d)).toEqual(
      (response as { items: { id: string }[] }).items.map((m) => m.id),
    )
    // choosing = typing one of them; typing another is allowed too
    await setModel(d, 'a-model-that-is-not-listed')
    await type(within(d).getByRole('textbox', { name: /名称/ }), 'Mine')
    await userEvent.click(within(d).getByRole('button', { name: '添加' }))
    await waitFor(() => expect(posts(server)).toHaveLength(1))
    expect(posts(server)[0]!.body).toMatchObject({ model: 'a-model-that-is-not-listed' })
    expect(otherWrites(server).map((c) => c.path)).toEqual(['/api/providers'])
  })

  it('asking creates nothing: the two buttons write nothing but the probe, and the provider list is not even re-read', async () => {
    const { server } = page({
      routes: {
        'POST /api/providers/probe': ({ body }) =>
          (body as { action: string }).action === 'models'
            ? P['llm.models'].response
            : P['llm.test'].response,
      },
    })
    const d = await openForm('llm')
    await fill(d, { url: 'https://llm.example.com/v1', key: KEY, model: 'text-model-1' })
    await userEvent.click(listButton(d))
    await within(d).findByText(/取到 2 个模型/)
    await userEvent.click(testButton(d))
    await within(d).findByText('连接成功')
    expect(probeCalls(server)).toHaveLength(2)
    expect(otherWrites(server)).toEqual([])
    expect(
      server.calls.filter((c) => c.method === 'GET' && c.path === '/api/providers'),
    ).toHaveLength(1)
    expect(screen.queryAllByRole('article')).toHaveLength(0)
  })

  it('no model list for the interface type is not an error: a neutral line, and the suggestions from the model data stay', async () => {
    const { server } = page({
      routes: { 'POST /api/providers/probe': replay('image.models.noList') },
    })
    const d = await openForm('image')
    await fill(d, { protocol: 'kling-image', url: 'https://kimg.example.com', key: KEY })
    await userEvent.click(listButton(d))
    expect(
      await within(d).findByText('这个接口类型没有模型列表接口，可以从下面的候选里选，或手动填写'),
    ).toBeInTheDocument()
    expect(within(d).queryByRole('alert')).toBeNull()
    expect(modelOptions(d)).toEqual(knownFor('image', 'kling-image').map((m) => m.id))
    expect(probeCalls(server)).toHaveLength(1)
  })

  it.each([
    ['llm.models.unauthorized', 'HTTP 401'],
    ['llm.models.network', 'fetch failed'],
    ['llm.models.timeout', '请求超时'],
  ] as const)(
    '%s: the failure is shown in the form, with the explanation for its code, and nothing typed is lost',
    async (name, detail) => {
      const { request } = P[name]
      page({ routes: { 'POST /api/providers/probe': replay(name) } })
      const d = await openForm('llm')
      await type(within(d).getByRole('textbox', { name: /名称/ }), 'Mine')
      await fill(d, { url: request.baseUrl, key: request.auth.apiKey ?? KEY, model: 'my-model' })
      await userEvent.click(listButton(d))
      const alert = await within(d).findByRole('alert')
      expect(alert).toHaveTextContent('连接失败')
      expect(alert).toHaveTextContent(detail)
      expect(within(alert).getByTestId('provider-error')).toBeInTheDocument() // the same explanation a failed task gets
      expect(screen.getByRole('dialog', { name: /添加服务商/ })).toBeInTheDocument()
      expect(within(d).getByRole('textbox', { name: /名称/ })).toHaveValue('Mine')
      expect(modelControl(d)).toHaveValue('my-model')
      expect(within(d).getByLabelText('API Key')).toHaveValue(request.auth.apiKey ?? KEY)
      // never the key: not in the page text, and the server's own echo of it is already redacted
      expect(document.body.textContent).not.toContain('sk-bad')
      expect(document.body.textContent).not.toContain(KEY)
    },
  )

  it.each(Object.entries(probed.refused))(
    'the server refusing the address (%s) is shown on the address, once, and not as a second notice',
    async (_name, refusal) => {
      const r = refusal as { status: number; code: string; details?: unknown }
      const { server } = page({
        routes: { 'POST /api/providers/probe': () => apiError(r.status, r.code, r.details) },
      })
      const d = await openForm('llm')
      await fill(d, { url: 'http://169.254.169.254/v1', key: KEY })
      await userEvent.click(listButton(d))
      const address = within(d).getByRole('textbox', { name: /Base URL/ })
      await waitFor(() => expect(address).toHaveAttribute('aria-invalid', 'true'))
      expect(within(d).getAllByRole('alert')).toHaveLength(1)
      expect(probeCalls(server)).toHaveLength(1)
      await userEvent.type(address, '/')
      await waitFor(() => expect(address).not.toHaveAttribute('aria-invalid', 'true'))
    },
  )
})

describe('suggestions from the model data', () => {
  it('a kind that has some shows them in a visible drop-down, in the order the server gave, with “Choose a model” first and nothing marked or moved', async () => {
    page()
    const d = await openForm('image')
    await waitFor(() =>
      expect(modelOptions(d)).toEqual(knownFor('image', 'openai-images').map((m) => m.id)),
    )
    const select = modelControl(d)
    expect(select.tagName).toBe('SELECT')
    expect(select).toHaveValue('') // nothing is chosen for the user
    expect(within(select).getAllByRole('option')[0]).toHaveTextContent('请选择')
    expect(within(d).getByText(/候选只是方便选择，不是限制/)).toBeInTheDocument()
    expect(d.textContent).not.toMatch(/推荐|推薦|recommend|常用|popular/i)
  })

  it('the suggestions show the model id and nothing else: no display names, in the markup or on screen', async () => {
    page()
    const d = await openForm('image')
    await waitFor(() => expect(modelOptions(d).length).toBeGreaterThan(0))
    const names = knownFor('image', 'openai-images')
      .map((m) => m.displayName)
      .filter((n): n is string => !!n)
    expect(names.length).toBeGreaterThan(0) // the data does carry display names
    for (const o of within(modelControl(d)).getAllByRole('option')) {
      const v = o.getAttribute('value') ?? ''
      if (v !== '' && !v.startsWith('__dramai')) expect(o.textContent).toBe(v)
    }
    for (const n of names) expect(d.innerHTML).not.toContain(n)
  })

  it('a list the provider sent shows ids only too, whatever labels it came with', async () => {
    const r = P['llm.models'].response as {
      outcome: 'models'
      items: { id: string; label: string }[]
    }
    page({
      routes: {
        'POST /api/providers/probe': () => ({
          ...r,
          items: r.items.map((m) => ({ ...m, label: `Some Product Name for ${m.id}` })),
        }),
      },
    })
    const d = await openForm('llm')
    await fill(d, { url: 'https://llm.example.com/v1', key: KEY })
    await userEvent.click(listButton(d))
    await within(d).findByText(/取到 2 个模型/)
    expect(modelOptions(d)).toEqual(r.items.map((m) => m.id))
    expect(d.innerHTML).not.toContain('Some Product Name')
    for (const id of modelOptions(d))
      expect(within(modelControl(d)).getByRole('option', { name: id })).toBeInTheDocument()
  })

  it('a kind with none (large model) has a plain box: no drop-down, no empty shell', async () => {
    const { server } = page()
    const d = await openForm('llm')
    await waitFor(() => expect(server.calls.some((c) => c.path === '/api/models/known')).toBe(true))
    expect(modelControl(d).tagName).toBe('INPUT')
    expect(modelOptions(d)).toEqual([])
    expect(within(d).queryByRole('button', { name: '从列表选择' })).toBeNull()
    expect(within(d).getByText(/填服务商接口文档里的模型名/)).toBeInTheDocument()
  })

  it('changing the interface type shows the suggestions of that type, not the previous one’s', async () => {
    page()
    const d = await openForm('video')
    const type_ = within(d).getByRole('combobox', { name: /API 协议/ })
    await userEvent.selectOptions(type_, 'kling-contents')
    await waitFor(() =>
      expect(modelOptions(d)).toEqual(knownFor('video', 'kling-contents').map((m) => m.id)),
    )
    await userEvent.selectOptions(type_, 'dashscope-video')
    await waitFor(() =>
      expect(modelOptions(d)).toEqual(knownFor('video', 'dashscope-video').map((m) => m.id)),
    )
  })

  it('the suggestions are not a whitelist: any typed model is added as typed', async () => {
    const { server } = page({ routes: { 'POST /api/providers': () => PROVIDERS.tts.stored } })
    const d = await openForm('tts')
    await waitFor(() => expect(modelOptions(d).length).toBeGreaterThan(0))
    await type(within(d).getByRole('textbox', { name: /名称/ }), 'V')
    await fill(d, { url: 'https://tts.example.com/v1', key: KEY, model: 'not-a-suggestion' })
    await userEvent.click(within(d).getByRole('button', { name: '添加' }))
    await waitFor(() => expect(posts(server)).toHaveLength(1))
    expect(posts(server)[0]!.body).toMatchObject({ model: 'not-a-suggestion' })
  })
})

describe('test the connection of a draft', () => {
  it.each([
    ['llm', 'openai-chat', 'llm.test', '连接成功', 'https://llm.example.com/v1'],
    ['image', 'openai-images', 'image.test', '连接成功', 'https://img.example.com/v1'],
    ['tts', 'openai-tts', 'tts.test', '连接成功', 'https://tts.example.com/v1'],
    ['image', 'kling-image', 'image.test.unverifiable', '无法自动验证', 'https://kimg.example.com'],
    [
      'video',
      'kling-contents',
      'video.test.unverifiable',
      '无法自动验证',
      'https://video.example.com',
    ],
    ['tts', 'minimax-t2a', 'tts.test.unverifiable', '无法自动验证', 'https://mtts.example.com/v1'],
  ] as const)('%s / %s: %s', async (kind, protocol, name, words, url) => {
    const { request } = P[name]
    const { server } = page({ routes: { 'POST /api/providers/probe': replay(name) } })
    const d = await openForm(kind as Kind)
    await fill(d, { protocol, url, key: KEY, model: 'model-x' })
    await userEvent.click(testButton(d))
    expect(await within(d).findByText(new RegExp(words))).toBeInTheDocument()
    expect(probeCalls(server)).toHaveLength(1)
    expect(probeCalls(server)[0]!.body).toEqual({ ...request, model: 'model-x' })
    // an unverifiable draft is a neutral note, a status and not an alert
    if (words === '无法自动验证') expect(within(d).queryByRole('alert')).toBeNull()
    expect(otherWrites(server)).toEqual([])
  })

  it('a model that is not in the provider’s list is called out, and the test is not needed to add', async () => {
    const { server } = page({
      routes: {
        'POST /api/providers/probe': replay('llm.testModelMissing'),
        'POST /api/providers': () => PROVIDERS.llm.stored,
      },
    })
    const d = await openForm('llm')
    await fill(d, { url: 'https://llm.example.com/v1', key: KEY, model: 'not-in-the-list' })
    await userEvent.click(testButton(d))
    expect(await within(d).findByText(/没有找到你填的型号/)).toBeInTheDocument()
    await type(within(d).getByRole('textbox', { name: /名称/ }), 'Mine')
    await userEvent.click(within(d).getByRole('button', { name: '添加' }))
    await waitFor(() => expect(posts(server)).toHaveLength(1))
  })

  it('a failed test shows the failure and its explanation; the form stays', async () => {
    page({ routes: { 'POST /api/providers/probe': replay('llm.test.unauthorized') } })
    const d = await openForm('llm')
    await fill(d, { url: 'https://llm.example.com/v1', key: 'sk-bad-123456789012', model: 'm' })
    await userEvent.click(testButton(d))
    const alert = await within(d).findByRole('alert')
    expect(alert).toHaveTextContent('连接失败')
    expect(alert).toHaveTextContent('HTTP 401')
    expect(document.body.textContent).not.toContain('sk-bad')
    expect(screen.getByRole('dialog', { name: /添加服务商/ })).toBeInTheDocument()
  })

  it('works without a model typed: the request has none', async () => {
    const { server } = page({ routes: { 'POST /api/providers/probe': replay('llm.test') } })
    const d = await openForm('llm')
    await fill(d, { url: 'https://llm.example.com/v1', key: KEY })
    await userEvent.click(testButton(d))
    await within(d).findByText('连接成功')
    expect(probeCalls(server)[0]!.body).not.toHaveProperty('model')
  })
})

describe('what is needed first, and sign-in', () => {
  it('both buttons stay off until the address and, with an API key, the key are there; the line says what is missing', async () => {
    const { server } = page()
    const d = await openForm('llm')
    expect(listButton(d)).toBeDisabled()
    expect(testButton(d)).toBeDisabled()
    expect(
      within(d).getByText('要先填好：接口地址、API Key，才能获取模型列表或测试连接'),
    ).toBeInTheDocument()
    await userEvent.type(
      within(d).getByRole('textbox', { name: /Base URL/ }),
      'https://a.example.com/v1',
    )
    expect(within(d).getByText('要先填好：API Key，才能获取模型列表或测试连接')).toBeInTheDocument()
    expect(listButton(d)).toBeDisabled()
    await userEvent.type(within(d).getByLabelText('API Key'), KEY)
    expect(listButton(d)).toBeEnabled()
    expect(testButton(d)).toBeEnabled()
    expect(within(d).queryByText(/要先填好/)).toBeNull()
    expect(probeCalls(server)).toHaveLength(0)
  })

  it('without authentication no key is asked for, and the request says so', async () => {
    const { server } = page({ routes: { 'POST /api/providers/probe': replay('llm.models.none') } })
    const d = await openForm('llm')
    await fill(d, { url: 'http://127.0.0.1:1234/v1', none: true })
    expect(listButton(d)).toBeEnabled()
    await userEvent.click(listButton(d))
    await within(d).findByText(/取到 2 个模型/)
    expect(probeCalls(server)[0]!.body).toEqual(P['llm.models.none'].request)
  })

  it.each(['openai-chatgpt', 'openrouter'] as const)(
    'signing in with %s: both buttons are off and say to add first and sign in on the card; the suggested model stays editable; no request',
    async (channel) => {
      const c = probed.loginChannels.find((x) => x.channel === channel)!
      const { server } = page()
      const d = await openForm('llm')
      await userEvent.selectOptions(
        within(d).getByRole('combobox', { name: /API 协议/ }),
        c.protocol,
      )
      await userEvent.click(within(d).getByRole('radio', { name: '账号登录' }))
      expect(listButton(d)).toBeDisabled()
      expect(testButton(d)).toBeDisabled()
      expect(
        within(d).getByText('账号登录要先添加，之后在服务商卡片上登录，再获取模型列表'),
      ).toBeInTheDocument()
      expect(modelControl(d)).toHaveValue(c.suggestedModel)
      await setModel(d, 'my-own')
      await userEvent.click(listButton(d))
      await userEvent.click(testButton(d))
      expect(probeCalls(server)).toHaveLength(0)
    },
  )

  it('if the server says “login after save” anyway, the form says the same', async () => {
    page({ routes: { 'POST /api/providers/probe': replay('login.chatgpt.models') } })
    const d = await openForm('llm')
    await fill(d, { url: 'https://llm.example.com/v1', key: KEY })
    await userEvent.click(listButton(d))
    expect(
      (await within(d).findAllByText('账号登录要先添加，之后在服务商卡片上登录，再获取模型列表'))
        .length,
    ).toBeGreaterThan(0)
  })

  it('the login channels come from their own call, and the preset list is never read', async () => {
    const { server } = page()
    const d = await openForm('llm')
    await userEvent.click(within(d).getByRole('radio', { name: '账号登录' }))
    expect(server.calls.some((c) => c.path === '/api/login-channels')).toBe(true)
    expect(server.calls.some((c) => c.path === '/api/presets')).toBe(false)
  })
})

describe('an answer belongs to the draft it was asked for', () => {
  const listed = (d: HTMLElement) => within(d).queryByText(/取到 \d+ 个模型/)
  const base = { url: 'https://llm.example.com/v1', key: KEY }

  it.each([
    [
      'the address',
      async (d: HTMLElement) =>
        userEvent.type(within(d).getByRole('textbox', { name: /Base URL/ }), '/x'),
    ],
    ['the key', async (d: HTMLElement) => userEvent.type(within(d).getByLabelText('API Key'), 'x')],
    [
      'the interface type',
      async (d: HTMLElement) =>
        userEvent.selectOptions(
          within(d).getByRole('combobox', { name: /API 协议/ }),
          'anthropic-messages',
        ),
    ],
    [
      'the authentication',
      async (d: HTMLElement) => userEvent.click(within(d).getByRole('radio', { name: '无需鉴权' })),
    ],
  ] as const)('changing %s drops the list that was fetched', async (_what, change) => {
    page({ routes: { 'POST /api/providers/probe': replay('llm.models') } })
    const d = await openForm('llm')
    await fill(d, base)
    await userEvent.click(listButton(d))
    await within(d).findByText(/取到 2 个模型/)
    expect(modelOptions(d)).toEqual(['text-model-1', 'text-model-2'])
    await change(d)
    expect(listed(d)).toBeNull()
    expect(modelOptions(d)).toEqual([])
  })

  it('a test result is dropped when the model it was run for changes', async () => {
    page({ routes: { 'POST /api/providers/probe': replay('llm.test') } })
    const d = await openForm('llm')
    await fill(d, { ...base, model: 'text-model-1' })
    await userEvent.click(testButton(d))
    await within(d).findByText('连接成功')
    await userEvent.type(modelControl(d), '2')
    expect(within(d).queryByText('连接成功')).toBeNull()
  })

  it('a late answer for an address that has since been changed is not shown', async () => {
    const g = gate(() => P['llm.models'].response)
    const { server } = page({ routes: { 'POST /api/providers/probe': g.answer } })
    const d = await openForm('llm')
    await fill(d, base)
    await userEvent.click(listButton(d))
    await waitFor(() => expect(probeCalls(server)).toHaveLength(1))
    await userEvent.type(within(d).getByRole('textbox', { name: /Base URL/ }), '/changed')
    g.release()
    await new Promise((r) => setTimeout(r, 50))
    expect(listed(d)).toBeNull()
    expect(modelOptions(d)).toEqual([])
    expect(listButton(d)).toBeEnabled()
  })

  it('an old answer that arrives after a newer one does not overwrite it', async () => {
    const first = gate(() => P['llm.models'].response)
    let n = 0
    const { server } = page({
      routes: {
        'POST /api/providers/probe': () => {
          n++
          return n === 1
            ? first.answer()
            : { outcome: 'models', items: [{ id: 'b-model', label: 'b-model' }] }
        },
      },
    })
    const d = await openForm('llm')
    await fill(d, base)
    await userEvent.click(listButton(d)) // asked for draft A, held back
    const address = within(d).getByRole('textbox', { name: /Base URL/ })
    await userEvent.type(address, '/b')
    await userEvent.click(listButton(d)) // asked for draft B, answered at once
    await waitFor(() => expect(modelOptions(d)).toEqual(['b-model']))
    await userEvent.type(address, '{Backspace}{Backspace}') // back to draft A
    first.release()
    await new Promise((r) => setTimeout(r, 50))
    // A's answer is the older request: it must not replace anything or show for a draft it no longer matches
    expect(probeCalls(server)).toHaveLength(2)
    expect(modelOptions(d)).not.toEqual(['text-model-1', 'text-model-2'])
  })

  it('closing the form drops everything: the key, the list, the test result; the next form is empty, and a late answer goes nowhere', async () => {
    const g = gate(() => P['llm.models'].response)
    const { server } = page({ routes: { 'POST /api/providers/probe': g.answer } })
    let d = await openForm('llm')
    await fill(d, base)
    await userEvent.click(listButton(d))
    await waitFor(() => expect(probeCalls(server)).toHaveLength(1))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    d = await openForm('llm')
    g.release()
    await new Promise((r) => setTimeout(r, 50))
    expect(within(d).getByLabelText('API Key')).toHaveValue('')
    expect(within(d).getByRole('textbox', { name: /Base URL/ })).toHaveValue('')
    expect(listed(d)).toBeNull()
    expect(modelOptions(d)).toEqual([])
    expect(listButton(d)).toBeDisabled()
    expect(otherWrites(server)).toEqual([])
  })

  it('a finished list and test survive closing nothing: cancel, close and Esc all start the next form clean', async () => {
    page({
      routes: {
        'POST /api/providers/probe': ({ body }) =>
          (body as { action: string }).action === 'models'
            ? P['llm.models'].response
            : P['llm.test'].response,
      },
    })
    for (const how of ['cancel', 'close', 'esc'] as const) {
      const d = await openForm('llm')
      await fill(d, { ...base, model: 'text-model-1' })
      await userEvent.click(listButton(d))
      await userEvent.click(testButton(d))
      await within(d).findByText('连接成功')
      if (how === 'cancel') await userEvent.click(within(d).getByRole('button', { name: '取消' }))
      if (how === 'close') await userEvent.click(within(d).getByRole('button', { name: '关闭' }))
      if (how === 'esc') await userEvent.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    }
    const again = await openForm('llm')
    expect(within(again).queryByText('连接成功')).toBeNull()
    expect(modelOptions(again)).toEqual([])
    expect(within(again).getByLabelText('API Key')).toHaveValue('')
  })
})

describe('one request at a time, each by itself', () => {
  const base = { url: 'https://llm.example.com/v1', key: KEY, model: 'text-model-1' }

  it('the model list asked for again and again while it is out is asked once', async () => {
    const g = gate(() => P['llm.models'].response)
    const { server } = page({ routes: { 'POST /api/providers/probe': g.answer } })
    const d = await openForm('llm')
    await fill(d, base)
    const b = listButton(d)
    await userEvent.click(b)
    await userEvent.click(b)
    b.focus()
    await userEvent.keyboard('{Enter}{Enter} ')
    expect(probeCalls(server)).toHaveLength(1)
    g.release()
    await within(d).findByText(/取到 2 个模型/)
    expect(probeCalls(server)).toHaveLength(1)
  })

  it('the test asked for again and again while it is out is asked once', async () => {
    const g = gate(() => P['llm.test'].response)
    const { server } = page({ routes: { 'POST /api/providers/probe': g.answer } })
    const d = await openForm('llm')
    await fill(d, base)
    const b = testButton(d)
    await userEvent.click(b)
    await userEvent.click(b)
    b.focus()
    await userEvent.keyboard('{Enter}{Enter}')
    expect(probeCalls(server)).toHaveLength(1)
    g.release()
    await within(d).findByText('连接成功')
    expect(probeCalls(server)).toHaveLength(1)
  })

  it.each([
    ['models', listButton, 'llm.models'],
    ['test', testButton, 'llm.test'],
  ] as const)(
    'two clicks in the same frame, before anything has rendered, ask %s once',
    async (_a, button, name) => {
      const g = gate(() => P[name].response)
      const { server } = page({ routes: { 'POST /api/providers/probe': g.answer } })
      const d = await openForm('llm')
      await fill(d, base)
      const b = button(d)
      act(() => {
        b.click()
        b.click()
        b.click()
      })
      await waitFor(() => expect(probeCalls(server)).toHaveLength(1))
      g.release()
      await new Promise((r) => setTimeout(r, 50))
      expect(probeCalls(server)).toHaveLength(1)
    },
  )

  it('the three do not trigger each other: the list and the test are one request each, and Enter in the model box adds', async () => {
    const list = gate(() => P['llm.models'].response)
    const tst = gate(() => P['llm.test'].response)
    const { server } = page({
      routes: {
        'POST /api/providers/probe': ({ body }) =>
          (body as { action: string }).action === 'models' ? list.answer() : tst.answer(),
        'POST /api/providers': () => PROVIDERS.llm.stored,
      },
    })
    const d = await openForm('llm')
    await fill(d, base)
    await type(within(d).getByRole('textbox', { name: /名称/ }), 'Mine')
    await userEvent.click(listButton(d))
    await userEvent.click(testButton(d))
    expect(probeCalls(server).map((c) => (c.body as { action: string }).action)).toEqual([
      'models',
      'test',
    ])
    // Enter in the model box is the add, not another question
    await userEvent.click(modelControl(d))
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(posts(server)).toHaveLength(1))
    expect(probeCalls(server)).toHaveLength(2)
    list.release()
    tst.release()
  })

  it('adding stays one request even with the questions out', async () => {
    const g = gate(() => PROVIDERS.llm.stored)
    const { server } = page({ routes: { 'POST /api/providers': g.answer } })
    const d = await openForm('llm')
    await fill(d, base)
    await type(within(d).getByRole('textbox', { name: /名称/ }), 'Mine')
    await userEvent.keyboard('{Enter}{Enter}{Enter}')
    await userEvent.click(within(d).getByRole('button', { name: '添加' }))
    expect(posts(server)).toHaveLength(1)
    g.release()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /添加服务商/ })).toBeNull())
    expect(posts(server)).toHaveLength(1)
  })
})

describe('the four kinds, from the first question to the add', () => {
  it.each([
    ['llm', 'llm.models', 'text-model-2'],
    ['image', 'image.models', undefined],
    ['video', 'video.models.noList', undefined],
    ['tts', 'tts.models', undefined],
  ] as const)(
    '%s: ask, choose or type a model, add; the added provider is the recorded one',
    async (kind, name, listedChoice) => {
      const { request } = P[name]
      const created = PROVIDERS[kind]
      const { server, setList } = page({
        routes: {
          'POST /api/providers/probe': replay(name),
          'POST /api/providers': () => {
            setList([created.stored])
            return created.stored
          },
          [`GET /api/providers/${created.stored.id}/capability`]: () => makeCapabilityView(),
        },
      })
      const d = await openForm(kind)
      await type(within(d).getByRole('textbox', { name: /名称/ }), created.request.label)
      await fill(d, { protocol: request.protocol, url: request.baseUrl, key: KEY })
      await userEvent.click(listButton(d))
      await waitFor(() => expect(probeCalls(server)).toHaveLength(1))
      await waitFor(() =>
        expect(modelOptions(d).length).toBeGreaterThanOrEqual(listedChoice ? 2 : 0),
      )
      const choice = listedChoice ?? modelOptions(d)[0] ?? 'typed-model'
      await setModel(d, choice)
      await userEvent.click(within(d).getByRole('button', { name: '添加' }))
      await waitFor(() => expect(posts(server)).toHaveLength(1))
      expect(posts(server)[0]!.body).toMatchObject({
        kind,
        protocol: request.protocol,
        baseUrl: request.baseUrl,
        model: choice,
        auth: { type: 'api_key' },
        apiKey: KEY,
      })
      expect(otherWrites(server).map((c) => c.path)).toEqual(['/api/providers'])
    },
  )
})

describe('the three languages and what a screen reader hears', () => {
  it.each([
    ['zh-CN', zh],
    ['zh-TW', zhTW],
    ['en', en],
  ] as const)('%s: the buttons, hints and results are in that language', async (lang, dict) => {
    await setLocale(lang)
    page({ routes: { 'POST /api/providers/probe': replay('llm.models') } })
    const add = (await screen.findAllByRole('button', { name: dict.providers.add.label }))[0]!
    await userEvent.click(add)
    const d = await screen.findByRole('dialog')
    const list = within(d).getByRole('button', { name: dict.providerLogin.models.fetch })
    const test = within(d).getByRole('button', { name: dict.providers.test.action })
    expect(list).toBeDisabled()
    expect(test).toBeDisabled()
    const field = (re: RegExp) => within(d).getByRole('textbox', { name: re })
    await userEvent.type(field(/Base URL/), 'https://llm.example.com/v1')
    await userEvent.type(within(d).getByLabelText('API Key'), KEY)
    await userEvent.click(list)
    const note = dict.providers.add.probe.listed.replace('{{count}}', '2')
    expect(await within(d).findByText(note)).toBeInTheDocument()
    expect(within(d).getByRole('status')).toHaveTextContent(note)
    await setLocale('zh-CN')
  })

  it('the new strings name no vendor and recommend nothing', () => {
    const vendors =
      /302|deepseek|openai|aliyun|alibaba|阿里|minimax|kling|可灵|volc|火山|siliconflow|硅基|gemini|claude|anthropic|qwen|通义|豆包|bytedance|zhipu|智谱|moonshot|kimi/i
    for (const dict of [zh, zhTW, en]) {
      const text = JSON.stringify(dict.providers.add)
      expect(text).not.toMatch(vendors)
      expect(text).not.toMatch(/推荐|推薦|recommend|常用|popular/i)
    }
  })
})
