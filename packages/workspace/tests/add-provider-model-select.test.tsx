import { waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocale } from './render'
import {
  PROVIDERS,
  knownFor,
  modelControl,
  modelOptions,
  openForm,
  page,
  posts,
  probed,
  setModel,
  type,
} from './add-provider-kit'

/** The model of a provider being added is a visible drop-down when there are choices, a box when there are none. */

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

const KEY = 'sk-record-123456789012'
const P = probed.probes
const listButton = (d: HTMLElement) => within(d).getByRole('button', { name: '获取模型列表' })
async function askForList(d: HTMLElement, name: keyof typeof P = 'llm.models') {
  await type(within(d).getByRole('textbox', { name: /Base URL/ }), P[name].request.baseUrl)
  await userEvent.type(within(d).getByLabelText('API Key'), KEY)
  await userEvent.click(listButton(d))
  await within(d).findByText(/取到 \d+ 个模型/)
}
const listed = (name: keyof typeof P) => () => P[name].response

describe('the model control', () => {
  it('with a list from the provider: a drop-down named “模型”, “请选择” first, then the ids in the order given, nothing chosen, and “手动输入” as a button beside it, not as an option', async () => {
    page({ routes: { 'POST /api/providers/probe': listed('llm.models') } })
    const d = await openForm('llm')
    expect(modelControl(d).tagName).toBe('INPUT') // nothing to choose from yet
    await askForList(d)
    const select = modelControl(d)
    expect(select.tagName).toBe('SELECT')
    expect(select).toHaveDisplayValue('请选择') // the current value can be read
    const names = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(names).toEqual(['请选择', 'text-model-1', 'text-model-2'])
    expect(within(d).getByRole('button', { name: '手动输入' })).toBeInTheDocument()
  })

  it('with suggestions only (no list): the same drop-down, from the model data', async () => {
    page()
    const d = await openForm('image')
    await waitFor(() => expect(modelControl(d).tagName).toBe('SELECT'))
    expect(modelOptions(d)).toEqual(knownFor('image', 'openai-images').map((m) => m.id))
    expect(modelControl(d)).toHaveDisplayValue('请选择')
  })

  it('with neither: a plain box with its line, and no way to “go back to the list”', async () => {
    page()
    const d = await openForm('llm')
    expect(modelControl(d).tagName).toBe('INPUT')
    expect(within(d).getByText(/填服务商接口文档里的模型名/)).toBeInTheDocument()
    expect(within(d).queryByRole('button', { name: '从列表选择' })).toBeNull()
  })

  it('choosing from the drop-down sets the model that is added', async () => {
    const { server } = page({
      routes: {
        'POST /api/providers/probe': listed('llm.models'),
        'POST /api/providers': () => PROVIDERS.llm.stored,
      },
    })
    const d = await openForm('llm')
    await type(within(d).getByRole('textbox', { name: /名称/ }), 'Mine')
    await askForList(d)
    await userEvent.selectOptions(modelControl(d), 'text-model-2')
    expect(modelControl(d)).toHaveValue('text-model-2')
    await userEvent.click(within(d).getByRole('button', { name: '添加' }))
    await waitFor(() => expect(posts(server)).toHaveLength(1))
    expect(posts(server)[0]!.body).toMatchObject({ model: 'text-model-2' })
  })

  it('“请选择” is not a model: with nothing chosen Add stays off', async () => {
    page({ routes: { 'POST /api/providers/probe': listed('llm.models') } })
    const d = await openForm('llm')
    await type(within(d).getByRole('textbox', { name: /名称/ }), 'Mine')
    await askForList(d)
    expect(within(d).getByRole('button', { name: '添加' })).toBeDisabled()
    await userEvent.selectOptions(modelControl(d), 'text-model-1')
    expect(within(d).getByRole('button', { name: '添加' })).toBeEnabled()
    await userEvent.selectOptions(modelControl(d), '')
    expect(within(d).getByRole('button', { name: '添加' })).toBeDisabled()
  })
})

describe('an empty list from the provider', () => {
  it('says so and keeps the suggestions from the model data; with none, it is a plain box', async () => {
    const empty = () => ({ ...P['llm.models'].response, items: [] })
    page({ routes: { 'POST /api/providers/probe': empty } })
    const image = await openForm('image')
    await type(
      within(image).getByRole('textbox', { name: /Base URL/ }),
      'https://img.example.com/v1',
    )
    await userEvent.type(within(image).getByLabelText('API Key'), KEY)
    await waitFor(() => expect(modelControl(image).tagName).toBe('SELECT'))
    await userEvent.click(listButton(image))
    expect(
      await within(image).findByText(
        '服务商返回的模型列表是空的，可以从下面的候选里选，或手动填写模型名',
      ),
    ).toBeInTheDocument()
    expect(modelOptions(image)).toEqual(knownFor('image', 'openai-images').map((m) => m.id))
    await userEvent.keyboard('{Escape}')
    const llm = await openForm('llm')
    await type(within(llm).getByRole('textbox', { name: /Base URL/ }), 'https://llm.example.com/v1')
    await userEvent.type(within(llm).getByLabelText('API Key'), KEY)
    await userEvent.click(listButton(llm))
    expect(
      await within(llm).findByText('服务商返回的模型列表是空的，请手动填写模型名'),
    ).toBeInTheDocument()
    expect(modelControl(llm).tagName).toBe('INPUT')
  })
})

describe('typing a model that is not offered', () => {
  it('“手动输入” turns it into a box with the focus in it, “从列表选择” turns it back, and what was typed is kept', async () => {
    const { server } = page({
      routes: {
        'POST /api/providers/probe': listed('llm.models'),
        'POST /api/providers': () => PROVIDERS.llm.stored,
      },
    })
    const d = await openForm('llm')
    await type(within(d).getByRole('textbox', { name: /名称/ }), 'Mine')
    await askForList(d)
    await userEvent.click(within(d).getByRole('button', { name: '手动输入' }))
    const box = modelControl(d)
    expect(box.tagName).toBe('INPUT')
    expect(box).toHaveFocus()
    await userEvent.type(box, 'my-own-model')
    await userEvent.click(within(d).getByRole('button', { name: '从列表选择' }))
    // back in the drop-down, the typed model is still the value, offered next to the listed ones
    expect(modelControl(d).tagName).toBe('SELECT')
    expect(modelControl(d)).toHaveValue('my-own-model')
    await userEvent.selectOptions(modelControl(d), 'text-model-1')
    await userEvent.click(within(d).getByRole('button', { name: '手动输入' }))
    expect(modelControl(d)).toHaveValue('text-model-1') // the box starts from the current choice
    await setModel(d, 'typed-again')
    await userEvent.click(within(d).getByRole('button', { name: '添加' }))
    await waitFor(() => expect(posts(server)).toHaveLength(1))
    expect(posts(server)[0]!.body).toMatchObject({ model: 'typed-again' })
  })

  it('a model typed before the list arrived is kept when the list does', async () => {
    page({ routes: { 'POST /api/providers/probe': listed('llm.models') } })
    const d = await openForm('llm')
    await setModel(d, 'typed-first')
    await askForList(d)
    expect(modelControl(d)).toHaveValue('typed-first')
    expect(modelOptions(d)).toEqual(['typed-first', 'text-model-1', 'text-model-2'])
  })
})

describe('Enter and the model control', () => {
  it('the box that “手动输入” turns it into does not add on the first Enter, and adds once something was typed in it', async () => {
    const { server } = page({
      routes: {
        'POST /api/providers/probe': listed('llm.models'),
        'POST /api/providers': () => PROVIDERS.llm.stored,
      },
    })
    const d = await openForm('llm')
    await type(within(d).getByRole('textbox', { name: /名称/ }), 'Mine')
    await askForList(d)
    await userEvent.selectOptions(modelControl(d), 'text-model-1') // a valid form: everything is filled
    await userEvent.click(within(d).getByRole('button', { name: '手动输入' }))
    expect(modelControl(d)).toHaveFocus()
    await userEvent.keyboard('{Enter}') // right after switching: not “Add”
    await new Promise((r) => setTimeout(r, 50))
    expect(posts(server)).toHaveLength(0)
    await userEvent.keyboard('-edited{Enter}') // the user typed: Enter adds, with what was typed
    await waitFor(() => expect(posts(server)).toHaveLength(1))
    expect(posts(server)[0]!.body).toMatchObject({ model: 'text-model-1-edited' })
  })

  it('a drop-down never adds: a submit that comes from it is ignored', async () => {
    const { server } = page({
      routes: {
        'POST /api/providers/probe': listed('llm.models'),
        'POST /api/providers': () => PROVIDERS.llm.stored,
      },
    })
    const d = await openForm('llm')
    await type(within(d).getByRole('textbox', { name: /名称/ }), 'Mine')
    await askForList(d)
    await userEvent.selectOptions(modelControl(d), 'text-model-2')
    modelControl(d).focus()
    await userEvent.keyboard('{Enter}')
    d.querySelector('form')!.requestSubmit()
    await new Promise((r) => setTimeout(r, 50))
    expect(posts(server)).toHaveLength(0)
  })

  it('typing letters in the drop-down can only land on models: there is nothing else in it to land on', async () => {
    page({ routes: { 'POST /api/providers/probe': listed('llm.models') } })
    const d = await openForm('llm')
    await askForList(d)
    for (const o of within(modelControl(d)).getAllByRole('option')) {
      const v = o.getAttribute('value') ?? ''
      expect(v === '' || modelOptions(d).includes(v), `${o.textContent}`).toBe(true)
    }
  })
})

describe('a long list', () => {
  const ids = Array.from({ length: 120 }, (_, i) => `model-${String(i).padStart(3, '0')}`)
  // the recorded answer's shape, with more of the same items
  const long = () => ({
    ...P['llm.models'].response,
    items: ids.map((id) => ({ id, label: id })),
  })

  it('has a box that narrows it by what is typed (never hides the chosen one), and shows everything again when cleared', async () => {
    page({ routes: { 'POST /api/providers/probe': long } })
    const d = await openForm('llm')
    await askForList(d)
    expect(modelOptions(d)).toHaveLength(120)
    await userEvent.selectOptions(modelControl(d), 'model-005')
    const filter = within(d).getByRole('textbox', { name: '筛选型号' })
    await userEvent.type(filter, '11')
    expect(modelOptions(d)).toEqual(['model-005', ...ids.filter((i) => i.includes('11'))])
    await userEvent.clear(filter)
    expect(modelOptions(d)).toHaveLength(120)
    expect(modelControl(d)).toHaveValue('model-005')
  })

  it('a short list has no filter box', async () => {
    page({ routes: { 'POST /api/providers/probe': listed('llm.models') } })
    const d = await openForm('llm')
    await askForList(d)
    expect(within(d).queryByRole('textbox', { name: '筛选型号' })).toBeNull()
  })
})

describe('the choices belong to the draft', () => {
  it('changing the interface type drops a fetched list: the control goes back to the suggestions, or to a box', async () => {
    page({ routes: { 'POST /api/providers/probe': listed('llm.models') } })
    const d = await openForm('llm')
    await askForList(d)
    expect(modelControl(d).tagName).toBe('SELECT')
    await userEvent.selectOptions(
      within(d).getByRole('combobox', { name: /API 协议/ }),
      'anthropic-messages',
    )
    expect(modelControl(d).tagName).toBe('INPUT')
  })

  it('signing in: the channel’s suggested model sits in a box and can be changed', async () => {
    page()
    const d = await openForm('llm')
    await userEvent.selectOptions(
      within(d).getByRole('combobox', { name: /API 协议/ }),
      'openai-responses',
    )
    await userEvent.click(within(d).getByRole('radio', { name: '账号登录' }))
    const c = probed.loginChannels.find((x) => x.protocol === 'openai-responses')!
    expect(modelControl(d)).toHaveValue(c.suggestedModel)
    await setModel(d, 'mine')
    expect(modelControl(d)).toHaveValue('mine')
  })

  it('the control is a native select with its label: focusable, named “模型”, and a screen reader reads the current value', async () => {
    page()
    const d = await openForm('image')
    await waitFor(() => expect(modelControl(d).tagName).toBe('SELECT'))
    const select = modelControl(d)
    select.focus()
    expect(select).toHaveFocus()
    expect(within(d).getByRole('combobox', { name: /^模型/ })).toBe(select)
    expect(select).toHaveDisplayValue('请选择')
    await userEvent.selectOptions(select, modelOptions(d)[1]!)
    expect(select).toHaveDisplayValue(modelOptions(d)[1]!)
  })
})
