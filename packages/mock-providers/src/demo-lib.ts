import { isAbsolute, resolve } from 'node:path'

/**
 * 用户在命令行里写的相对路径，按**用户执行命令时所在的目录**解析。
 *
 * `pnpm demo`（和 npm / yarn 的脚本）会先把工作目录切到包目录再启动脚本，所以 `process.cwd()` 是
 * `packages/mock-providers`，不是用户所在的目录；包管理器会把用户当时所在的目录放进环境变量 `INIT_CWD`。
 * 直接用 `node` 启动时没有 `INIT_CWD`，用 `process.cwd()`。
 */
export function resolveUserPath(
  path: string,
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): string {
  return isAbsolute(path) ? path : resolve(env.INIT_CWD || cwd, path)
}

export type DemoLang = 'zh' | 'en'

export interface DemoProviderDef {
  label: string
  kind: 'llm' | 'image' | 'video' | 'tts'
  protocol:
    | 'openai-chat'
    | 'gemini-image'
    | 'openai-images'
    | 'aliyun-video'
    | 'volcengine-video'
    | 'openai-tts'
  model: string
  accept?: readonly string[]
}

/** 演示用的服务商配置；名称按语言给。用 kind + protocol + model 认它们（改了名称也不会重复创建）。 */
export function demoProviders(lang: DemoLang): DemoProviderDef[] {
  const zh = lang === 'zh'
  return [
    {
      label: zh ? '演示 · 大模型（DeepSeek 风格）' : 'Demo · LLM (DeepSeek style)',
      kind: 'llm',
      protocol: 'openai-chat',
      model: 'deepseek-chat',
    },
    {
      label: zh ? '演示 · 文生图（Nano Banana 风格）' : 'Demo · Image (Nano Banana style)',
      kind: 'image',
      protocol: 'gemini-image',
      model: 'gemini-2.5-flash-image',
      accept: ['mode:i2i', 'refImages', 'aspectRatio'],
    },
    {
      label: zh ? '演示 · 文生图（Seedream 风格）' : 'Demo · Image (Seedream style)',
      kind: 'image',
      protocol: 'openai-images',
      model: 'doubao-seedream-5-0-260128',
    },
    {
      label: zh ? '演示 · 图生视频（Wan Flash 风格）' : 'Demo · Video (Wan Flash style)',
      kind: 'video',
      protocol: 'aliyun-video',
      model: 'wan2.2-i2v-flash',
    },
    {
      label: zh
        ? '演示 · 图生视频（Seedance 风格，带人声）'
        : 'Demo · Video (Seedance style, with voice)',
      kind: 'video',
      protocol: 'volcengine-video',
      model: 'doubao-seedance-2-0-fast-260128',
      accept: ['mode:i2v', 'firstFrame', 'duration', 'resolution'],
    },
    {
      label: zh ? '演示 · 配音' : 'Demo · Voice-over',
      kind: 'tts',
      protocol: 'openai-tts',
      model: 'tts-1',
      accept: ['mode:tts'],
    },
  ]
}

export const DEMO_NOTICE = {
  zh: '演示模式：服务商是本机的模拟服务，不会产生任何费用，生成的是占位内容（不是真实作品）。',
  en: 'Demo mode: the providers are local simulations. Nothing is charged, and the generated content is placeholder, not real work.',
} as const
