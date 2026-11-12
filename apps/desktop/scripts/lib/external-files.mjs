// Files that a program other than the app itself must be able to read. ffmpeg is an external process: it opens the
// subtitle font as an ordinary file and cannot read inside app.asar, so in a packaged app the font (and the data
// folder around it, which the server locates relative to its own script) must sit unpacked on disk.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** `<resources>` of a packaged app, from the path of its executable. */
export function resourcesDirOf(executable, platform = process.platform) {
  const dir = dirname(executable)
  return platform === 'darwin' ? join(dir, '..', 'Resources') : join(dir, 'resources')
}

export const FONT_FILE = 'NotoSansSC-Regular-Subset.otf'

/** Paths (relative to the unpacked folder) that must exist as real files / folders. */
export function unpackedPaths(resourcesDir) {
  const unpacked = join(resourcesDir, 'app.asar.unpacked', 'dist')
  return {
    unpacked,
    font: join(unpacked, 'data', 'fonts', FONT_FILE),
    prompts: join(unpacked, 'data', 'prompts'),
    server: join(unpacked, 'server', 'server.mjs'),
  }
}

/**
 * @returns {{name: string, ok: boolean, detail?: string}[]}
 */
export function checkExternalFiles(executable, appLogText) {
  const p = unpackedPaths(resourcesDirOf(executable))
  const results = []
  const add = (name, ok, detail) => results.push({ name, ok, detail })

  const fontExists = existsSync(p.font) && statSync(p.font).isFile() && statSync(p.font).size > 0
  add('subtitle font is a real file outside app.asar', fontExists, p.font)
  if (fontExists) {
    // A plain Node process (no Electron, no asar support) stands in for ffmpeg: can it open the file?
    const probe = spawnSync(
      process.execPath,
      [
        '-e',
        `const b=require('fs').readFileSync(process.argv[1]);process.stdout.write(b.subarray(0,4).toString('latin1'))`,
        p.font,
      ],
      { encoding: 'utf8' },
    )
    add(
      'an external process can read the font (OpenType header)',
      probe.status === 0 && probe.stdout === 'OTTO',
      probe.stderr || probe.stdout,
    )
  }
  add(
    'prompts and models are unpacked next to the font',
    existsSync(p.prompts) && existsSync(join(p.unpacked, 'data', 'models')),
  )
  add('server script is unpacked (its ../data/fonts is then a real folder)', existsSync(p.server))
  if (appLogText !== undefined) {
    // the newest one: on macOS the log file is shared by every run of the app
    const line = appLogText.split('\n').findLast((l) => l.includes('server entry:')) ?? ''
    add(
      'the app started the server from the unpacked copy',
      line.includes('app.asar.unpacked'),
      line.slice(line.indexOf('server entry:')),
    )
  }
  return results
}
