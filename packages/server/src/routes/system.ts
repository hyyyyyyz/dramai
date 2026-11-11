import { PROVIDER_PRESETS } from '@dramai/core'
import { SERVER_EVENT_TYPES } from '@dramai/api'
import type { ServerContext } from '../context.ts'
import { badRequest } from '../errors.ts'
import type { RouteRegistry } from '../handle.ts'
import { OK } from './common.ts'

export function registerSystemRoutes(r: RouteRegistry, ctx: ServerContext): void {
  void SERVER_EVENT_TYPES

  r.handle('system.get', () => {
    const { bins, caps, error } = ctx.ffmpeg
    return {
      version: ctx.config.version,
      dataDir: ctx.config.dataDir,
      platform: process.platform,
      node: process.version,
      desktop: ctx.config.desktop,
      startedAt: ctx.config.startedAt,
      epoch: ctx.bus.epoch,
      ffmpeg: bins
        ? {
            found: true,
            path: bins.ffmpeg,
            source: bins.source,
            version: caps?.version,
            videoEncoder: caps?.videoEncoder,
            features: caps?.features,
            missing: caps?.missing ?? [],
            ok: caps?.ok ?? false,
            error,
          }
        : { found: false, missing: [], ok: false, error },
      auth: { tokenRequired: ctx.config.tokenRequired },
      demo: { active: ctx.config.demo !== undefined, notice: ctx.config.demo?.notice },
    }
  })

  r.handle('settings.get', () => ctx.settings.get())
  r.handle('settings.update', async ({ body }) => {
    const all = await ctx.providers.list()
    for (const [kind, id] of Object.entries(body.activeProviders)) {
      if (!id) continue
      const p = all.find((x) => x.id === id)
      if (!p) throw badRequest(`服务商配置不存在：${id}`)
      if (p.kind !== kind) throw badRequest(`${p.label} 是 ${p.kind} 服务，不能用作 ${kind}`)
    }
    const saved = await ctx.settings.put(body)
    ctx.bus.changed('settings')
    return saved
  })

  r.handle('styles.list', () => ({
    groups: ctx.catalog.styles.groups.map((g) => ({
      id: g.id,
      label: g.label,
      presets: g.presets.map((p) => ({
        id: p.id,
        label: p.label,
        description: p.description,
        imageKeywords: p.imageKeywords,
      })),
    })),
  }))

  r.handle('presets.list', () => ({
    items: PROVIDER_PRESETS.map((p) => ({
      id: p.id,
      label: p.label,
      kind: p.kind,
      protocol: p.protocol,
      baseUrl: p.baseUrl,
      suggestedModel: p.suggestedModel,
      notes: p.notes,
      verifiedAt: p.verifiedAt,
      knownLimitations: [...p.knownLimitations],
    })),
  }))

  // --- 服务商 ---

  r.handle('providers.list', async () => ({
    items: await Promise.all((await ctx.providers.list()).map((p) => ctx.providers.toDto(p))),
  }))
  r.handle('providers.create', async ({ body }) => {
    const { apiKey, ...rest } = body
    const cfg = await ctx.providers.create(
      { ...rest, capabilityOverrides: rest.capabilityOverrides as never },
      apiKey,
    )
    ctx.bus.changed('provider', { ids: [cfg.id], op: 'created' })
    return ctx.providers.toDto(cfg)
  })
  r.handle('providers.fromPreset', async ({ body }) => {
    const cfg = await ctx.providers.createFromPreset(body.presetId, body)
    ctx.bus.changed('provider', { ids: [cfg.id], op: 'created' })
    return ctx.providers.toDto(cfg)
  })
  r.handle('providers.get', async ({ params }) =>
    ctx.providers.toDto(await ctx.providers.require(params.providerId)),
  )
  r.handle('providers.update', async ({ params, body }) => {
    const cfg = await ctx.providers.update(params.providerId, {
      ...body,
      capabilityOverrides: body.capabilityOverrides as never,
    })
    ctx.bus.changed('provider', { ids: [cfg.id], op: 'updated' })
    return ctx.providers.toDto(cfg)
  })
  r.handle('providers.delete', async ({ params }) => {
    await ctx.providers.delete(params.providerId)
    ctx.bus.changed('provider', { ids: [params.providerId], op: 'deleted' })
    ctx.bus.changed('settings')
    return OK
  })
  r.handle('providers.setKey', async ({ params, body }) => {
    const cfg = await ctx.providers.setKey(params.providerId, body.apiKey)
    ctx.bus.changed('provider', { ids: [cfg.id], op: 'updated' })
    return ctx.providers.toDto(cfg)
  })
  r.handle('providers.clearKey', async ({ params }) => {
    const cfg = await ctx.providers.clearKey(params.providerId)
    ctx.bus.changed('provider', { ids: [cfg.id], op: 'updated' })
    return ctx.providers.toDto(cfg)
  })
  r.handle('providers.test', async ({ params }) => ctx.providers.test(params.providerId))
  r.handle('providers.capability', async ({ params }) =>
    ctx.providers.capability(await ctx.providers.require(params.providerId)),
  )
  r.handle('providers.acceptUnverified', async ({ params, body }) => {
    const cfg = await ctx.providers.update(params.providerId, { acceptedUnverified: body.keys })
    ctx.bus.changed('provider', { ids: [cfg.id], op: 'updated' })
    return ctx.providers.toDto(cfg)
  })
}
