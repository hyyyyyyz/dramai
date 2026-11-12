import { useContext } from 'react'
import type { DramaiClient } from '@dramai/api'
import { ApiContext } from './contexts'

export function useApi(): DramaiClient {
  return useContext(ApiContext)
}
