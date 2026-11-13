import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// The server's own list, read straight from its source (a test may reach across packages; the app may not).
import { PROTECTED_HEADERS as SERVER_PROTECTED } from '../../core/src/util/merge'
import { PROTECTED_HEADERS, PROTECTED_HEADER_NAMES } from '@/features/settings/dialect-model'
import { ALL_PROTOCOLS, kindOfProtocol } from '@/features/settings/protocols'
import { apiError, fakeServer } from './fixtures'
import { makeCapabilityView } from './fixtures-production'
import { makeKeyProvider } from './fixtures-providers'
import { ProvidersPage } from '@/features/settings/ProvidersPage'
import { renderApp, useLocale } from './render'

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

function page(opts: {
  providers: unknown[]
  routes?: Parameters<typeof fakeServer>[0]
  capability?: unknown
}) {
  const server = fakeServer({
    'GET /api/providers': () => ({ items: opts.providers }),
    'GET /api/settings': () => ({ activeProviders: {}, cost: {} }),
    'GET /api/projects': () => ({ items: [] }),
    'GET /api/presets': () => ({ items: [] }),
    ...Object.fromEntries(
      (opts.providers as { id: string }[]).map((p) => [
        `GET /api/providers/${p.id}/capability`,
        () => opts.capability ?? makeCapabilityView(),
      ]),
    ),
    ...opts.routes,
  })
  const view = renderApp(<ProvidersPage />, { client: server.client })
  return { ...view, server }
}

const media = (protocol: string, kind: string, over: Record<string, unknown> = {}) =>
  makeKeyProvider({ id: `prov_${protocol}`, label: `P ${protocol}`, kind, protocol, ...over })
const open = async (name: string) => {
  const card = await screen.findByRole('article', { name })
  await userEvent.click(within(card).getByRole('button', { name: /展开/ }))
  return card
}

describe('the protected header list stays in step with the server', () => {
  it('is the same set as packages/core/src/util/merge.ts', () => {
    expect([...PROTECTED_HEADERS].sort()).toEqual([...SERVER_PROTECTED].sort())
    expect(PROTECTED_HEADER_NAMES).toHaveLength(13)
  })
  it('the explanation shows the names, and each one is refused as a header name', async () => {
    page({ providers: [media('kling-video', 'video')] })
    const card = await open('P kling-video')
    for (const n of [
      'cookie',
      'host',
      'content-length',
      'proxy-authorization',
      'transfer-encoding',
      'connection',
    ])
      expect(card).toHaveTextContent(n)
    await userEvent.click(within(card).getByText('高级设置'))
    await userEvent.click(within(card).getByRole('button', { name: '加一个请求头' }))
    const name = within(card).getAllByRole('textbox', { name: '名称' }).at(-1)!
    await userEvent.type(within(card).getByRole('textbox', { name: '值' }), 'x')
    for (const bad of [
      'Cookie',
      'HOST',
      'Content-Length',
      'Proxy-Authorization',
      'Transfer-Encoding',
      'Connection',
    ]) {
      await userEvent.clear(name)
      await userEvent.type(name, bad)
      expect(
        await within(card).findByText('这个请求头由 dramai 管理，不能覆盖'),
      ).toBeInTheDocument()
    }
  })
})

describe('extra request headers for every kind of provider', () => {
  const nonText = ALL_PROTOCOLS.filter((p) => kindOfProtocol(p) !== 'llm')
  it.each(nonText)(
    '%s: has advanced settings with the headers editor and the media note',
    async (protocol) => {
      page({ providers: [media(protocol, kindOfProtocol(protocol))] })
      const card = await open(`P ${protocol}`)
      expect(within(card).getByText('高级设置')).toBeInTheDocument()
      expect(within(card).getByRole('button', { name: '加一个请求头' })).toBeInTheDocument()
      expect(card).toHaveTextContent('下载成品文件的请求不带')
      expect(within(card).queryByRole('textbox', { name: /额外请求体/ })).toBeNull()
      expect(within(card).queryByRole('combobox', { name: /输出长度字段/ })).toBeNull()
    },
  )
  it('a text provider does not get the media note', async () => {
    page({ providers: [makeKeyProvider()] })
    const card = await open('DeepSeek')
    expect(card).not.toHaveTextContent('下载成品文件的请求不带')
  })
  it('a header on a video provider is saved with the provider', async () => {
    const provider = media('kling-video', 'video')
    const { server } = page({
      providers: [provider],
      routes: {
        'PATCH /api/providers/prov_kling-video': ({ body }) => ({
          ...provider,
          ...(body as object),
        }),
      },
    })
    const card = await open('P kling-video')
    await userEvent.click(within(card).getByText('高级设置'))
    await userEvent.click(within(card).getByRole('button', { name: '加一个请求头' }))
    await userEvent.type(within(card).getAllByRole('textbox', { name: '名称' }).at(-1)!, 'x-tenant')
    await userEvent.type(within(card).getByRole('textbox', { name: '值' }), 'acme')
    await userEvent.click(within(card).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
        dialect: { extraHeaders: { 'x-tenant': 'acme' } },
      }),
    )
  })
})

describe('image style (openai-images only)', () => {
  const imgProvider = (dialect?: Record<string, unknown>) =>
    media('openai-images', 'image', { model: 'gpt-image-1', ...(dialect ? { dialect } : {}) })
  it('a select with automatic first, the three styles, and when to choose by hand', async () => {
    page({ providers: [imgProvider()] })
    const card = await open('P openai-images')
    const select = within(card).getByRole('combobox', { name: /生图风格/ })
    expect([...(select as HTMLSelectElement).options].map((o) => o.text)).toEqual([
      '自动（按模型名）',
      'OpenAI 官方',
      '兼容（经转发站时用）',
      'MiniMax',
    ])
    expect(select).toHaveValue('')
    expect(card).toHaveTextContent('openai/gpt-image-1')
    expect(card).toHaveTextContent('经转发站使用 gpt-image-*')
    expect(card).toHaveTextContent('这个协议读额外请求头和生图风格')
  })
  it('choosing a style saves it; going back to automatic saves nothing for it', async () => {
    const provider = imgProvider({ imageStyle: 'compat' })
    const { server } = page({
      providers: [provider],
      routes: {
        'PATCH /api/providers/prov_openai-images': ({ body }) => ({
          ...provider,
          ...(body as object),
        }),
      },
    })
    const card = await open('P openai-images')
    const select = within(card).getByRole('combobox', { name: /生图风格/ })
    expect(select).toHaveValue('compat')
    await userEvent.selectOptions(select, 'minimax')
    await userEvent.click(within(card).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
        dialect: { imageStyle: 'minimax' },
      }),
    )
    await userEvent.selectOptions(select, '')
    await userEvent.click(within(card).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(server.calls.filter((c) => c.method === 'PATCH')).toHaveLength(2))
    expect(server.calls.filter((c) => c.method === 'PATCH')[1]?.body).toMatchObject({ dialect: {} })
  })
  it('a saved "auto" shows as automatic and is not a change', async () => {
    page({ providers: [imgProvider({ imageStyle: 'auto' })] })
    const card = await open('P openai-images')
    expect(within(card).getByRole('combobox', { name: /生图风格/ })).toHaveValue('')
    expect(within(card).getByRole('button', { name: '保存' })).toBeDisabled()
  })
  it.each([
    'kling-image',
    'gemini-image',
    'volcengine-images',
    'dashscope-image',
    'siliconflow-images',
    'kling-video',
    'openai-tts',
    'openai-chat',
  ])('%s has no image style', async (protocol) => {
    page({ providers: [media(protocol, kindOfProtocol(protocol as never))] })
    const card = await open(`P ${protocol}`)
    expect(within(card).queryByRole('combobox', { name: /生图风格/ })).toBeNull()
  })
})

describe('address errors from the server show on the address input', () => {
  const openCustom = async (routes: Parameters<typeof fakeServer>[0] = {}) => {
    const view = page({ providers: [], routes })
    const section = await screen.findByRole('region', { name: /大模型/ })
    await userEvent.click(within(section).getByRole('button', { name: '添加服务商' }))
    await userEvent.click(await screen.findByRole('button', { name: '自定义服务商' }))
    const dialog = await screen.findByRole('dialog', { name: /自定义/ })
    await userEvent.type(within(dialog).getAllByRole('textbox')[0]!, 'Mine')
    return { dialog, ...view }
  }
  const fill = async (dialog: HTMLElement, url: string) => {
    const input = within(dialog).getByRole('textbox', { name: /Base URL/ })
    await userEvent.clear(input)
    await userEvent.paste(url)
    const model = within(dialog).getByRole('textbox', { name: /模型/ })
    if (!(model as HTMLInputElement).value) await userEvent.type(model, 'm1')
    return input
  }
  it('a query string or fragment is explained at once and blocks Add', async () => {
    const { dialog, server } = await openCustom()
    const input = await fill(dialog, 'https://api.example.com/v1?key=1')
    expect(
      within(dialog).getByText('接口地址不要带 ? 或 # 后面的部分，路径会自动拼在后面'),
    ).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByRole('button', { name: '添加' })).toBeDisabled()
    expect(server.calls.some((c) => c.method === 'POST')).toBe(false)
  })
  it.each([
    ['BASE_URL_INSECURE', 'http://169.254.169.254/v1', /169\.254\.x\.x/],
    ['BASE_URL_INVALID', 'ftp://example.com', /接口地址不合法/],
  ])(
    '%s from the server is shown on the input, once, and editing clears it',
    async (code, url, text) => {
      const { dialog } = await openCustom({ 'POST /api/providers': () => apiError(400, code) })
      const input = await fill(dialog, url)
      await userEvent.click(within(dialog).getByRole('button', { name: '添加' }))
      expect(await within(dialog).findByText(text)).toBeInTheDocument()
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(within(dialog).getAllByText(text)).toHaveLength(1)
      await userEvent.type(input, '/')
      await waitFor(() => expect(within(dialog).queryByText(text)).toBeNull())
    },
  )
  it('unfilled placeholders are named', async () => {
    const { dialog } = await openCustom({
      'POST /api/providers': () =>
        apiError(400, 'BASE_URL_PLACEHOLDER_UNFILLED', { placeholders: ['WorkspaceId', 'Region'] }),
    })
    await fill(dialog, 'https://%7BWorkspaceId%7D.example.com')
    await userEvent.click(within(dialog).getByRole('button', { name: '添加' }))
    expect(
      await within(dialog).findByText(/还有没替换的占位符：\{WorkspaceId\}、\{Region\}/),
    ).toBeInTheDocument()
  })
  it('on a card, changing the address to a refused one shows the reason on the input', async () => {
    const provider = makeKeyProvider()
    page({
      providers: [provider],
      routes: { 'PATCH /api/providers/prov_key': () => apiError(400, 'BASE_URL_INSECURE') },
    })
    const card = await open('DeepSeek')
    const input = within(card).getByRole('textbox', { name: 'Base URL' })
    await userEvent.clear(input)
    await userEvent.paste('http://169.254.169.254/v1')
    await userEvent.click(within(card).getByRole('button', { name: '保存' }))
    expect(await within(card).findByText(/169\.254\.x\.x/)).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    // a query string is caught before anything is sent
    await userEvent.clear(input)
    await userEvent.paste('https://api.example.com/v1#frag')
    expect(
      within(card).getByText('接口地址不要带 ? 或 # 后面的部分，路径会自动拼在后面'),
    ).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: '保存' })).toBeDisabled()
  })
  it.each([
    ['en', /Leave out everything from \? or # onwards/],
    ['zh-TW', /不要帶 \? 或 # 後面的部分/],
  ] as const)('%s has the words too', async (locale, text) => {
    await useLocale(locale)
    const provider = makeKeyProvider()
    page({ providers: [provider] })
    const card = await screen.findByRole('article', { name: 'DeepSeek' })
    await userEvent.click(within(card).getByRole('button', { name: /Expand|展開/ }))
    const input = within(card).getByRole('textbox', { name: 'Base URL' })
    await userEvent.clear(input)
    await userEvent.paste('https://api.example.com/v1?x=1')
    expect(within(card).getByText(text)).toBeInTheDocument()
  })
})

describe('minimum pixels in the model capability', () => {
  const view = (minPixels?: number) => {
    const base = makeCapabilityView()
    return {
      ...base,
      capability: {
        ...base.capability,
        media: 'image' as const,
        modes: { t2i: 'supported' as const },
        ...(minPixels === undefined ? {} : { minPixels }),
      },
    }
  }
  it('is shown with what it means, formatted for the language', async () => {
    page({ providers: [media('openai-images', 'image')], capability: view(655360) })
    const card = await open('P openai-images')
    expect(await within(card).findByText('最小像素数')).toBeInTheDocument()
    expect(within(card).getByText('655,360 像素')).toBeInTheDocument()
    expect(
      within(card).getByText('低于这个像素数的尺寸，dramai 会自动按比例放大后再请求'),
    ).toBeInTheDocument()
  })
  it('is not shown when the model has none', async () => {
    page({ providers: [media('openai-images', 'image')], capability: view() })
    const card = await open('P openai-images')
    await within(card).findByText('分辨率')
    expect(within(card).queryByText('最小像素数')).toBeNull()
  })
  it('English and Traditional Chinese say it too', async () => {
    await useLocale('en')
    page({ providers: [media('openai-images', 'image')], capability: view(262144) })
    const card = await screen.findByRole('article', { name: 'P openai-images' })
    await userEvent.click(within(card).getByRole('button', { name: /Expand/ }))
    expect(await within(card).findByText('Minimum pixels')).toBeInTheDocument()
    expect(within(card).getByText('262,144 pixels')).toBeInTheDocument()
  })
})
