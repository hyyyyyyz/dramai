import { createContext } from 'react'
import { createClient, type DramaiClient } from '@dramai/api'
import type { EventStore } from './events'

/** 默认客户端：同源，baseUrl 留空；开发时由 vite 把 /api 代理到本地服务。 */
export const ApiContext = createContext<DramaiClient>(createClient())
export const StoreContext = createContext<EventStore | null>(null)
