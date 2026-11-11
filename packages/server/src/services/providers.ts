import type { ProviderConfigDto } from '@dramai/api'
import { configFromPreset, PROVIDER_PRESETS, testProvider } from '@dramai/core'
import type {
  Clock,
  ExecutorDeps,
  IdGenerator,
  ModelRegistry,
  ProviderConfig,
  ProviderKind,
  SecretStore,
  TestConnectionResult,
} from '@dramai/core'
import { notFound } from '../errors.ts'
import { maskSecret } from '../secrets.ts'
import type { ServerStore } from '../storage/sqlite-store.ts'
import type { SettingsService } from './settings.ts'

export const secretRefFor = (providerId: string): string => `provider:${providerId}`

export interface ProviderServiceDeps {
  store: ServerStore
  secrets: SecretStore
  settings: SettingsService
  models: ModelRegistry
  ids: IdGenerator
  clock: Clock
  executor?: ExecutorDeps
}

/** 服务商配置的增删改查。Key 只写进 SecretStore，对外只给掩码。 */
export class ProviderService {
  private readonly d: ProviderServiceDeps
  constructor(deps: ProviderServiceDeps) {
    this.d = deps
  }

  async toDto(cfg: ProviderConfig): Promise<ProviderConfigDto> {
    const key = cfg.secretRef ? await this.d.secrets.get(cfg.secretRef) : undefined
    const { capabilityOverrides, ...withRef } = cfg
    const rest: Omit<ProviderConfig, 'secretRef'> & { secretRef?: string } = withRef
    delete rest.secretRef
    return {
      ...rest,
      ...(capabilityOverrides ? { capabilityOverrides: { ...capabilityOverrides } } : {}),
      hasKey: key !== undefined && key !== '',
      keyMask: maskSecret(key),
    }
  }

  async list(): Promise<ProviderConfig[]> {
    return this.d.store.providers.list()
  }

  async require(id: string): Promise<ProviderConfig> {
    const cfg = await this.d.store.providers.get(id)
    if (!cfg) throw notFound('服务商配置', id)
    return cfg
  }

  async create(
    input: Omit<ProviderConfig, 'id' | 'secretRef' | 'enabled'> & { enabled?: boolean },
    apiKey?: string,
  ): Promise<ProviderConfig> {
    const id = this.d.ids.next('prov')
    const cfg: ProviderConfig = {
      ...input,
      id,
      enabled: input.enabled ?? true,
      secretRef: apiKey ? secretRefFor(id) : undefined,
    }
    if (apiKey) await this.d.secrets.set(secretRefFor(id), apiKey)
    await this.d.store.providers.put(cfg)
    await this.autoActivate(cfg)
    return cfg
  }

  async createFromPreset(presetId: string, options: { apiKey?: string; label?: string }) {
    const preset = PROVIDER_PRESETS.find((p) => p.id === presetId)
    if (!preset) throw notFound('预设', presetId)
    const id = this.d.ids.next('prov')
    const cfg = configFromPreset(preset, {
      id,
      secretRef: options.apiKey ? secretRefFor(id) : undefined,
    })
    if (options.label) cfg.label = options.label
    if (options.apiKey) await this.d.secrets.set(secretRefFor(id), options.apiKey)
    await this.d.store.providers.put(cfg)
    await this.autoActivate(cfg)
    return cfg
  }

  /** 某一类服务还没有选中的服务商时，第一个添加的自动成为当前选择（少一步设置）。 */
  private async autoActivate(cfg: ProviderConfig): Promise<void> {
    const settings = await this.d.settings.get()
    if (!this.d.settings.activeId(settings, cfg.kind) && cfg.enabled) {
      await this.d.settings.patchActive(cfg.kind, cfg.id)
    }
  }

  async update(id: string, patch: Partial<Omit<ProviderConfig, 'id' | 'secretRef'>>) {
    const cur = await this.require(id)
    const next: ProviderConfig = { ...cur, ...patch }
    await this.d.store.providers.put(next)
    return next
  }

  async delete(id: string): Promise<void> {
    const cfg = await this.require(id)
    if (cfg.secretRef) await this.d.secrets.delete(cfg.secretRef)
    await this.d.store.providers.delete(id)
    const settings = await this.d.settings.get()
    for (const kind of ['llm', 'image', 'video', 'tts'] as ProviderKind[]) {
      if (this.d.settings.activeId(settings, kind) === id)
        await this.d.settings.patchActive(kind, undefined)
    }
  }

  async setKey(id: string, apiKey: string): Promise<ProviderConfig> {
    const cfg = await this.require(id)
    const ref = cfg.secretRef ?? secretRefFor(id)
    await this.d.secrets.set(ref, apiKey)
    const next = { ...cfg, secretRef: ref }
    await this.d.store.providers.put(next)
    return next
  }

  async clearKey(id: string): Promise<ProviderConfig> {
    const cfg = await this.require(id)
    if (cfg.secretRef) await this.d.secrets.delete(cfg.secretRef)
    const next = { ...cfg, secretRef: undefined }
    await this.d.store.providers.put(next)
    return next
  }

  async test(id: string): Promise<TestConnectionResult> {
    const cfg = await this.require(id)
    const key = cfg.secretRef ? await this.d.secrets.get(cfg.secretRef) : undefined
    try {
      return await testProvider(cfg, key, this.d.executor)
    } catch (err) {
      return { outcome: 'failed', error: err instanceof Error ? err.message : String(err) }
    }
  }

  capability(cfg: ProviderConfig) {
    const found = this.d.models.lookup(cfg)
    return {
      declared: found.declared,
      capability: found.capability,
      pricing: found.profile?.pricing ?? [],
      quirks: found.profile?.quirks ?? [],
      provenance: found.profile?.provenance,
    }
  }
}
