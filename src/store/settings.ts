import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import type { ActiveProviderMap, Provider, ProviderKind } from '@/types/domain'

interface SettingsState {
  providers: Provider[]
  activeProviderIds: ActiveProviderMap

  addProvider: (input: Omit<Provider, 'id'>) => Provider
  updateProvider: (id: string, patch: Partial<Omit<Provider, 'id'>>) => void
  removeProvider: (id: string) => void
  setActiveProvider: (kind: ProviderKind, id: string | undefined) => void
  resetAll: () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      providers: [],
      activeProviderIds: {},

      addProvider: (input) => {
        const provider: Provider = { id: nanoid(10), ...input }
        set((state) => {
          // 该 kind 下还没有激活项时，新建的自动激活
          const activeProviderIds = { ...state.activeProviderIds }
          if (!activeProviderIds[provider.kind]) {
            activeProviderIds[provider.kind] = provider.id
          }
          return {
            providers: [...state.providers, provider],
            activeProviderIds,
          }
        })
        return provider
      },

      updateProvider: (id, patch) => {
        set((state) => ({
          providers: state.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        }))
      },

      removeProvider: (id) => {
        set((state) => {
          const activeProviderIds = { ...state.activeProviderIds }
          for (const key of Object.keys(activeProviderIds) as ProviderKind[]) {
            if (activeProviderIds[key] === id) {
              delete activeProviderIds[key]
            }
          }
          return {
            providers: state.providers.filter((p) => p.id !== id),
            activeProviderIds,
          }
        })
      },

      setActiveProvider: (kind, id) => {
        set((state) => {
          const activeProviderIds = { ...state.activeProviderIds }
          if (id) {
            activeProviderIds[kind] = id
          } else {
            delete activeProviderIds[kind]
          }
          return { activeProviderIds }
        })
      },

      resetAll: () => set({ providers: [], activeProviderIds: {} }),
    }),
    {
      name: 'dramai-settings',
      version: 1,
    },
  ),
)

/** 取出某个 kind 当前激活的 provider；没有就 undefined。 */
export function useActiveProvider(kind: ProviderKind): Provider | undefined {
  return useSettingsStore((s) => {
    const id = s.activeProviderIds[kind]
    if (!id) return undefined
    return s.providers.find((p) => p.id === id)
  })
}
