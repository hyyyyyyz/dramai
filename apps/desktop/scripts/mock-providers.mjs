// 演示模式用：起模拟服务商（和 `pnpm demo` 里是同一个实现），打印地址后一直运行。
// 由 scripts/dev.mjs 以 `node --conditions=dramai-source --experimental-strip-types` 启动。
import { startMockProviders } from '@dramai/mock-providers'

const port = Number(process.argv[2] ?? 8788)
const mock = await startMockProviders({ port, config: { latencyMs: 300, videoMs: 4000 } })
console.log(`mock providers ready at ${mock.url}`)
const stop = async () => {
  await mock.close()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
