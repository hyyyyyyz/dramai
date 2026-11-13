// A tiny static server that serves dist/ under /dramai/ the way GitHub Pages does:
// directories resolve to index.html, and an address that does not exist gets 404.html with status 404.
// Used by the review script (and handy for a manual look): node scripts/serve-dist.mjs [port]
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const DIST = path.join(here, '../dist')
const BASE = '/dramai/'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
}

async function resolveFile(pathname) {
  if (!pathname.startsWith(BASE)) return null
  const rel = decodeURIComponent(pathname.slice(BASE.length))
  const target = path.normalize(path.join(DIST, rel))
  if (!target.startsWith(DIST)) return null
  try {
    const info = await stat(target)
    if (info.isDirectory()) return path.join(target, 'index.html')
    return target
  } catch {
    return null
  }
}

/** Starts the server; resolves to { url, close }. port 0 picks a free port. */
export function serveDist(port = 0) {
  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    let file = await resolveFile(pathname)
    let status = 200
    if (file) {
      try {
        await stat(file)
      } catch {
        file = null
      }
    }
    if (!file) {
      file = path.join(DIST, '404.html')
      status = 404
    }
    const body = await readFile(file)
    res.writeHead(status, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    })
    res.end(body)
  })
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address()
      const actual = typeof addr === 'object' && addr ? addr.port : port
      resolve({
        url: `http://127.0.0.1:${actual}${BASE}`,
        origin: `http://127.0.0.1:${actual}`,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await serveDist(Number(process.argv[2] ?? 4321))
  console.log(`serving dist at ${url}`)
}
