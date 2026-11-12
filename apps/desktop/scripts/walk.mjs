#!/usr/bin/env node
// 连上一个正在运行的桌面应用（带 --remote-debugging-port），走一遍短流程。
//   node scripts/walk.mjs --port 9444 [--mock http://127.0.0.1:8788]
import { connect, pageTarget } from './lib/cdp.mjs'
import { walkFlow } from './lib/walk.mjs'

const argv = process.argv.slice(2)
const get = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback)
const page = await connect(await pageTarget(Number(get('--port', '9444'))))
await walkFlow(page, {
  mockUrl: get('--mock'),
  report: (name, ok, detail = '') => {
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`)
    if (!ok) process.exitCode = 1
  },
})
page.close()
