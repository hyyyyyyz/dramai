import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ADDABLE_PROTOCOLS_BY_KIND, PROTOCOLS_BY_KIND } from '@/features/settings/protocols'
import en from '@/i18n/locales/en'
import zh from '@/i18n/locales/zh-CN'
import zhTW from '@/i18n/locales/zh-TW'
import { apiError } from './fixtures'
import { makeCapabilityView } from './fixtures-production'
import { useLocale } from './render'
import {
  LOGIN_CHANNELS,
  PROVIDERS,
  noWrites,
  openForm,
  page,
  posts,
  recorded,
  setModel,
  type,
  type Kind,
} from './add-provider-kit'

// `useLocale` only switches the language; it is not a hook, so it may be called in a loop
const setLocale = useLocale

/**
 * "Add provider" opens one form, with no catalogue in front of it. Every response here is what the real server
 * answered to the request the form sends (fixtures/add-provider/recorded.json, made by record.mjs).
 */

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

describe('the form opens at once, with nothing in front of it', () => {
  it('no catalogue: no search, no vendor groups, no second entry for a “custom” provider', async () => {
    page()
    const dialog = await openForm()
    expect(within(dialog).queryByRole('searchbox')).toBeNull()
    expect(within(dialog).queryByRole('region')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /自定义服务商/ })).toBeNull()
    expect(within(dialog).getByRole('textbox', { name: /名称/ })).toHaveFocus()
  })

  it('the address placeholder names no one, and a line says where to find the address', async () => {
    page()
    const dialog = await openForm()
    const address = within(dialog).getByRole('textbox', { name: /Base URL/ })
    expect(address).toHaveAttribute('placeholder', 'https://你的服务地址/v1')
    expect(address).toHaveValue('')
    expect(within(dialog).getByText('地址见服务商的接口文档')).toBeInTheDocument()
  })

  it('works when the sign-in channels cannot be read: only the sign-in option goes away', async () => {
    page({ routes: { 'GET /api/login-channels': () => apiError(500, 'INTERNAL') } })
    const dialog = await openForm()
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /API 协议/ }),
      'openai-responses',
    )
    expect(within(dialog).queryByRole('radio', { name: '账号登录' })).toBeNull()
    expect(within(dialog).getByRole('radio', { name: 'API Key' })).toBeChecked()
  })
})

describe('the interface types that can be added', () => {
  const options = async (kind: Kind) => {
    const d = await openForm(kind)
    return within(within(d).getByRole('combobox', { name: /API 协议/ }))
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value)
  }
  it.each(['llm', 'image', 'tts'] as const)(
    '%s: the drop-down is the full list, as it was',
    async (kind) => {
      page()
      expect(await options(kind)).toEqual([...PROTOCOLS_BY_KIND[kind]])
    },
  )
  it('video: the three that cannot work against the vendors’ own addresses are not offered; the rest keep their order, and the first of them is the default', async () => {
    page()
    const d = await openForm('video')
    const select = within(d).getByRole('combobox', { name: /API 协议/ })
    const values = within(select)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value)
    expect(values).toEqual(
      PROTOCOLS_BY_KIND.video.filter(
        (p) => !['aliyun-video', 'volcengine-video', 'kling-video'].includes(p),
      ),
    )
    expect(values).not.toContain('aliyun-video')
    expect(values).not.toContain('volcengine-video')
    expect(values).not.toContain('kling-video')
    expect(values).toEqual(['generic-video', 'ark-video', 'kling-contents', 'dashscope-video'])
    expect(select).toHaveValue(values[0])
    expect(d.textContent).not.toMatch(/推荐|推薦|recommend/i)
  })
  it('the full list and the names are untouched: every protocol still has its name in the three languages', () => {
    for (const dict of [zh, zhTW, en])
      for (const kind of Object.keys(PROTOCOLS_BY_KIND) as Kind[])
        for (const p of PROTOCOLS_BY_KIND[kind])
          expect((dict.protocol as Record<string, string>)[p], p).toBeTruthy()
  })
})

describe.each(['llm', 'image', 'video', 'tts'] as const)('adding a %s provider', (kind) => {
  const { request, stored } = PROVIDERS[kind === 'llm' ? 'llm' : kind]

  it('lists that kind’s protocols in the existing order, and sends exactly what was typed', async () => {
    const { server, setList } = page({
      routes: {
        'POST /api/providers': () => {
          setList([stored])
          return stored
        },
        [`GET /api/providers/${stored.id}/capability`]: () => makeCapabilityView(),
      },
    })
    const dialog = await openForm(kind)
    const protocol = within(dialog).getByRole('combobox', { name: /API 协议/ })
    expect(
      within(protocol)
        .getAllByRole('option')
        .map((o) => (o as HTMLOptionElement).value),
    ).toEqual([...ADDABLE_PROTOCOLS_BY_KIND[kind]])

    await type(within(dialog).getByRole('textbox', { name: /名称/ }), request.label)
    await userEvent.selectOptions(protocol, request.protocol)
    await type(within(dialog).getByRole('textbox', { name: /Base URL/ }), request.baseUrl)
    await userEvent.type(within(dialog).getByLabelText('API Key'), request.apiKey!)
    await setModel(dialog, request.model)
    await userEvent.click(within(dialog).getByRole('button', { name: '添加' }))

    await waitFor(() => expect(posts(server)).toHaveLength(1))
    expect(posts(server)[0]!.body).toEqual(request)
    expect(await screen.findByText(`已添加「${stored.label}」`)).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /添加服务商/ })).toBeNull()
    expect(await screen.findByRole('article', { name: stored.label })).toBeInTheDocument()
    // nothing but the one POST changed anything: no second request to patch the provider, no request for a model list
    expect(noWrites(server).map((c) => `${c.method} ${c.path}`)).toEqual(['POST /api/providers'])
    expect(server.calls.some((c) => c.path.endsWith('/models'))).toBe(false)
  })
})

describe('required inputs', () => {
  it('Add stays off until name, address and model are all filled, and nothing is sent before then', async () => {
    const { server } = page()
    const dialog = await openForm()
    const add = within(dialog).getByRole('button', { name: '添加' })
    expect(add).toBeDisabled()
    await userEvent.type(within(dialog).getByRole('textbox', { name: /名称/ }), 'X')
    expect(add).toBeDisabled()
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /Base URL/ }),
      'https://a.example.com/v1',
    )
    expect(add).toBeDisabled()
    await setModel(dialog, 'm')
    expect(add).toBeEnabled()
    await setModel(dialog, '')
    expect(add).toBeDisabled()
    expect(noWrites(server)).toEqual([])
  })

  it('an address with a query string is explained at once and blocks Add', async () => {
    const { server } = page()
    const dialog = await openForm()
    await userEvent.type(within(dialog).getByRole('textbox', { name: /名称/ }), 'X')
    await setModel(dialog, 'm')
    const address = within(dialog).getByRole('textbox', { name: /Base URL/ })
    await userEvent.type(address, 'https://a.example.com/v1?key=1')
    expect(address).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByRole('button', { name: '添加' })).toBeDisabled()
    expect(noWrites(server)).toEqual([])
  })

  it.each(Object.entries(recorded.refused))(
    'the server refusing the address (%s) is shown on the address, once, and nothing is created',
    async (_name, refusal) => {
      const { server } = page({
        routes: {
          'POST /api/providers': () =>
            apiError((refusal as { status: number }).status, (refusal as { code: string }).code),
        },
      })
      const dialog = await openForm()
      await type(within(dialog).getByRole('textbox', { name: /名称/ }), 'X')
      await type(
        within(dialog).getByRole('textbox', { name: /Base URL/ }),
        'http://169.254.169.254/v1',
      )
      await setModel(dialog, 'm')
      await userEvent.click(within(dialog).getByRole('button', { name: '添加' }))
      const address = within(dialog).getByRole('textbox', { name: /Base URL/ })
      await waitFor(() => expect(address).toHaveAttribute('aria-invalid', 'true'))
      expect(screen.getByRole('dialog', { name: /添加服务商/ })).toBeInTheDocument()
      expect(within(dialog).getAllByRole('alert')).toHaveLength(1) // the message under the address, and no second notice
      expect(posts(server)).toHaveLength(1)
      // editing the address clears the message
      await userEvent.type(address, '/')
      await waitFor(() => expect(address).not.toHaveAttribute('aria-invalid', 'true'))
    },
  )

  it('the server naming unfilled placeholders points at the address', async () => {
    page({
      routes: {
        'POST /api/providers': () =>
          apiError(400, 'BASE_URL_PLACEHOLDER_UNFILLED', { placeholders: ['WorkspaceId'] }),
      },
    })
    const dialog = await openForm()
    await type(within(dialog).getByRole('textbox', { name: /名称/ }), 'X')
    await type(
      within(dialog).getByRole('textbox', { name: /Base URL/ }),
      'https://%7BWorkspaceId%7D.example.com',
    )
    await setModel(dialog, 'm')
    await userEvent.click(within(dialog).getByRole('button', { name: '添加' }))
    expect(
      await within(dialog).findByText(/还有没替换的占位符：\{WorkspaceId\}/),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: /Base URL/ })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })
})

describe('the model can be typed by hand, and nothing new has to be used', () => {
  it('only the required boxes and a typed model: the request is the one before the buttons existed, and nothing else is asked', async () => {
    const { server } = page({
      routes: { 'POST /api/providers': () => PROVIDERS.local.stored },
    })
    const dialog = await openForm()
    expect(within(dialog).getByText(/填服务商接口文档里的模型名/)).toBeInTheDocument()
    const { request } = PROVIDERS.local
    await type(within(dialog).getByRole('textbox', { name: /名称/ }), request.label)
    await type(within(dialog).getByRole('textbox', { name: /Base URL/ }), request.baseUrl)
    await userEvent.click(within(dialog).getByRole('radio', { name: '无需鉴权' }))
    expect(within(dialog).queryByLabelText('API Key')).toBeNull()
    await setModel(dialog, request.model)
    await userEvent.click(within(dialog).getByRole('button', { name: '添加' }))
    await waitFor(() => expect(posts(server)).toHaveLength(1))
    expect(posts(server)[0]!.body).toEqual(request) // `auth: none`, and no key
    // no probe, no model list: the one write is the add
    expect(server.calls.filter((c) => c.method !== 'GET').map((c) => c.path)).toEqual([
      '/api/providers',
    ])
  })
})

describe('signing in with an account', () => {
  const channelOf = (c: string) => LOGIN_CHANNELS.find((p) => p.channel === c)!
  const dialogAt = async (protocol: string) => {
    const dialog = await openForm()
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /API 协议/ }),
      protocol,
    )
    return dialog
  }

  it('the option appears only for an interface type that has a channel, and goes when the type changes', async () => {
    page()
    const dialog = await dialogAt('openai-chat')
    expect(within(dialog).getByRole('radio', { name: '账号登录' })).toBeInTheDocument()
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /API 协议/ }),
      'anthropic-messages',
    )
    expect(within(dialog).queryByRole('radio', { name: '账号登录' })).toBeNull()
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: /API 协议/ }),
      'openai-responses',
    )
    expect(within(dialog).getByRole('radio', { name: '账号登录' })).toBeInTheDocument()
  })

  it('image, video and voice forms never offer it', async () => {
    page()
    for (const kind of ['image', 'video', 'tts'] as const) {
      const dialog = await openForm(kind)
      expect(within(dialog).queryByRole('radio', { name: '账号登录' })).toBeNull()
      await userEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    }
  })

  it.each([
    ['openai-chatgpt', 'ChatGPT 账号登录'],
    ['openrouter', 'OpenRouter 账号登录'],
  ])(
    '%s: the channel fixes the address, which cannot be edited, and the key box goes',
    async (channel, name) => {
      const preset = channelOf(channel)
      page()
      const dialog = await dialogAt(preset.protocol)
      const address = within(dialog).getByRole('textbox', { name: /Base URL/ })
      await userEvent.type(address, 'https://typed.example.com/v1')
      await userEvent.click(within(dialog).getByRole('radio', { name: '账号登录' }))
      expect(address).toHaveValue(preset.baseUrl)
      expect(address).toHaveAttribute('readonly')
      expect(within(dialog).getByRole('combobox', { name: '登录通道' })).toHaveDisplayValue(name)
      expect(within(dialog).getByRole('combobox', { name: '登录通道' })).toBeDisabled() // one channel for this type
      expect(
        within(dialog).getByText('账号登录的接口地址和协议是固定的，不能修改'),
      ).toBeInTheDocument()
      expect(within(dialog).queryByLabelText('API Key')).toBeNull()
      expect(within(dialog).getByLabelText(/^模型/)).toHaveValue(preset.suggestedModel)
      // leaving sign-in gives the typed address back
      await userEvent.click(within(dialog).getByRole('radio', { name: 'API Key' }))
      expect(address).not.toHaveAttribute('readonly')
      expect(address).toHaveValue('https://typed.example.com/v1')
    },
  )

  it.each(['openai-chatgpt', 'openrouter'] as const)(
    '%s: the request is the one the real server accepted: the channel’s own address and protocol, never one typed by the user, and no key',
    async (channel) => {
      const { request, stored } = recorded.logins[channel]
      const { server } = page({
        routes: {
          'POST /api/providers': () => stored,
          [`GET /api/providers/${stored.id}/capability`]: () => makeCapabilityView(),
        },
      })
      const dialog = await dialogAt(request.protocol)
      await type(within(dialog).getByRole('textbox', { name: /名称/ }), request.label)
      // an address typed before choosing sign-in must not reach the request
      await type(
        within(dialog).getByRole('textbox', { name: /Base URL/ }),
        'https://typed.example.com/v1',
      )
      await userEvent.click(within(dialog).getByRole('radio', { name: '账号登录' }))
      await userEvent.click(within(dialog).getByRole('button', { name: '添加' }))
      await waitFor(() => expect(posts(server)).toHaveLength(1))
      expect(posts(server)[0]!.body).toEqual(request)
      expect(posts(server)[0]!.body).not.toHaveProperty('apiKey')
      expect(JSON.stringify(posts(server)[0]!.body)).not.toContain('typed.example.com')
    },
  )

  it('leaving sign-in gives back the model typed before it, not the channel’s suggestion; a model typed while signed in stays with sign-in', async () => {
    page()
    const dialog = await dialogAt('openai-responses')
    const model = () => within(dialog).getByLabelText(/^模型/)
    await userEvent.type(model(), 'my-typed-model')
    await userEvent.click(within(dialog).getByRole('radio', { name: '账号登录' }))
    expect(model()).toHaveValue(channelOf('openai-chatgpt').suggestedModel)
    await userEvent.click(within(dialog).getByRole('radio', { name: 'API Key' }))
    expect(model()).toHaveValue('my-typed-model')
    // nothing typed before: back to empty, not the suggestion
    await userEvent.clear(model())
    await userEvent.click(within(dialog).getByRole('radio', { name: '账号登录' }))
    await type(model(), 'edited-in-sign-in')
    await userEvent.click(within(dialog).getByRole('radio', { name: 'API Key' }))
    expect(model()).toHaveValue('')
    await userEvent.click(within(dialog).getByRole('radio', { name: '账号登录' }))
    expect(model()).toHaveValue('edited-in-sign-in')
  })
})

describe('a key typed before choosing sign-in', () => {
  it('is not sent: sign-in creates the provider without any key', async () => {
    const { request, stored } = recorded.logins.openrouter
    const { server } = page({ routes: { 'POST /api/providers': () => stored } })
    const dialog = await openForm()
    await type(within(dialog).getByRole('textbox', { name: /名称/ }), request.label)
    await userEvent.type(within(dialog).getByLabelText('API Key'), 'sk-typed-123456')
    await userEvent.click(within(dialog).getByRole('radio', { name: '账号登录' }))
    await userEvent.click(within(dialog).getByRole('button', { name: '添加' }))
    await waitFor(() => expect(posts(server)).toHaveLength(1))
    expect(posts(server)[0]!.body).toEqual(request)
    expect(JSON.stringify(posts(server)[0]!.body)).not.toContain('sk-typed')
  })
})

describe('one request at a time', () => {
  const fill = async (dialog: HTMLElement) => {
    const { request } = PROVIDERS.llm
    await type(within(dialog).getByRole('textbox', { name: /名称/ }), request.label)
    await type(within(dialog).getByRole('textbox', { name: /Base URL/ }), request.baseUrl)
    await setModel(dialog, request.model)
  }
  const slowPage = () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const view = page({
      routes: {
        'POST /api/providers': async () => {
          await gate
          return PROVIDERS.llm.stored
        },
        [`GET /api/providers/${PROVIDERS.llm.stored.id}/capability`]: () => makeCapabilityView(),
      },
    })
    return { ...view, release }
  }

  it('Enter pressed again and again while the first request is out sends exactly one', async () => {
    const { server, release } = slowPage()
    const dialog = await openForm()
    await fill(dialog)
    await userEvent.keyboard('{Enter}{Enter}{Enter}')
    await waitFor(() => expect(posts(server)).toHaveLength(1))
    await userEvent.keyboard('{Enter}{Enter}')
    release()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /添加服务商/ })).toBeNull())
    expect(posts(server)).toHaveLength(1)
  })

  it('Enter and a click on Add in the same breath send exactly one', async () => {
    const { server, release } = slowPage()
    const dialog = await openForm()
    await fill(dialog)
    const form = dialog.querySelector('form')!
    // two submits before React has rendered anything in between (a state flag alone would let both through)
    form.requestSubmit()
    form.requestSubmit()
    form.requestSubmit()
    await userEvent.keyboard('{Enter}')
    await userEvent.click(within(dialog).getByRole('button', { name: '添加' }))
    release()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /添加服务商/ })).toBeNull())
    expect(posts(server)).toHaveLength(1)
  })

  it('after a failure the next submit goes through again', async () => {
    let calls = 0
    const { server } = page({
      routes: {
        'POST /api/providers': () => {
          calls++
          return calls === 1 ? apiError(500, 'INTERNAL') : PROVIDERS.llm.stored
        },
        [`GET /api/providers/${PROVIDERS.llm.stored.id}/capability`]: () => makeCapabilityView(),
      },
    })
    const dialog = await openForm()
    await fill(dialog)
    await userEvent.keyboard('{Enter}')
    await within(dialog).findByRole('alert')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(posts(server)).toHaveLength(2))
  })
})

describe('closing, cancelling and failing create nothing', () => {
  const fillAll = async (dialog: HTMLElement) => {
    await type(within(dialog).getByRole('textbox', { name: /名称/ }), 'Mine')
    await type(
      within(dialog).getByRole('textbox', { name: /Base URL/ }),
      'https://a.example.com/v1',
    )
    await userEvent.type(within(dialog).getByLabelText('API Key'), 'sk-typed-123456')
    await setModel(dialog, 'm')
  }

  it('Cancel, the close button and Esc each leave without a request, and the next form is empty', async () => {
    const { server } = page({ providers: [PROVIDERS.llm.stored] })
    for (const how of ['cancel', 'close', 'esc'] as const) {
      const dialog = await openForm()
      await fillAll(dialog)
      if (how === 'cancel')
        await userEvent.click(within(dialog).getByRole('button', { name: '取消' }))
      if (how === 'close')
        await userEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
      if (how === 'esc') await userEvent.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog', { name: /添加服务商/ })).toBeNull())
    }
    const again = await openForm()
    expect(within(again).getByRole('textbox', { name: /名称/ })).toHaveValue('')
    expect(within(again).getByRole('textbox', { name: /Base URL/ })).toHaveValue('')
    expect(within(again).getByLabelText('API Key')).toHaveValue('')
    expect(noWrites(server)).toEqual([])
    // the provider that was there is still the only one
    expect(await screen.findAllByRole('article')).toHaveLength(1)
  })

  it('clicking outside the form does not drop what was typed', async () => {
    page()
    const dialog = await openForm()
    await fillAll(dialog)
    await userEvent.click(document.body)
    expect(screen.getByRole('dialog', { name: /添加服务商/ })).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: /名称/ })).toHaveValue('Mine')
  })

  it('a failure shows the reason, keeps the dialog and the input, creates nothing; the retry makes one provider', async () => {
    let calls = 0
    const { server, setList } = page({
      providers: [],
      routes: {
        'POST /api/providers': () => {
          calls++
          if (calls === 1) return apiError(500, 'INTERNAL')
          setList([PROVIDERS.llm.stored])
          return PROVIDERS.llm.stored
        },
        [`GET /api/providers/${PROVIDERS.llm.stored.id}/capability`]: () => makeCapabilityView(),
      },
    })
    const dialog = await openForm()
    await fillAll(dialog)
    await userEvent.click(within(dialog).getByRole('button', { name: '添加' }))
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: /名称/ })).toHaveValue('Mine')
    expect(screen.queryAllByRole('article')).toHaveLength(0)
    expect(noWrites(server)).toHaveLength(1)
    await userEvent.click(within(dialog).getByRole('button', { name: '添加' }))
    await waitFor(() => expect(calls).toBe(2))
    expect(await screen.findAllByRole('article')).toHaveLength(1)
    expect(noWrites(server).every((c) => c.method === 'POST' && c.path === '/api/providers')).toBe(
      true,
    )
  })

  it('a body the contract refuses is never sent', async () => {
    const { server } = page()
    const dialog = await openForm()
    // a name of only spaces looks filled to the eye; it must not get to the server
    await type(within(dialog).getByRole('textbox', { name: /名称/ }), '   ')
    await type(
      within(dialog).getByRole('textbox', { name: /Base URL/ }),
      'https://a.example.com/v1',
    )
    await setModel(dialog, 'm')
    expect(within(dialog).getByRole('button', { name: '添加' })).toBeDisabled()
    expect(noWrites(server)).toEqual([])
  })
})

describe('keyboard', () => {
  it('the whole form is filled and sent from the keyboard, in the order name, type, address, authentication, key, model list, model, test, cancel, add', async () => {
    const { request, stored } = PROVIDERS.llm
    const { server } = page({ routes: { 'POST /api/providers': () => stored } })
    const dialog = await openForm()
    const at = (el: HTMLElement) => expect(document.activeElement).toBe(el)
    const field = (name: string | RegExp) => within(dialog).getByRole('textbox', { name })

    at(field(/名称/)) // the form opens with the cursor in the first box
    await userEvent.keyboard(request.label)
    await userEvent.tab()
    at(within(dialog).getByRole('combobox', { name: /API 协议/ }))
    await userEvent.tab()
    at(field(/Base URL/))
    await userEvent.keyboard(request.baseUrl)
    await userEvent.tab()
    at(within(dialog).getByRole('radio', { name: 'API Key' }))
    await userEvent.tab()
    at(within(dialog).getByLabelText('API Key'))
    await userEvent.keyboard(request.apiKey!)
    await userEvent.tab()
    at(within(dialog).getByRole('button', { name: '获取模型列表' }))
    await userEvent.tab()
    at(within(dialog).getByLabelText(/^模型/))
    await userEvent.keyboard(request.model)
    await userEvent.tab()
    at(within(dialog).getByRole('button', { name: '测试连接' }))
    await userEvent.tab()
    at(within(dialog).getByRole('button', { name: '取消' }))
    await userEvent.tab()
    at(within(dialog).getByRole('button', { name: '添加' }))
    // the focus stays inside the dialog however long Tab is held down
    for (let i = 0; i < 12; i++) await userEvent.tab()
    expect(dialog.contains(document.activeElement)).toBe(true)
    await userEvent.tab({ shift: true })
    within(dialog).getByRole('button', { name: '添加' }).focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(posts(server)).toHaveLength(1))
    expect(posts(server)[0]!.body).toEqual(request)
  })

  it('Enter in a text box adds once everything is filled', async () => {
    const { request, stored } = PROVIDERS.llm
    const { server } = page({ routes: { 'POST /api/providers': () => stored } })
    const dialog = await openForm()
    await type(within(dialog).getByRole('textbox', { name: /名称/ }), request.label)
    await type(within(dialog).getByRole('textbox', { name: /Base URL/ }), request.baseUrl)
    await setModel(dialog, request.model)
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(posts(server)).toHaveLength(1))
  })

  it('a submit that comes from a drop-down (Enter after choosing in the list) is not “Add”; Enter in a text box still is', async () => {
    const { server } = page({
      routes: { 'POST /api/providers': () => PROVIDERS.llm.stored },
    })
    const dialog = await openForm()
    const { request } = PROVIDERS.llm
    await type(within(dialog).getByRole('textbox', { name: /名称/ }), request.label)
    await type(within(dialog).getByRole('textbox', { name: /Base URL/ }), request.baseUrl)
    await setModel(dialog, request.model)
    const select = within(dialog).getByRole('combobox', { name: /API 协议/ })
    select.focus()
    dialog.querySelector('form')!.requestSubmit() // what the browser does after the list closes
    await new Promise((r) => setTimeout(r, 50))
    expect(posts(server)).toHaveLength(0)
    await userEvent.click(within(dialog).getByRole('textbox', { name: /名称/ }))
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(posts(server)).toHaveLength(1))
  })

  it('the authentication choice moves with the arrow keys, and Esc closes', async () => {
    page()
    const dialog = await openForm()
    within(dialog).getByRole('radio', { name: 'API Key' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(within(dialog).getByRole('radio', { name: '账号登录' })).toBeChecked() // openai-chat has a sign-in channel
    await userEvent.keyboard('{ArrowRight}')
    expect(within(dialog).getByRole('radio', { name: '无需鉴权' })).toBeChecked()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /添加服务商/ })).toBeNull())
  })
})

describe('the three languages', () => {
  it.each([
    ['zh-CN', zh, '添加服务商 · 大模型', '添加服务商'],
    ['zh-TW', zhTW, '新增服務商 · 大模型', '新增服務商'],
    ['en', en, 'Add provider · Language model', 'Add provider'],
  ] as const)(
    '%s: title, labels, hint and placeholder are all in that language',
    async (lang, dict, title, button) => {
      await setLocale(lang)
      page()
      const section = await screen.findByRole('region', { name: /./ })
      void section
      await userEvent.click((await screen.findAllByRole('button', { name: button }))[0]!)
      const dialog = await screen.findByRole('dialog', { name: title })
      expect(within(dialog).getByText(dict.providers.add.addressHint)).toBeInTheDocument()
      expect(within(dialog).getByRole('textbox', { name: /Base URL/ })).toHaveAttribute(
        'placeholder',
        dict.providers.add.addressPlaceholder,
      )
      expect(within(dialog).getByText(dict.providers.add.modelHint)).toBeInTheDocument()
      expect(
        within(dialog).getByRole('textbox', { name: new RegExp(dict.providers.form.name) }),
      ).toBeInTheDocument()
      expect(
        within(dialog).getByRole('textbox', { name: new RegExp(dict.providers.form.model) }),
      ).toBeInTheDocument()
      expect(
        within(dialog).getByRole('radio', { name: dict.providerAuth.custom.apiKey }),
      ).toBeInTheDocument()
      expect(
        within(dialog).getByRole('button', { name: dict.providers.add.create }),
      ).toBeInTheDocument()
      await setLocale('zh-CN')
    },
  )

  it('the sign-in option and the channel names read in each language', async () => {
    for (const [lang, dict] of [
      ['zh-TW', zhTW],
      ['en', en],
    ] as const) {
      await setLocale(lang)
      const { unmount } = page()
      await userEvent.click(
        (await screen.findAllByRole('button', { name: dict.providers.add.label }))[0]!,
      )
      const dialog = await screen.findByRole('dialog')
      await userEvent.click(
        within(dialog).getByRole('radio', { name: dict.providerAuth.custom.login }),
      )
      expect(
        within(dialog).getByRole('combobox', { name: dict.providerAuth.custom.channel }),
      ).toHaveDisplayValue(dict.providerAuth.chip.channels.openrouter)
      unmount()
    }
    await setLocale('zh-CN')
  })

  it('the new strings name no vendor (only the sign-in channels may name theirs)', () => {
    const vendors =
      /302|deepseek|openai|aliyun|alibaba|阿里|minimax|kling|可灵|volc|火山|siliconflow|硅基|gemini|claude|anthropic|qwen|通义|豆包|bytedance|zhipu|智谱|moonshot|kimi/i
    for (const dict of [zh, zhTW, en]) {
      expect(JSON.stringify(dict.providers.add)).not.toMatch(vendors)
      expect(JSON.stringify(dict.providerAuth.custom)).not.toMatch(vendors)
    }
  })

  it('the protocol names are ordinary ones in the existing order, with no “recommended” mark', () => {
    for (const dict of [zh, zhTW, en])
      for (const kind of Object.keys(PROTOCOLS_BY_KIND) as Kind[])
        for (const p of PROTOCOLS_BY_KIND[kind])
          expect((dict.protocol as Record<string, string>)[p]).not.toMatch(
            /推荐|推薦|recommend|popular|常用|默认|預設/i,
          )
  })
})
