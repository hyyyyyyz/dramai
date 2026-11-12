import { createServer } from 'node:net'

/** 向系统要一个当前空闲的端口（只在回环地址上试）。 */
export function findFreePort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.unref()
    probe.once('error', reject)
    probe.listen(0, host, () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => (port ? resolve(port) : reject(new Error('no port assigned'))))
    })
  })
}

export function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.unref()
    probe.once('error', () => resolve(false))
    probe.listen(port, host, () => probe.close(() => resolve(true)))
  })
}

/**
 * 服务要监听的端口。
 *
 * 随机端口（让服务自己绑 0，没有“先探测、后绑定”的竞争），但**上次用过的端口空闲就继续用它**：
 * 页面的来源（含端口）不变，localStorage 里的语言、主题等偏好才能跨启动保留。
 * 返回 0 表示“让系统分配”。
 */
export async function chooseListenPort(
  preferred: number | undefined,
  host = '127.0.0.1',
): Promise<number> {
  if (preferred && (await isPortFree(preferred, host))) return preferred
  return 0
}
