import { EventEmitter } from 'node:events'
import type {
  HostToServer,
  ServerStartOptions,
  ServerToHost,
  StartFailureCode,
} from '../shared/protocol.ts'

/** utilityProcess 子进程里用到的那一小部分（测试时换成假的）。 */
export interface ChildHandle {
  postMessage(message: HostToServer): void
  on(event: 'message', listener: (message: ServerToHost) => void): unknown
  on(event: 'exit', listener: (code: number | null) => void): unknown
  kill(): boolean
}

export type ForkServer = () => ChildHandle

export interface SecretBackend {
  get(ref: string): Promise<string | undefined>
  set(ref: string, value: string): Promise<void>
  delete(ref: string): Promise<void>
  has(ref: string): Promise<boolean>
}

export class ServerStartError extends Error {
  readonly code: StartFailureCode
  constructor(code: StartFailureCode, message: string) {
    super(message)
    this.name = 'ServerStartError'
    this.code = code
  }
}

export interface ServerHostOptions {
  fork: ForkServer
  secrets: SecretBackend
  log?: (level: 'info' | 'error', text: string) => void
  /** 启动（含数据库迁移）最长等多久。 */
  startTimeoutMs?: number
  /** 通知服务关闭后，最长等多久；超时就强制结束进程（任务由下次启动的恢复逻辑接管）。 */
  stopTimeoutMs?: number
}

export interface ServerHostEvents {
  /** 服务进程在没有被要求停止的情况下退出了。 */
  crashed: [code: number | null]
}

type State = 'idle' | 'starting' | 'running' | 'stopping'

/**
 * 管理服务进程的生命周期：启动、转发密钥请求、正常关闭、异常退出的检测。
 * 只依赖 `ChildHandle`，不 import electron，所以能在没有显示的环境里测试。
 */
export class ServerHost extends EventEmitter<ServerHostEvents> {
  private child: ChildHandle | undefined
  private stateValue: State = 'idle'
  private info: { url: string; port: number } | undefined
  private readonly log: NonNullable<ServerHostOptions['log']>
  private readonly options: ServerHostOptions

  constructor(options: ServerHostOptions) {
    super()
    this.options = options
    this.log = options.log ?? (() => {})
  }

  get state(): State {
    return this.stateValue
  }

  get url(): string | undefined {
    return this.info?.url
  }

  get port(): number | undefined {
    return this.info?.port
  }

  start(serverOptions: ServerStartOptions): Promise<{ url: string; port: number }> {
    if (this.stateValue !== 'idle')
      return Promise.reject(new Error(`server host is ${this.stateValue}`))
    this.stateValue = 'starting'
    const child = this.options.fork()
    this.child = child

    return new Promise((resolve, reject) => {
      let settled = false
      const fail = (error: ServerStartError) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.stateValue = 'idle'
        this.child = undefined
        child.kill()
        reject(error)
      }
      const timer = setTimeout(
        () => fail(new ServerStartError('UNKNOWN', 'The local server did not start in time.')),
        this.options.startTimeoutMs ?? 90_000,
      )

      child.on('message', (message) => {
        switch (message.type) {
          case 'ready':
            if (settled) return
            settled = true
            clearTimeout(timer)
            this.info = { url: message.url, port: message.port }
            this.stateValue = 'running'
            resolve(this.info)
            break
          case 'start.failed':
            fail(new ServerStartError(message.code, message.message))
            break
          case 'secret.request':
            void this.answerSecret(child, message)
            break
          case 'log':
            this.log(message.level, `[server] ${message.text}`)
            break
          case 'stopped':
            break
        }
      })
      child.on('exit', (code) => {
        if (this.child !== child) return
        const wasStopping = this.stateValue === 'stopping'
        this.child = undefined
        this.info = undefined
        if (!settled) {
          fail(new ServerStartError('UNKNOWN', `The server process exited early (code ${code}).`))
          return
        }
        this.stateValue = 'idle'
        if (!wasStopping) {
          this.log('error', `server process exited unexpectedly (code ${code})`)
          this.emit('crashed', code)
        }
      })
      child.postMessage({ type: 'start', options: serverOptions })
    })
  }

  private async answerSecret(
    child: ChildHandle,
    request: Extract<ServerToHost, { type: 'secret.request' }>,
  ): Promise<void> {
    try {
      const secrets = this.options.secrets
      let value: string | boolean | null | undefined
      switch (request.op) {
        case 'get':
          value = (await secrets.get(request.ref)) ?? null
          break
        case 'set':
          await secrets.set(request.ref, request.value ?? '')
          break
        case 'delete':
          await secrets.delete(request.ref)
          break
        case 'has':
          value = await secrets.has(request.ref)
          break
      }
      child.postMessage({ type: 'secret.result', id: request.id, ok: true, value })
    } catch (err) {
      // 不把错误细节（可能含路径）以外的东西带回去；密钥值从不出现在错误里。
      this.log('error', `secret ${request.op} failed: ${String(err)}`)
      child.postMessage({
        type: 'secret.result',
        id: request.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * 关闭服务：让它先关数据库、释放数据目录锁，再结束进程。
   * `graceful: false`（默认）不等在跑的任务——它们留给下次启动的恢复逻辑（有上游任务号的续轮询，其余标记结果不明）。
   */
  async stop(options: { graceful?: boolean } = {}): Promise<void> {
    const child = this.child
    if (!child || this.stateValue === 'idle') return
    this.stateValue = 'stopping'
    const timeoutMs = this.options.stopTimeoutMs ?? 10_000

    await new Promise<void>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        this.log('error', 'server did not stop in time; killing it')
        finish()
      }, timeoutMs)
      child.on('message', (message) => {
        if (message.type === 'stopped') finish()
      })
      child.on('exit', finish)
      child.postMessage({ type: 'stop', graceful: options.graceful ?? false })
    })

    child.kill()
    this.child = undefined
    this.info = undefined
    this.stateValue = 'idle'
  }
}
