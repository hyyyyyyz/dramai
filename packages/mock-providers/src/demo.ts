import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { createClient } from '@dramai/api'
import { defaultSleep } from '@dramai/core'
import { createServer } from '@dramai/server'
import { FAULT_KINDS } from './config.ts'
import type { FaultKind, MockConfig, MockKind } from './config.ts'
import { startMockProviders } from './server.ts'

/**
 * 演示入口：一条命令同时起本地服务和模拟服务商，使用独立的演示数据目录，并自动建好指向模拟服务商的服务商配置。
 *
 *   pnpm demo [--fresh] [--latency 800] [--fail-rate 0.15 --fail-kinds rate_limit,upstream_failed] ...
 *
 * 这是开发 / 演示工具：正式的启动路径（@dramai/server 的 dev.ts / 桌面版 / 命令行启动器）不依赖它。
 */

const HELP = `用法：pnpm demo [选项]

  --port <n>          界面 / 接口端口（默认 8787）
  --mock-port <n>     模拟服务商端口（默认 8788）
  --data-dir <path>   演示数据目录（默认 ~/.dramai-demo，与正式数据完全分开）
  --fresh             启动前清空演示数据目录
  --static-dir <p>    同时托管前端构建产物
  --latency <ms>      每个请求的固定延迟
  --jitter <ms>       再随机加 0..jitter 毫秒
  --video-ms <ms>     视频任务从提交到完成要多久（默认 3000）
  --fail-rate <0..1>  随机失败的概率（默认 0）
  --fail-kinds <a,b>  随机失败从这些里选：${FAULT_KINDS.join(' / ')}
  --fail-on <a,b>     随机失败作用于：llm / image / video / tts（默认 image,video,tts）
  --seed <n>          随机种子（同样的种子 + 同样的操作顺序 = 同样的失败）
  --verbose           打印模拟服务商收到的每个请求
  -h, --help

运行中也可以改：GET/PUT http://127.0.0.1:<mock-port>/__mock/config，POST /__mock/rules。
想让某一个请求失败：在提示词里写 [[mock:rate_limit]]（可用的故障见上）。`

function fail(err: unknown): never {
  console.error(`dramai demo: 无法启动：${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}

const { values } = parseArgs({
  options: {
    port: { type: 'string' },
    'mock-port': { type: 'string' },
    'data-dir': { type: 'string' },
    fresh: { type: 'boolean' },
    'static-dir': { type: 'string' },
    latency: { type: 'string' },
    jitter: { type: 'string' },
    'video-ms': { type: 'string' },
    'fail-rate': { type: 'string' },
    'fail-kinds': { type: 'string' },
    'fail-on': { type: 'string' },
    seed: { type: 'string' },
    verbose: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
})
if (values.help) {
  console.log(HELP)
  process.exit(0)
}

const num = (v: string | undefined, name: string): number | undefined => {
  if (v === undefined) return undefined
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) fail(`--${name} 需要一个非负数字，收到 "${v}"`)
  return n
}
const list = <T extends string>(
  v: string | undefined,
  allowed: readonly T[],
  name: string,
): T[] | undefined => {
  if (v === undefined) return undefined
  const items = v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const bad = items.find((i) => !(allowed as readonly string[]).includes(i))
  if (bad) fail(`--${name} 里有不认识的 "${bad}"，可用：${allowed.join(' / ')}`)
  return items as T[]
}

const dataDir = values['data-dir'] ?? process.env.DRAMAI_DEMO_DIR ?? join(homedir(), '.dramai-demo')
const config: Partial<MockConfig> = {
  latencyMs: num(values.latency, 'latency'),
  jitterMs: num(values.jitter, 'jitter'),
  videoMs: num(values['video-ms'], 'video-ms'),
  failureRate: num(values['fail-rate'], 'fail-rate'),
  failureKinds: list<FaultKind>(values['fail-kinds'], FAULT_KINDS, 'fail-kinds'),
  failureOn: list<MockKind>(values['fail-on'], ['llm', 'image', 'video', 'tts'], 'fail-on'),
  seed: num(values.seed, 'seed'),
}
for (const k of Object.keys(config) as Array<keyof MockConfig>)
  if (config[k] === undefined) delete config[k]

const NOTICE =
  '演示模式：服务商是本机的模拟服务，不会产生任何费用，生成的是占位内容（不是真实作品）。'

if (values.fresh) await rm(dataDir, { recursive: true, force: true })

const mock = await startMockProviders({
  port: num(values['mock-port'], 'mock-port') ?? 8788,
  config,
  log: values.verbose ? (line) => console.log(`  mock ▸ ${line}`) : undefined,
}).catch(fail)

const server = await createServer({
  dataDir,
  host: '127.0.0.1',
  port: num(values.port, 'port') ?? 8787,
  staticDir: values['static-dir'],
  demo: { notice: NOTICE },
  // 演示里把服务商轮询间隔压到 1.5 秒以内，不然每个视频要等 10 秒起步。
  executor: { sleep: (ms, signal) => defaultSleep(Math.min(ms, 1500), signal) },
  logger: console,
}).catch(async (err) => {
  await mock.close()
  return fail(err)
})

// 服务商配置：走正常的接口创建，指向模拟服务商，和用户自己加的配置没有任何区别。
const client = createClient({ baseUrl: server.url })
const KEY = 'mock-key-not-a-secret'
const wanted = [
  {
    label: '演示 · 大模型（DeepSeek 风格）',
    kind: 'llm',
    protocol: 'openai-chat',
    model: 'deepseek-chat',
  },
  {
    label: '演示 · 文生图（Nano Banana 风格）',
    kind: 'image',
    protocol: 'gemini-image',
    model: 'gemini-2.5-flash-image',
    accept: ['mode:i2i', 'refImages', 'aspectRatio'],
  },
  {
    label: '演示 · 文生图（Seedream 风格）',
    kind: 'image',
    protocol: 'openai-images',
    model: 'doubao-seedream-5-0-260128',
  },
  {
    label: '演示 · 图生视频（Wan Flash 风格）',
    kind: 'video',
    protocol: 'aliyun-video',
    model: 'wan2.2-i2v-flash',
  },
  {
    label: '演示 · 图生视频（Seedance 风格，带人声）',
    kind: 'video',
    protocol: 'volcengine-video',
    model: 'doubao-seedance-2-0-fast-260128',
    accept: ['mode:i2v', 'firstFrame', 'duration', 'resolution'],
  },
  {
    label: '演示 · 配音',
    kind: 'tts',
    protocol: 'openai-tts',
    model: 'tts-1',
    accept: ['mode:tts'],
  },
] as const
const existing = (await client.call('providers.list')).items
for (const w of wanted) {
  const found = existing.find((p) => p.label === w.label)
  if (found) {
    if (found.baseUrl !== mock.url)
      await client.call('providers.update', {
        params: { providerId: found.id },
        body: { baseUrl: mock.url },
      })
    continue
  }
  const created = await client.call('providers.create', {
    body: {
      label: w.label,
      kind: w.kind,
      protocol: w.protocol,
      baseUrl: mock.url,
      model: w.model,
      apiKey: KEY,
    },
  })
  if ('accept' in w) {
    await client.call('providers.acceptUnverified', {
      params: { providerId: created.id },
      body: { keys: [...w.accept] },
    })
  }
}

const bar = '═'.repeat(64)
console.log(`\n${bar}`)
console.log('  DRAMAI · 演示模式')
console.log(bar)
console.log('  这是演示：所有“AI 服务商”都是本机的模拟服务，不会产生任何费用。')
console.log('  生成的图片、视频、配音都是占位内容（带编号的色块、测试画面、简单音调），')
console.log('  大模型的分集 / 分镜是本地规则算出来的——只用来走通整条流程，不是真实作品。')
console.log(bar)
console.log(`  界面 / 接口     ${server.url}`)
console.log(`  模拟服务商      ${mock.url}   （控制面 ${mock.url}/__mock/state）`)
console.log(`  演示数据目录    ${dataDir}   （与正式数据分开；--fresh 清空）`)
const c = mock.config
console.log(
  `  延迟 ${c.latencyMs}ms${c.jitterMs ? `+0..${c.jitterMs}ms` : ''} · 视频 ${c.videoMs}ms · 随机失败 ${Math.round(c.failureRate * 100)}%${c.failureRate ? `（${c.failureKinds.join('/')} → ${c.failureOn.join('/')}，种子 ${c.seed}）` : ''}`,
)
console.log('  想让某个请求失败：在提示词里写 [[mock:rate_limit]]；更多见 pnpm demo --help')
if (!(await mockHasFfmpeg()))
  console.log('  ⚠ 没找到 ffmpeg：占位视频和成片合成都需要它（安装后重启）。')
console.log(`${bar}\n`)

async function mockHasFfmpeg(): Promise<boolean> {
  const info = await client.call('system.get')
  return info.ffmpeg.found
}

let stopping = false
const stop = async () => {
  if (stopping) return
  stopping = true
  await server.close()
  await mock.close()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
