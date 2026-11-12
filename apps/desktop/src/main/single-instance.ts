/** Electron `app` 里单实例相关的那一小部分（便于测试时换成假的）。 */
export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean
  on(event: 'second-instance', listener: (event: unknown, argv: string[]) => void): unknown
  quit(): void
}

/**
 * 单实例：拿不到锁说明已经有一个在运行，这次启动直接退出（已运行的那个会收到 `second-instance`，把窗口提到前面）。
 * 返回 true 表示本进程是唯一实例，可以继续启动。
 */
export function acquireSingleInstance(app: SingleInstanceApp, onSecondLaunch: () => void): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }
  app.on('second-instance', () => onSecondLaunch())
  return true
}
