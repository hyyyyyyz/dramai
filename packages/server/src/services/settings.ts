import type { AppSettings } from '@dramai/api'
import type { ProviderKind } from '@dramai/core'
import type { ServerStore } from '../storage/sqlite-store.ts'

const KEY = 'app'

export const DEFAULT_SETTINGS: AppSettings = {
  activeProviders: {},
  cost: {},
}

const ACTIVE_FIELD: Record<ProviderKind, keyof AppSettings['activeProviders']> = {
  llm: 'llm',
  image: 'image',
  video: 'video',
  tts: 'tts',
}

/** 应用设置（存在 settings 表里一条 JSON）。 */
export class SettingsService {
  private readonly store: ServerStore
  constructor(store: ServerStore) {
    this.store = store
  }

  async get(): Promise<AppSettings> {
    const saved = await this.store.settings.get<Partial<AppSettings>>(KEY)
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      activeProviders: { ...saved?.activeProviders },
      cost: { ...saved?.cost },
    }
  }

  async put(settings: AppSettings): Promise<AppSettings> {
    await this.store.settings.set(KEY, settings)
    return this.get()
  }

  async patchActive(kind: ProviderKind, id: string | undefined): Promise<void> {
    const cur = await this.get()
    const next = { ...cur.activeProviders }
    if (id) next[ACTIVE_FIELD[kind]] = id
    else delete next[ACTIVE_FIELD[kind]]
    await this.put({ ...cur, activeProviders: next })
  }

  activeId(settings: AppSettings, kind: ProviderKind): string | undefined {
    return settings.activeProviders[ACTIVE_FIELD[kind]]
  }
}
