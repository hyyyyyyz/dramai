import { Readable } from 'node:stream'
import { buildEpisodeSubtitles, exportMaterialPackage, ExportBlockedError } from '@dramai/core'
import type { Hono } from 'hono'
import type { ServerContext } from '../context.ts'
import { badRequest, HttpError, notFound } from '../errors.ts'
import { isInlineMedia, mimeOf } from '../http/mime.ts'
import { parseRange } from '../http/range.ts'
import { UnsafePathError } from '../storage/files.ts'

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  // 文件是用户数据，不是页面：任何情况下都不执行脚本。
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Cross-Origin-Resource-Policy': 'same-origin',
} as const

const attachmentName = (name: string): string =>
  `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name)}`

/** 项目文件下载（Range / ETag）与导出（字幕、素材包、成片）。 */
export function registerFileRoutes(app: Hono, ctx: ServerContext): void {
  app.on(['GET', 'HEAD'], '/api/projects/:projectId/files/*', async (c) => {
    const projectId = c.req.param('projectId')
    const prefix = `/api/projects/${projectId}/files/`
    const rawPath = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : ''
    let path: string
    try {
      path = rawPath.split('/').map(decodeURIComponent).join('/')
    } catch {
      throw badRequest('路径编码不合法')
    }
    return serveProjectFile(ctx, c.req.raw, projectId, path, {})
  })

  app.get('/api/episodes/:episodeId/export/srt', async (c) => {
    const ep = await episodeOr404(ctx, c.req.param('episodeId'))
    const subs = await buildEpisodeSubtitles(ctx.deps, ep.id)
    return textResponse(
      subs.srt,
      'application/x-subrip; charset=utf-8',
      `${safeName(ep.title)}.srt`,
    )
  })
  app.get('/api/episodes/:episodeId/export/vtt', async (c) => {
    const ep = await episodeOr404(ctx, c.req.param('episodeId'))
    const subs = await buildEpisodeSubtitles(ctx.deps, ep.id)
    return textResponse(subs.vtt, 'text/vtt; charset=utf-8', `${safeName(ep.title)}.vtt`)
  })
  app.get('/api/episodes/:episodeId/export/package', async (c) => {
    const ep = await episodeOr404(ctx, c.req.param('episodeId'))
    try {
      const zip = await exportMaterialPackage(ctx.deps, ep.id, {
        includeImages: c.req.query('images') !== '0',
        includeCut: c.req.query('cut') === '1',
        markExported: true,
      })
      ctx.bus.changed('episode', { projectId: ep.projectId, ids: [ep.id], op: 'updated' })
      return new Response(Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength) as never, {
        headers: {
          ...SECURITY_HEADERS,
          'Content-Type': 'application/zip',
          'Content-Length': String(zip.byteLength),
          'Content-Disposition': attachmentName(`${safeName(ep.title)}.zip`),
          'Cache-Control': 'no-store',
        },
      })
    } catch (err) {
      if (err instanceof ExportBlockedError) {
        throw new HttpError(409, 'EXPORT_BLOCKED', err.message, { issues: err.issues })
      }
      throw err
    }
  })
  app.on(['GET', 'HEAD'], '/api/episodes/:episodeId/export/cut', async (c) => {
    const ep = await episodeOr404(ctx, c.req.param('episodeId'))
    const record = await ctx.store.artifacts.get(ep.projectId, `cut:${ep.id}`)
    if (!record) throw new HttpError(404, 'NO_CUT', '这一集还没有合成成片')
    return serveProjectFile(ctx, c.req.raw, ep.projectId, record.file.path, {
      downloadName: `${safeName(ep.title)}.mp4`,
    })
  })
}

async function episodeOr404(ctx: ServerContext, id: string) {
  const ep = await ctx.store.episodes.get(id)
  if (!ep) throw notFound('分集', id)
  return ep
}

const safeName = (s: string): string => s.replace(/[\\/:*?"<>|\0]/g, '_').trim() || 'export'

function textResponse(body: string, type: string, filename: string): Response {
  return new Response(body, {
    headers: {
      ...SECURITY_HEADERS,
      'Content-Type': type,
      'Content-Disposition': attachmentName(filename),
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * 发一个项目文件：支持 HEAD、Range（206 / 416）、ETag（304）。
 * 图片 / 视频 / 音频内联，其余一律 attachment；永远 nosniff + 无脚本 CSP。
 */
export async function serveProjectFile(
  ctx: ServerContext,
  req: Request,
  projectId: string,
  path: string,
  options: { downloadName?: string },
): Promise<Response> {
  let info: { size: number; mtimeMs: number } | undefined
  try {
    info = await ctx.files.stat(projectId, path)
  } catch (err) {
    if (err instanceof UnsafePathError) throw new HttpError(400, 'UNSAFE_PATH', '路径不合法')
    throw err
  }
  if (!info) throw notFound('文件', path)

  const mime = mimeOf(path)
  const inline = isInlineMedia(mime) && !options.downloadName
  const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`
  const headers: Record<string, string> = {
    ...SECURITY_HEADERS,
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Cache-Control': 'private, no-cache',
    'Content-Disposition': inline
      ? 'inline'
      : attachmentName(options.downloadName ?? path.split('/').pop() ?? 'file'),
  }

  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': headers['Cache-Control']! },
    })
  }

  const range = parseRange(req.headers.get('range') ?? undefined, info.size)
  if (range.kind === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${info.size}` },
    })
  }
  const head = req.method === 'HEAD'
  if (range.kind === 'ok') {
    const length = range.end - range.start + 1
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`
    headers['Content-Length'] = String(length)
    if (head) return new Response(null, { status: 206, headers })
    const stream = ctx.files.createReadStream(projectId, path, {
      start: range.start,
      end: range.end,
    })
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: 206, headers })
  }
  headers['Content-Length'] = String(info.size)
  if (head) return new Response(null, { status: 200, headers })
  const stream = ctx.files.createReadStream(projectId, path)
  return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers })
}
