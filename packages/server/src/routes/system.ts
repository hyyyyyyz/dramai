import {
  localizeProviderPreset,
  localizeStyleGroup,
  localizeStylePreset,
  pick,
  PROVIDER_PRESETS,
} from '@dramai/core'
import { SERVER_EVENT_TYPES } from '@dramai/api'
import type { ServerContext } from '../context.ts'
import { badRequest } from '../errors.ts'
import { localeOf } from '../locale.ts'
import type { RouteRegistry } from '../handle.ts'
import { OK } from './common.ts'

export function registerSystemRoutes(r: RouteRegistry, ctx: ServerContext): void {
  void SERVER_EVENT_TYPES

  r.handle('system.get', async ({ c }) => {
    const locale = await localeOf(ctx, c)
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
      demo: {
        active: ctx.config.demo !== undefined,
        ...(ctx.config.demo ? { notice: pick(ctx.config.demo.notice, locale) } : {}),
      },
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

  r.handle('styles.list', async ({ c }) => {
    const locale = await localeOf(ctx, c)
    return {
      groups: ctx.catalog.styles.groups.map((g) => ({
        id: g.id,
        label: localizeStyleGroup(g, locale),
        presets: g.presets.map((p) => ({
          id: p.id,
          ...localizeStylePreset(p, locale),
          imageKeywords: p.imageKeywords,
        })),
      })),
    }
  })

  r.handle('presets.list', async ({ c }) => {
    const locale = await localeOf(ctx, c)
    return {
      items: PROVIDER_PRESETS.map((p) => ({
        id: p.id,
        ...localizeProviderPreset(p, locale),
        kind: p.kind,
        protocol: p.protocol,
        baseUrl: p.baseUrl,
        suggestedModel: p.suggestedModel,
        verifiedAt: p.verifiedAt,
        knownLimitations: [...localizeProviderPreset(p, locale).knownLimitations],
      })),
    }
  })

  // --- 服务商 ---

  r.handle('providers.list', async ({ c }) => {
    const locale = await localeOf(ctx, c)
    return {
      items: await Promise.all(
        (await ctx.providers.list()).map((p) => ctx.providers.toDto(p, locale)),
      ),
    }
  })
  r.handle('providers.create', async ({ body, c }) => {
    const { apiKey, ...rest } = body
    const cfg = await ctx.providers.create(
      { ...rest, capabilityOverrides: rest.capabilityOverrides as never },
      apiKey,
    )
    ctx.bus.changed('provider', { ids: [cfg.id], op: 'created' })
    return ctx.providers.toDto(cfg, await localeOf(ctx, c))
  })
  r.handle('providers.fromPreset', async ({ body, c }) => {
    const cfg = await ctx.providers.createFromPreset(body.presetId, body)
    ctx.bus.changed('provider', { ids: [cfg.id], op: 'created' })
    return ctx.providers.toDto(cfg, await localeOf(ctx, c))
  })
  r.handle('providers.get', async ({ params, c }) =>
    ctx.providers.toDto(await ctx.providers.require(params.providerId), await localeOf(ctx, c)),
  )
  r.handle('providers.update', async ({ params, body, c }) => {
    const cfg = await ctx.providers.update(params.providerId, {
      ...body,
      capabilityOverrides: body.capabilityOverrides as never,
    })
    ctx.bus.changed('provider', { ids: [cfg.id], op: 'updated' })
    return ctx.providers.toDto(cfg, await localeOf(ctx, c))
  })
  r.handle('providers.delete', async ({ params }) => {
    await ctx.providers.delete(params.providerId)
    ctx.bus.changed('provider', { ids: [params.providerId], op: 'deleted' })
    ctx.bus.changed('settings')
    return OK
  })
  r.handle('providers.setKey', async ({ params, body, c }) => {
    const cfg = await ctx.providers.setKey(params.providerId, body.apiKey)
    ctx.bus.changed('provider', { ids: [cfg.id], op: 'updated' })
    return ctx.providers.toDto(cfg, await localeOf(ctx, c))
  })
  r.handle('providers.clearKey', async ({ params, c }) => {
    const cfg = await ctx.providers.clearKey(params.providerId)
    ctx.bus.changed('provider', { ids: [cfg.id], op: 'updated' })
    return ctx.providers.toDto(cfg, await localeOf(ctx, c))
  })
  r.handle('providers.test', async ({ params }) => ctx.providers.test(params.providerId))
  r.handle('providers.capability', async ({ params }) =>
    ctx.providers.capability(await ctx.providers.require(params.providerId)),
  )
  r.handle('providers.acceptUnverified', async ({ params, body, c }) => {
    const cfg = await ctx.providers.update(params.providerId, { acceptedUnverified: body.keys })
    ctx.bus.changed('provider', { ids: [cfg.id], op: 'updated' })
    return ctx.providers.toDto(cfg, await localeOf(ctx, c))
  })
}
