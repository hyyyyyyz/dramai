import { join } from 'node:path'

/**
 * Where the server process script lives.
 *
 * The server finds its data folder relative to its own file (`../data/`), and the subtitle font in that folder is read
 * by ffmpeg, an external process that cannot open files inside `app.asar`. So in the packaged app the server script and
 * the data folder are unpacked (`asarUnpack` in electron-builder.config.mjs) and the server is started from the unpacked
 * copy: its `../data/fonts` is then a real folder on disk.
 */
export function serverEntryPath(options: {
  packaged: boolean
  resourcesPath: string
  distDir: string
}): string {
  return options.packaged
    ? join(options.resourcesPath, 'app.asar.unpacked', 'dist', 'server', 'server.mjs')
    : join(options.distDir, 'server', 'server.mjs')
}
