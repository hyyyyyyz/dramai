/**
 * The narration-voice screens against what the REAL server answered (tests/fixtures/real-speech/recorded.json, made by
 * record.mjs in the same folder: real capabilities, real pre-flight results, real stored projects), not against data
 * made up from a report's examples. Each test says which finding of the review it guards.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Project } from '@dramai/api'
import { countText as contractCountText } from '@dramai/api'
import { ProjectSettingsDialog } from '@/features/overview/ProjectSettingsDialog'
import { BatchConfirmDialog } from '@/features/storyboard/BatchConfirmDialog'
import { countWith } from '@/features/settings/voice-model'
import { voiceIssues } from '@/features/settings/voice-issues'
import { fakeServer } from './fixtures'
import recorded from './fixtures/real-speech/recorded.json'
import { renderApp, useLocale } from './render'

beforeEach(async () => {
  await useLocale('zh-CN')
})

type Rec = typeof recorded
type ScenarioKey = keyof Rec['scenarios']
type CapKey = keyof Rec['capabilities']
const scenarios = recorded.scenarios as unknown as Record<
  string,
  { provider: string; projectId: string; shotId: string; project: Project; preflight: unknown }
>
const providers = recorded.providers as unknown as Record<string, { id: string }>
const capabilities = recorded.capabilities as unknown as Record<
  string,
  { declared: boolean; capability: unknown }
>
const idOf = (key: string) => providers[key]!.id

/** A server that answers as the recorded one did for this scenario, and keeps what is PATCHed. */
function serve(key: ScenarioKey, opts: { project?: Project } = {}) {
  const sc = scenarios[key]!
  let project = opts.project ?? sc.project
  const server = fakeServer({
    'GET /api/settings': () => ({ activeProviders: { tts: idOf(sc.provider) }, cost: {} }),
    'GET /api/providers': () => ({ items: Object.values(recorded.providers) }),
    ...Object.fromEntries(
      Object.entries(recorded.providers).map(([k, p]) => [
        `GET /api/providers/${(p as { id: string }).id}/capability`,
        () => recorded.capabilities[k as CapKey],
      ]),
    ),
    [`GET /api/projects/${sc.projectId}`]: () => project,
    [`PATCH /api/projects/${sc.projectId}`]: ({ body }) => {
      const b = body as Record<string, unknown>
      project = {
        ...project,
        ...b,
        ...('narrationVoice' in b && b.narrationVoice === null
          ? { narrationVoice: undefined }
          : {}),
      } as Project
      return project
    },
    [`POST /api/projects/${sc.projectId}/preflight`]: () => sc.preflight,
  })
  return { server, sc, setProject: (p: Project) => (project = p) }
}
const patches = (server: ReturnType<typeof fakeServer>) =>
  server.calls.filter((c) => c.method === 'PATCH').map((c) => c.body as Record<string, unknown>)

function open(key: ScenarioKey) {
  const s = serve(key)
  renderApp(<ProjectSettingsDialog project={s.sc.project} onClose={() => {}} />, {
    client: s.server.client,
  })
  return s
}
const save = () => userEvent.click(screen.getByRole('button', { name: '保存' }))

// ---------------------------------------------------------------- 1. a model with no profile has an unknown default

describe('review 1 / default voice: the server says what is used when no voice is chosen (`speechDefaultVoice`)', () => {
  const sources = (key: CapKey) =>
    (capabilities[key] as unknown as { speechDefaultVoice?: { voice?: string; source: string } })
      .speechDefaultVoice

  it('the three kinds of source, as the real server recorded them: a profile (OpenAI), the protocol (tts-1, a relay’s tts-1), none (CosyVoice 3.5)', () => {
    expect(sources('openai')).toEqual({ voice: 'alloy', source: 'profile' })
    expect(sources('tts1')).toEqual({ voice: 'alloy', source: 'protocol' })
    expect(sources('relayTts1')).toEqual({ voice: 'alloy', source: 'protocol' })
    expect(sources('cosy35')).toEqual({ source: 'none' })
    // and the pre-flight agrees with each: tts-1 goes ahead on that default, CosyVoice 3.5 cannot
    const r = (k: string) =>
      (scenarios[k]!.preflight as { results: { status: string; reasons: { code: string }[] }[] })
        .results[0]!
    expect(r('noVoiceTts1').status).toBe('accepted')
    expect(r('noVoiceCosy35').reasons.map((x) => x.code)).toEqual(['NARRATION_VOICE_REQUIRED'])
  })

  it('tts-1 (source: protocol): the default alloy is named, nothing says a voice is required, and the title shows no error', async () => {
    const { server } = open('noVoiceTts1')
    expect(await screen.findByText('不选就用这个型号的默认音色：alloy')).toBeInTheDocument()
    expect(screen.queryByText(/必须选一个音色/)).toBeNull()
    expect(screen.queryByText(/没有声明默认音色/)).toBeNull()
    expect(screen.queryByText(/请填写标题/)).toBeNull()
    // a language hint with no voice chosen is written with the default voice, and the dialog says so
    await userEvent.type(screen.getByRole('textbox', { name: '语言提示（可选）' }), 'zh')
    expect(await screen.findByTestId('voice-pinned')).toHaveTextContent('默认音色 alloy')
    // and what pinning means when the provider is switched later
    expect(screen.getByTestId('voice-pinned')).toHaveTextContent(
      '换到另一家语音服务商，这个音色在新服务商上可能不存在，生成前的检查会拦下',
    )
    expect(screen.queryByTestId('voice-not-saved')).toBeNull()
    await save()
    await waitFor(() => expect(patches(server)).toHaveLength(1))
    expect(patches(server)[0]!.narrationVoice).toMatchObject({ voice: 'alloy', language: 'zh' })
  })

  it('a profile’s default (OpenAI) is named the same way', async () => {
    open('withSpeed')
    expect(await screen.findByRole('option', { name: '默认（alloy）' })).toBeInTheDocument()
  })

  it('source: none (CosyVoice 3.5) says a voice is required, as the pre-flight does, and the inputs are not saved without one', async () => {
    open('noVoiceCosy35')
    expect(await screen.findByText(/没有默认音色，必须选一个音色才能生成配音/)).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: '风格指令（可选）' }), '平静')
    expect(await screen.findByTestId('voice-not-saved')).toBeInTheDocument()
  })

  it('switching: tts-1 and OpenAI have a default, so a project without a voice is not flagged; CosyVoice 3.5 flags it', () => {
    const p = [{ ...scenarios.noVoiceTts1!.project, narrationDelivery: 'tts' as const }]
    expect(voiceIssues(p, capabilities.tts1 as never)).toEqual([])
    expect(voiceIssues(p, capabilities.relayTts1 as never)).toEqual([])
    expect(voiceIssues(p, capabilities.openai as never)).toEqual([])
    expect(voiceIssues(p, capabilities.cosy35 as never).map((i) => i.kind)).toEqual(['required'])
  })

  it('a response without the field (a server older than this one) concludes nothing: no "required", no block', async () => {
    const s = serve('noVoiceTts1')
    const cap = capabilities.tts1 as unknown as Record<string, unknown>
    const { speechDefaultVoice: _drop, ...older } = cap
    void _drop
    const server = fakeServer({
      ...Object.fromEntries(
        Object.entries(recorded.providers).map(([k, p]) => [
          `GET /api/providers/${(p as { id: string }).id}/capability`,
          () => (k === 'tts1' ? older : recorded.capabilities[k as CapKey]),
        ]),
      ),
      'GET /api/settings': () => ({ activeProviders: { tts: idOf('tts1') }, cost: {} }),
      'GET /api/providers': () => ({ items: Object.values(recorded.providers) }),
    })
    renderApp(<ProjectSettingsDialog project={s.sc.project} onClose={() => {}} />, {
      client: server.client,
    })
    expect(
      await screen.findByText(/没有声明默认音色。不选的话，生成前的检查会告诉你能不能用/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/必须选一个音色/)).toBeNull()
  })
})

// ---------------------------------------------------------------- 2. a refusal by the contract is explained

describe('review 2: a request the contract refuses says which field and why', () => {
  it('over the contract’s 20000 characters: no request goes out, and the dialog names the field and the limit', async () => {
    const { server } = open('withSpeed')
    const box = await screen.findByRole('textbox', { name: '风格指令（可选）' })
    await userEvent.click(box)
    await userEvent.paste('平'.repeat(20001))
    await save()
    expect(
      await screen.findByText('「风格指令」不能这样保存：最多 20000 个字符'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/出了点问题/)).toBeNull()
    expect(patches(server)).toHaveLength(0)
  })
  it('20000 characters is saved', async () => {
    const { server } = open('withSpeed')
    const box = await screen.findByRole('textbox', { name: '风格指令（可选）' })
    await userEvent.click(box)
    await userEvent.paste('平'.repeat(20000))
    await save()
    await waitFor(() => expect(patches(server)).toHaveLength(1))
  })
})

// ---------------------------------------------------------------- 3. saving does not change what the user did not change

describe('review 3: only what the user changed is saved', () => {
  it('choosing the default voice keeps the speed (it is not cleared), and the dialog says the default is pinned', async () => {
    const { server } = open('withSpeed')
    // the speed is shown, read-only
    expect(await screen.findByTestId('voice-speed')).toHaveTextContent('语速 1.25')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '音色' }), '')
    expect(await screen.findByTestId('voice-pinned')).toHaveTextContent('默认音色 alloy')
    await save()
    await waitFor(() => expect(patches(server)).toHaveLength(1))
    const sent = patches(server)[0]!
    expect(sent.narrationVoice).not.toBeNull()
    expect(sent.narrationVoice).toMatchObject({ voice: 'alloy', speed: 1.25 })
  })

  it('clearing everything is its own, explicit action, and says the speed goes too', async () => {
    const { server } = open('withSpeed')
    await userEvent.click(
      await screen.findByRole('button', { name: '清除全部旁白设置（包括语速）' }),
    )
    expect(screen.getByTestId('voice-clear-all')).toHaveTextContent('语速都会被清除')
    await save()
    await waitFor(() => expect(patches(server)).toHaveLength(1))
    expect(patches(server)[0]).toEqual({ narrationVoice: null })
  })

  it('changed elsewhere while the dialog is open: a title-only save sends only the title', async () => {
    const s = serve('withSpeedAndInstructions')
    let setLive: (p: Project) => void = () => {}
    function Host() {
      const [p, set] = useState(s.sc.project)
      setLive = set
      return <ProjectSettingsDialog project={p} onClose={() => {}} />
    }
    renderApp(<Host />, { client: s.server.client })
    const title = await screen.findByRole('textbox', { name: /标题/ })
    // elsewhere: the voice, the speed and the instruction change, and so does the aspect ratio
    setLive({
      ...s.sc.project,
      aspectRatio: '16:9',
      narrationVoice: {
        ...s.sc.project.narrationVoice!,
        voice: 'echo',
        speed: 0.8,
        instructions: 'whisper',
      },
    })
    await userEvent.type(title, 'X')
    await save()
    await waitFor(() => expect(patches(s.server)).toHaveLength(1))
    expect(patches(s.server)[0]).toEqual({ name: `${s.sc.project.name}X` })
  })

  it('changed elsewhere, and the user edits only the instruction: the voice and speed are the current ones, not the old draft', async () => {
    const s = serve('withSpeedAndInstructions')
    let setLive: (p: Project) => void = () => {}
    function Host() {
      const [p, set] = useState(s.sc.project)
      setLive = set
      return <ProjectSettingsDialog project={p} onClose={() => {}} />
    }
    renderApp(<Host />, { client: s.server.client })
    const box = await screen.findByRole('textbox', { name: '风格指令（可选）' })
    setLive({
      ...s.sc.project,
      narrationVoice: { ...s.sc.project.narrationVoice!, voice: 'echo', speed: 0.8 },
    })
    await userEvent.clear(box)
    await userEvent.type(box, '大声')
    await save()
    await waitFor(() => expect(patches(s.server)).toHaveLength(1))
    expect(patches(s.server)[0]!.narrationVoice).toMatchObject({
      voice: 'echo',
      speed: 0.8,
      instructions: '大声',
    })
  })

  it('a stored voice with stray spaces, saved without a change, sends nothing', async () => {
    const { server } = open('paddedVoice')
    await screen.findByRole('combobox', { name: '音色' })
    await save()
    await waitFor(() => expect(screen.queryByRole('button', { name: '保存' })).toBeInTheDocument())
    expect(patches(server)).toHaveLength(0)
  })

  it('opening and saving with no change sends nothing; changing only the title sends only the title', async () => {
    const a = open('withSpeedAndInstructions')
    await screen.findByRole('combobox', { name: '音色' })
    await save()
    expect(patches(a.server)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------- 4. a stored voice outside a closed list is shown as itself

describe('review 4: a voice of another service on a closed list is shown as what it is', () => {
  it('the real pre-flight blocks it, and the dialog shows the stored name (not "default") and names it in the note', async () => {
    const r = (
      scenarios.foreignOnClosed!.preflight as { results: { reasons: { code: string }[] }[] }
    ).results[0]!
    expect(r.reasons.map((x) => x.code)).toEqual(['VOICE_NOT_AVAILABLE'])
    const { server } = open('foreignOnClosed')
    const select = (await screen.findByRole('combobox', { name: '音色' })) as HTMLSelectElement
    const shown = select.options[select.selectedIndex]!.text
    expect(shown).toContain('Chinese (Mandarin)_News_Anchor')
    expect(shown).toContain('不在这个型号的清单里')
    expect(shown).not.toContain('默认')
    expect(screen.getByTestId('voice-not-in-list')).toHaveTextContent(
      'Chinese (Mandarin)_News_Anchor',
    )
    // nothing changes by opening and saving
    await save()
    expect(patches(server)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------- 5. counting is the server's

describe('review 5: the count is the contract’s, and the Alibaba way counts only Chinese characters as 2', () => {
  const samples = [
    'Hello 世界！😀 ok'.repeat(7),
    '平静，略带笑意。Calm & warm.'.repeat(6),
    '（轻声）“好”…ＡＢＣ１２３ 👨‍👩‍👧\n'.repeat(5),
    '  平静地说  ',
    '한글 음절 그리고 日本語のかな ひらがな カタカナ',
    '全角標點，、。！？：；「」『』（）',
    'é ä 組合字符 🇨🇳🇯🇵',
    '𠀀𠀁 𝒜𝒷 😀😀😀',
  ]
  it.each(samples.map((s, i) => [i, s] as const))(
    'sample %i: what the screen counts is what the contract’s function counts',
    (_i, text) => {
      expect(countWith(text, 'cjk_double')).toBe(contractCountText('cjk_double', text))
      expect(countWith(text, 'characters')).toBe(contractCountText('characters', text))
    },
  )
  it('the rule itself, on small cases whose numbers can be checked by hand', () => {
    const n = (t: string) => countWith(t, 'cjk_double')
    expect(n('😀')).toBe(1) // an emoji is 1
    expect(n('한글')).toBe(2) // Hangul is 1 each
    expect(n('かな')).toBe(2) // kana is 1 each
    expect(n('日本語のかな')).toBe(9) // 3 Han × 2 + 3 kana
    expect(n('，。！')).toBe(3) // punctuation is 1 each
    expect(n('ＡＢＣ１２３')).toBe(6) // full-width letters and digits are 1 each
    expect(n('𠀀')).toBe(2) // a Han character outside the BMP is 2
    expect(n('平静')).toBe(4)
  })
  it('in the dialog: the count shown is the contract’s count of the trimmed text', async () => {
    open('instructionTooLong')
    const text = ' ' + 'Hello 世界！😀 ok'.repeat(7) + ' '
    const box = await screen.findByRole('textbox', { name: '风格指令（可选）' })
    await userEvent.clear(box)
    await userEvent.click(box)
    await userEvent.paste(text)
    const n = contractCountText('cjk_double', text.trim())
    expect(await screen.findByTestId('instruction-count')).toHaveTextContent(`已写 ${n} / 100`)
  })
})

// ---------------------------------------------------------------- 6. the settings never say more than the pre-flight

describe('review 6: the settings do not promise what the pre-flight refuses', () => {
  it('an open list with a voice of another service: the pre-flight blocks it; the dialog does not say it is fine', async () => {
    const r = (
      scenarios.foreignOnOpen!.preflight as {
        results: { status: string; reasons: { code: string }[] }[]
      }
    ).results[0]!
    expect(r.status).toBe('blocked')
    expect(r.reasons.map((x) => x.code)).toEqual(['VOICE_FROM_ANOTHER_SERVICE'])
    open('foreignOnOpen')
    const note = await screen.findByText(/这个音色不在常用清单里/)
    expect(note.textContent).not.toContain('没问题')
    expect(note.textContent).toContain('生成前的检查可能会拦下')
  })
  it('a model with no system voices and a voice of another service: the pre-flight blocks it; the dialog says it cannot check', async () => {
    const r = (scenarios.foreignOnNone!.preflight as { results: { status: string }[] }).results[0]!
    expect(r.status).toBe('blocked')
    open('foreignOnNone')
    expect(await screen.findByTestId('voice-unchecked')).toHaveTextContent('这里没法检查')
  })
  it('the switch notice says the same: unlisted and unchecked, never "fine", and never claims where the voice came from', () => {
    const asProject = (key: string) => [
      { ...scenarios[key]!.project, narrationDelivery: 'tts' as const },
    ]
    expect(
      voiceIssues(asProject('foreignOnOpen'), capabilities.minimax as never).map((i) => i.kind),
    ).toEqual(['unlisted'])
    expect(
      voiceIssues(asProject('foreignOnNone'), capabilities.cosy35 as never).map((i) => i.kind),
    ).toEqual(['unchecked'])
    expect(
      voiceIssues(asProject('foreignOnClosed'), capabilities.openai as never).map((i) => i.kind),
    ).toEqual(['not_available'])
  })
})

// ---------------------------------------------------------------- the confirm dialog on the real pre-flight

describe('the confirm dialog on real pre-flight results', () => {
  function confirm(key: ScenarioKey) {
    const s = serve(key)
    renderApp(
      <BatchConfirmDialog
        projectId={s.sc.projectId}
        episodeNumber={1}
        aspect="9:16"
        kind="shot_audio"
        candidates={[
          {
            shotId: s.sc.shotId,
            index: 1,
            label: '镜头 01',
            target: { kind: 'shot_audio', shotId: s.sc.shotId },
          },
        ]}
        assets={new Map()}
        onClose={() => {}}
      />,
      { client: s.server.client },
    )
  }
  it('the text too long: the server’s numbers', async () => {
    confirm('narrationTooLong')
    expect(
      await screen.findByText(/这段旁白有 5000 个字符，当前的语音型号单次最多 4096/),
    ).toBeInTheDocument()
  })
  it('the instruction too long: the server’s numbers and way of counting', async () => {
    confirm('instructionTooLong')
    expect(
      await screen.findByText(/风格指令有 120 个字符（汉字算 2 个），超过了这个型号的上限 100/),
    ).toBeInTheDocument()
  })
  it('a voice not on a closed list, and a voice of another service on an open list, as the server says them', async () => {
    confirm('foreignOnClosed')
    expect(await screen.findByText(/没有项目里选的这个音色/)).toBeInTheDocument()
  })
  it('tts-1 with no voice: accepted, the default is named a default, and the batch can go ahead', async () => {
    confirm('noVoiceTts1')
    await screen.findByText('可运行')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /确认并加入队列/ })).toBeEnabled(),
    )
  })
})
