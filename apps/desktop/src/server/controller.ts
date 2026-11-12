import { createServer } from '@dramai/server'
import type { DramaiServer } from '@dramai/server'
import type { SecretStore } from '@dramai/core'
import { classifyStartError } from '../shared/protocol.ts'
import type { HostToServer, SecretOp, ServerToHost } from '../shared/protocol.ts'

type Pending = {
  resolve: (v: string | boolean | null | undefined) => void
  reject: (e: Error) => void
}

/**
 * 服务进程里的逻辑：收主进程的消息、起 / 停服务、把密钥读写转给主进程。
 * 不依赖 Electron（消息通道由调用方注入），所以能在普通 Node 里测试；`entry.ts` 只负责把它接到 parentPort 上。
 */
export function createServerController(
  post: (message: ServerToHost) => void,
  create: typeof createServer = createServer,
) {
  let server: DramaiServer | undefined
  let nextSecretId = 1
  const pending = new Map<number, Pending>()

  const secretCall = (op: SecretOp, ref: string, value?: string) =>
    new Promise<string | boolean | null | undefined>((resolve, reject) => {
      const id = nextSecretId++
      pending.set(id, { resolve, reject })
      post({ type: 'secret.request', id, op, ref, value })
    })

  /** 密钥存储：每次操作都问主进程（那里用操作系统的加密设施）。 */
  const remoteSecrets: SecretStore = {
    async get(ref) {
      const v = await secretCall('get', ref)
      return typeof v === 'string' ? v : undefined
    },
    async set(ref, value) {
      await secretCall('set', ref, value)
    },
    async delete(ref) {
      await secretCall('delete', ref)
    },
    async has(ref) {
      return (await secretCall('has', ref)) === true
    },
  }

  async function start(
    options: Extract<HostToServer, { type: 'start' }>['options'],
  ): Promise<void> {
    try {
      server = await create({
        dataDir: options.dataDir,
        host: '127.0.0.1',
        port: options.port,
        token: options.token,
        staticDir: options.staticDir,
        version: options.version,
        desktop: true,
        secretStore: remoteSecrets,
        demo: options.demoNotice ? { notice: options.demoNotice } : undefined,
        logger: {
          error: (...a) => post({ type: 'log', level: 'error', text: a.map(String).join(' ') }),
          info: (...a) => post({ type: 'log', level: 'info', text: a.map(String).join(' ') }),
        },
      })
      post({ type: 'ready', url: server.url, port: server.port })
    } catch (err) {
      post({
        type: 'start.failed',
        code: classifyStartError(err),
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function stop(graceful: boolean): Promise<void> {
    try {
      await server?.close({ graceful })
    } finally {
      server = undefined
      post({ type: 'stopped' })
    }
  }

  return {
    /** 处理一条来自主进程的消息；返回的 Promise 在这条消息处理完后结束（测试用）。 */
    handle(msg: HostToServer): Promise<void> {
      switch (msg.type) {
        case 'start':
          return start(msg.options)
        case 'stop':
          return stop(msg.graceful)
        case 'secret.result': {
          const p = pending.get(msg.id)
          if (p) {
            pending.delete(msg.id)
            if (msg.ok) p.resolve(msg.value)
            else p.reject(new Error(msg.error ?? 'secret operation failed'))
          }
          return Promise.resolve()
        }
      }
    },
  }
}
