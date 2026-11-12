import type {} from 'electron'
import type { HostToServer, ServerToHost } from '../shared/protocol.ts'
import { createServerController } from './controller.ts'

/**
 * 服务进程入口（Electron utilityProcess）。
 *
 * 在这里跑本地服务而不是主进程：`node:sqlite` 是同步调用、文档解析和大文件上传是 CPU 密集的，
 * 放在主进程会让菜单、窗口、系统对话框一起卡住；服务崩溃时也只丢这个进程，主进程能提示并重启它。
 * 密钥明文只在这里短暂出现——加解密（safeStorage 只能在主进程用）通过消息交给主进程。
 */
const parentPort = process.parentPort
const post = (message: ServerToHost) => parentPort.postMessage(message)
const controller = createServerController(post)

parentPort.on('message', (event) => {
  void controller.handle(event.data as HostToServer)
})

process.on('uncaughtException', (err) => {
  post({ type: 'log', level: 'error', text: `uncaughtException: ${err.stack ?? err.message}` })
  process.exit(1)
})
process.on('unhandledRejection', (err) => {
  post({ type: 'log', level: 'error', text: `unhandledRejection: ${String(err)}` })
})
