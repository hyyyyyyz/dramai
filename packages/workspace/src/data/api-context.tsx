import type { ReactNode } from 'react'
import type { DramaiClient } from '@dramai/api'
import { ApiContext } from './contexts'

/** 所有对服务的调用都经过 @dramai/api 的类型化客户端；测试里可以换成假的。 */
export function ApiProvider({ client, children }: { client?: DramaiClient; children: ReactNode }) {
  return client ? (
    <ApiContext.Provider value={client}>{children}</ApiContext.Provider>
  ) : (
    <>{children}</>
  )
}
