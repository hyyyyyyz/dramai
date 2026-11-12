import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { createClient } from '@dramai/api'
import { defaultSleep } from '@dramai/core'
import { createServer } from '@dramai/server'
import { FAULT_KINDS } from './config.ts'
import type { FaultKind, MockConfig, MockKind } from './config.ts'
import { DEMO_NOTICE, demoProviders, resolveUserPath, writeDemoCatalog } from './demo-lib.ts'
import type { DemoLang } from './demo-lib.ts'
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
  --static-dir <p>    同时托管前端构建产物
                      相对路径按你执行命令时所在的目录解析，不是按包目录
  --fresh             启动前清空演示数据目录
  --lang <zh|en>      演示服务商的名称和终端提示用哪种语言（默认 zh；界面里的提示两种语言都带）
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
    lang: { type: 'string' },
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

const lang = (values.lang ?? 'zh') as DemoLang
if (lang !== 'zh' && lang !== 'en') fail(`--lang 只支持 zh / en，收到 "${values.lang}"`)

// 相对路径按用户执行命令时所在的目录解析（pnpm 会先切到包目录，见 resolveUserPath）。
const dataDir = resolveUserPath(
  values['data-dir'] ?? process.env.DRAMAI_DEMO_DIR ?? join(homedir(), '.dramai-demo'),
)
const staticDir = values['static-dir'] ? resolveUserPath(values['static-dir']) : undefined

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

if (values.fresh) await rm(dataDir, { recursive: true, force: true })

const mock = await startMockProviders({
  port: num(values['mock-port'], 'mock-port') ?? 8788,
  config,
  log: values.verbose ? (line) => console.log(`  mock ▸ ${line}`) : undefined,
}).catch(fail)

// 演示价格：普通的数据文件，放在演示数据目录的用户覆盖目录里，服务启动时加载。
await writeDemoCatalog(dataDir)

const server = await createServer({
  dataDir,
  host: '127.0.0.1',
  port: num(values.port, 'port') ?? 8787,
  staticDir,
  // 提示语两种语言都带：界面按用户的语言取（见 /api/system 的 demo.notice）。
  demo: { notice: DEMO_NOTICE },
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
const isDemoLabel = (label: string) => label.startsWith('演示') || label.startsWith('Demo')
const existing = (await client.call('providers.list')).items
for (const w of demoProviders(lang)) {
  // 用 kind + protocol + model 认已有的演示配置：换了语言 / 端口重启，只更新名称和地址，不重复创建。
  const found = existing.find(
    (p) =>
      p.kind === w.kind && p.protocol === w.protocol && p.model === w.model && isDemoLabel(p.label),
  )
  if (found) {
    if (found.baseUrl !== mock.url || found.label !== w.label) {
      await client.call('providers.update', {
        params: { providerId: found.id },
        body: { baseUrl: mock.url, label: w.label },
      })
    }
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
  if (w.accept) {
    await client.call('providers.acceptUnverified', {
      params: { providerId: created.id },
      body: { keys: [...w.accept] },
    })
  }
}

const bar = '═'.repeat(64)
const c = mock.config
const zh = lang === 'zh'
console.log(`\n${bar}`)
console.log(zh ? '  DRAMAI · 演示模式' : '  DRAMAI · DEMO MODE')
console.log(bar)
if (zh) {
  console.log('  这是演示：所有“AI 服务商”都是本机的模拟服务，不会产生任何费用。')
  console.log('  生成的图片、视频、配音都是占位内容（带编号的色块、测试画面、简单音调），')
  console.log('  大模型的分集 / 分镜是本地规则算出来的——只用来走通整条流程，不是真实作品。')
  console.log('  费用预估里的金额是虚构的演示价格，币种 DMO（不是任何真实货币）。')
} else {
  console.log('  This is a demo: every "AI provider" is a local simulation. Nothing is charged.')
  console.log('  Images, videos and voice-overs are placeholders (numbered colour blocks, test')
  console.log(
    '  patterns, simple tones); episodes and shots come from local rules — not real work.',
  )
}
console.log(bar)
console.log(`  ${zh ? '界面 / 接口  ' : 'App / API     '} ${server.url}`)
console.log(
  `  ${zh ? '模拟服务商  ' : 'Mock providers'} ${mock.url}   (${zh ? '控制面' : 'control'} ${mock.url}/__mock/state)`,
)
console.log(
  `  ${zh ? '演示数据目录' : 'Demo data dir'} ${dataDir}   (${zh ? '与正式数据分开；--fresh 清空' : 'separate from real data; --fresh wipes it'})`,
)
if (staticDir) console.log(`  ${zh ? '前端文件    ' : 'Static files '} ${staticDir}`)
console.log(
  `  ${zh ? '延迟' : 'latency'} ${c.latencyMs}ms${c.jitterMs ? `+0..${c.jitterMs}ms` : ''} · ${zh ? '视频' : 'video'} ${c.videoMs}ms · ${zh ? '随机失败' : 'random failures'} ${Math.round(c.failureRate * 100)}%${c.failureRate ? ` (${c.failureKinds.join('/')} → ${c.failureOn.join('/')}, seed ${c.seed})` : ''}`,
)
console.log(
  zh
    ? '  想让某个请求失败：在提示词里写 [[mock:rate_limit]]；更多见 pnpm demo --help'
    : '  Make one request fail: put [[mock:rate_limit]] in a prompt; see pnpm demo --help',
)
if (!(await client.call('system.get')).ffmpeg.found) {
  console.log(
    zh
      ? '  ⚠ 没找到 ffmpeg：占位视频和成片合成都需要它（安装后重启）。'
      : '  ⚠ ffmpeg not found: placeholder videos and cut composition need it (install, then restart).',
  )
}
console.log(`${bar}\n`)

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
