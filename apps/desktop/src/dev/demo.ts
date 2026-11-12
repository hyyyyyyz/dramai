import { createClient } from '@dramai/api'

/**
 * 演示模式（只在开发构建里存在）：给刚起来的服务建一组指向本机模拟服务商（@dramai/mock-providers）的服务商配置，
 * 这样不用任何 Key、不花钱就能走通整条流程。和 `pnpm demo` 做的事一样，走的是正常的服务接口。
 */
const KEY = 'mock-key-not-a-secret'

interface Def {
  label: { zh: string; en: string }
  kind: 'llm' | 'image' | 'video' | 'tts'
  protocol: 'openai-chat' | 'gemini-image' | 'openai-images' | 'aliyun-video' | 'openai-tts'
  model: string
  accept?: string[]
}

const DEFS: Def[] = [
  {
    label: { zh: '演示 · 大模型', en: 'Demo · LLM' },
    kind: 'llm',
    protocol: 'openai-chat',
    model: 'deepseek-chat',
  },
  {
    label: { zh: '演示 · 文生图', en: 'Demo · Image' },
    kind: 'image',
    protocol: 'gemini-image',
    model: 'gemini-2.5-flash-image',
    accept: ['mode:i2i', 'refImages', 'aspectRatio'],
  },
  {
    label: { zh: '演示 · 图生视频', en: 'Demo · Video' },
    kind: 'video',
    protocol: 'aliyun-video',
    model: 'wan2.2-i2v-flash',
  },
  {
    label: { zh: '演示 · 配音', en: 'Demo · Voice-over' },
    kind: 'tts',
    protocol: 'openai-tts',
    model: 'tts-1',
    accept: ['mode:tts'],
  },
]

export async function seedDemo(options: {
  serverUrl: string
  token: string
  mockUrl: string
  lang: 'zh' | 'en'
}): Promise<void> {
  const client = createClient({
    baseUrl: options.serverUrl,
    token: options.token,
  })
  const existing = (await client.call('providers.list')).items
  for (const def of DEFS) {
    const label = def.label[options.lang]
    const found = existing.find(
      (p) =>
        p.kind === def.kind &&
        p.protocol === def.protocol &&
        p.model === def.model &&
        /^(演示|Demo)/.test(p.label),
    )
    if (found) {
      if (found.baseUrl !== options.mockUrl) {
        await client.call('providers.update', {
          params: { providerId: found.id },
          body: { baseUrl: options.mockUrl },
        })
      }
      continue
    }
    const created = await client.call('providers.create', {
      body: {
        label,
        kind: def.kind,
        protocol: def.protocol,
        baseUrl: options.mockUrl,
        model: def.model,
        apiKey: KEY,
      },
    })
    if (def.accept) {
      await client.call('providers.acceptUnverified', {
        params: { providerId: created.id },
        body: { keys: def.accept },
      })
    }
  }
}
