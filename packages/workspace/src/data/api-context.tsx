import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { createClient, type DramaiClient } from '@dramai/api'
import { ApiContext } from './contexts'

/**
 * 所有对服务的调用都经过 @dramai/api 的类型化客户端；测试里可以换成假的。
 * 默认的客户端同源（baseUrl 留空），并带上界面语言（X-Dramai-Locale）：内置数据（风格预设名、服务商备注……）
 * 由服务端按语言返回，用户自己填的内容原样返回。切换语言后让所有查询重新取，内置数据才会跟着换。
 */
export function ApiProvider({ client, children }: { client?: DramaiClient; children: ReactNode }) {
  const { i18n } = useTranslation()
  const queryClient = useQueryClient()
  const lang = i18n.language.startsWith('zh') ? 'zh' : 'en'
  const value = useMemo(() => client ?? createClient({ locale: lang }), [client, lang])
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (!client) void queryClient.invalidateQueries()
  }, [lang, client, queryClient])
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>
}
