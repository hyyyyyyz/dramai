#!/usr/bin/env node
// 冒烟检查：启动应用 → 等本地服务健康 → 加载首屏 → 验证安全边界 → 正常退出。
//
//   node scripts/smoke.mjs                      源码形态（electron + dist/，需先 pnpm --filter @dramai/desktop build）
//   node scripts/smoke.mjs --app <可执行文件>    打包形态（如 release/mac-arm64/Dramai.app/Contents/MacOS/Dramai）
//   --arg=<switch>   extra switch for the packaged app (repeatable)
//   --full   再走完整的验证：用模拟服务商走一遍短流程（建项目 → 上传 → 规划分集）、
//            确认密钥是系统加密落盘的、重启后端口和密钥都还在、第二次启动会把已有窗口提到前面
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import {
  apiCall,
  connect,
  launch,
  pageTarget,
  readAppLogs,
  terminate,
  waitFor,
} from './lib/cdp.mjs'
import { walkFlow } from './lib/walk.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const argv = process.argv.slice(2)
const flag = (name) => argv.indexOf(name)
const appPath = flag('--app') >= 0 ? argv[flag('--app') + 1] : undefined
const keep = argv.includes('--keep')
const full = argv.includes('--full')

const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`)
}

function rawGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = request({ host: u.hostname, port: u.port, path: u.pathname, headers }, (res) => {
      res.resume()
      resolve(res.statusCode)
    })
    req.on('error', reject)
    req.end()
  })
}

const work = await mkdtemp(join(tmpdir(), 'dramai-smoke-'))
const userData = join(work, 'user-data')
const dataDir = join(work, 'data')
let command, args, cwd
if (appPath) {
  command = appPath
  // Extra switches for the app, e.g. `--arg=--no-sandbox` on a CI Linux runner that blocks user namespaces.
  args = argv.filter((a) => a.startsWith('--arg=')).map((a) => a.slice('--arg='.length))
} else {
  const require = createRequire(import.meta.url)
  command = require('electron')
  args = ['.']
  cwd = root
}

console.log(`mode: ${appPath ? `packaged (${appPath})` : 'source'}`)
const app = await launch({
  command,
  args,
  cwd,
  userDataDir: userData,
  env: { DRAMAI_DATA_DIR: dataDir, DRAMAI_DESKTOP_QUIET: '1' },
})
let failed = false
let mock
try {
  const target = await pageTarget(app.port)
  const page = await connect(target)
  const origin = new URL(target.url).origin
  check(
    'window loads the local server on a loopback port',
    /^http:\/\/127\.0\.0\.1:\d+$/.test(origin),
    origin,
  )
  check('token is not in the page URL', !/token/i.test(target.url), target.url)

  const rendered = await waitFor(
    () => page.evaluate(`document.querySelector('#root')?.childElementCount > 0`),
    { what: 'first screen rendered', timeoutMs: 45_000 },
  )
  check('first screen rendered (React root has content)', rendered)

  const health = await apiCall(page, 'GET', '/api/health')
  check('GET /api/health', health.status === 200 && health.body?.ok === true)
  const system = await apiCall(page, 'GET', '/api/system')
  check(
    'GET /api/system reports desktop: true',
    system.status === 200 && system.body?.desktop === true,
  )
  check('auth required by the server', system.body?.auth?.tokenRequired === true)
  check('data dir is the one asked for', system.body?.dataDir === dataDir, system.body?.dataDir)
  console.log(
    `   version ${system.body?.version} · ffmpeg ${system.body?.ffmpeg?.found ? system.body.ffmpeg.path : 'not found'}`,
  )

  const bridge = await page.evaluate(
    `(async () => ({ keys: Object.keys(window.dramaiDesktop ?? {}), info: await window.dramaiDesktop?.getInfo(), node: typeof require + typeof process }))()`,
  )
  check(
    'preload bridge exposes only the small API',
    bridge.keys.sort().join() === 'getInfo,notify,revealProjectFile,selectFolder,setLanguage',
    bridge.keys.join(),
  )
  check(
    'renderer has no Node (sandbox / contextIsolation)',
    bridge.node === 'undefinedundefined',
    bridge.node,
  )
  check(
    'bridge getInfo()',
    bridge.info?.dataDir === dataDir && bridge.info?.version === system.body?.version,
    JSON.stringify(bridge.info),
  )

  // —— 其他本地客户端够不着 ——
  const url = origin
  check('no token → 401', (await rawGet(`${url}/api/system`)) === 401)
  check(
    'wrong token → 401',
    (await rawGet(`${url}/api/system`, { Authorization: 'Bearer nope-nope-nope-nope' })) === 401,
  )
  check(
    'rebinding Host header → 403',
    (await rawGet(`${url}/api/health`, { Host: 'evil.example.com' })) === 403,
  )
  check('cookies: none set for the page', (await page.evaluate('document.cookie')) === '')

  await writeFile(join(work, 'smoke.png'), await page.screenshot())
  page.close()

  if (full) {
    // —— 完整流程：模拟服务商 + 短流程 ——
    mock = spawn(
      process.execPath,
      [
        '--conditions=dramai-source',
        '--experimental-strip-types',
        '--disable-warning=ExperimentalWarning',
        join(root, 'scripts/mock-providers.mjs'),
        '8788',
      ],
      { cwd: root, stdio: 'ignore' },
    )
    await waitFor(
      () =>
        fetch('http://127.0.0.1:8788/')
          .then((r) => r.status < 500)
          .catch(() => false),
      { what: 'mock providers' },
    )
    const page2 = await connect(target)
    await walkFlow(page2, { mockUrl: 'http://127.0.0.1:8788', report: check })
    const providers = await apiCall(page2, 'GET', '/api/providers')
    const llm = providers.body.items.find((p) => p.kind === 'llm')
    const secrets = JSON.parse(await readFile(join(dataDir, 'secrets.json'), 'utf8'))
    check(
      'secrets.json is OS-encrypted and holds no plaintext key',
      secrets.cipher === 'electron-safe-storage' &&
        !JSON.stringify(secrets).includes('mock-key-not-a-secret'),
      secrets.cipher,
    )

    // 第二次启动：已有实例收到 second-instance，新进程自己退出。
    const second = spawn(command, [...args, `--user-data-dir=${userData}`], {
      cwd,
      env: { ...process.env, DRAMAI_DATA_DIR: dataDir, DRAMAI_DESKTOP_QUIET: '1' },
      stdio: 'ignore',
    })
    const secondExit = await Promise.race([
      new Promise((resolve) => second.on('exit', (code) => resolve(code))),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 15_000)),
    ])
    if (secondExit === 'timeout') second.kill('SIGKILL')
    check('second launch exits immediately (single instance)', secondExit === 0, String(secondExit))
    check(
      'first instance still serves after the second launch',
      (await apiCall(page2, 'GET', '/api/health')).status === 200,
    )
    page2.close()
    globalThis.__walkProvider = llm?.id
  }

  // —— 正常退出：服务关闭、数据库关闭、数据目录锁释放 ——
  const exit = await terminate(app)
  check(
    'app exits cleanly when asked to quit',
    exit.code === 0 && !exit.timeout,
    JSON.stringify(exit),
  )
  check('data dir lock released', !existsSync(join(dataDir, 'dramai.lock')))
  check('database file present', existsSync(join(dataDir, 'dramai.sqlite')))

  if (full) {
    // —— 重启：端口不变（页面的 localStorage 才能保留）、密钥还能解开 ——
    const app2 = await launch({
      command,
      args,
      cwd,
      userDataDir: userData,
      env: { DRAMAI_DATA_DIR: dataDir, DRAMAI_DESKTOP_QUIET: '1' },
    })
    try {
      const target2 = await pageTarget(app2.port)
      const page3 = await connect(target2)
      await waitFor(
        () => page3.evaluate(`location.protocol === 'http:' && document.readyState === 'complete'`),
        { what: 'page after restart' },
      )
      check(
        'same origin after restart (sticky port)',
        new URL(target2.url).origin === origin,
        `${origin} → ${new URL(target2.url).origin}`,
      )
      const test = await apiCall(page3, 'POST', `/api/providers/${globalThis.__walkProvider}/test`)
      check(
        'provider key still decrypts after restart (provider test ok)',
        test.status === 200 && test.body?.ok !== false,
        JSON.stringify(test.body).slice(0, 120),
      )
      const projects = await apiCall(page3, 'GET', '/api/projects')
      check(
        'project survived the restart',
        projects.body.items?.length >= 1,
        `${projects.body.items?.length} project(s)`,
      )
      page3.close()
    } finally {
      const exit2 = await terminate(app2)
      check('second run exits cleanly', exit2.code === 0 && !exit2.timeout, JSON.stringify(exit2))
    }
  }
  mock?.kill('SIGTERM')
} catch (err) {
  failed = true
  console.error('✗ smoke failed:', err.message)
  console.error(await diagnose(app, userData))
  app.child.kill('SIGKILL')
  mock?.kill('SIGKILL')
}
if (!failed && checks.some((c) => !c.ok)) {
  failed = true
  console.error(await diagnose(app, userData))
}
console.log(failed ? '\nSMOKE FAILED' : '\nSMOKE OK')
if (keep) console.log(`kept: ${work} (screenshot: ${join(work, 'smoke.png')})`)
else await rm(work, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
