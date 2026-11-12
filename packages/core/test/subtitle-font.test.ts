import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bundledFontsDir, SUBTITLE_FONT_FAMILY } from '../src/data-dir.ts'
import { runProcess } from '../src/media/ffmpeg.ts'
import { buildSubtitlesFilter, filterPath } from '../src/media/render.ts'
import { subtitleBurnOptions } from '../src/pipeline/compose.ts'
import { locateMedia } from './fakes.ts'
import type { MediaEnv } from './fakes.ts'

/**
 * Burned subtitles must not depend on which fonts the machine has: a bare Linux runner or container has no CJK font at
 * all, and ffmpeg's libass on macOS cannot open the system CJK font either (it logs "Error opening font ...PingFang"
 * and draws nothing). So the product ships a font and hands it to libass.
 */
describe('the bundled subtitle font', () => {
  it('ships next to the data, with its license, and is the OpenType font we think it is', async () => {
    const dir = bundledFontsDir()
    expect(dir.replaceAll('\\', '/').endsWith('/data/fonts')).toBe(true)
    // libass tries to load EVERY file in the fonts directory, so it holds font files only
    const entries = await readdir(dir, { withFileTypes: true })
    expect(entries.filter((e) => e.isFile()).map((e) => e.name)).toEqual([
      'NotoSansSC-Regular-Subset.otf',
    ])
    const font = await readFile(join(dir, 'NotoSansSC-Regular-Subset.otf'))
    expect(font.subarray(0, 4).toString('latin1')).toBe('OTTO') // OpenType / CFF
    expect(font.length).toBeGreaterThan(1_500_000)
    expect(font.length).toBeLessThan(6_000_000)
    // the license travels with the font (SIL OFL 1.1)
    const license = await readFile(join(dir, 'about', 'OFL.txt'), 'utf8')
    expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1')
    expect(await stat(join(dir, 'about', 'README.md'))).toBeDefined()
    // the family name libass is asked for is the one inside the file (name table, UTF-16BE)
    expect(font.includes(Buffer.from(SUBTITLE_FONT_FAMILY, 'utf16le').swap16())).toBe(true)
    // pin the exact bytes: replacing the font is a deliberate act (update the hash and data/fonts/about/README.md)
    expect(createHash('sha256').update(font).digest('hex')).toBe(
      'd613ab65c5ea20651b2fcb8c5e811bef86ce09fbd0ee694f89aaeab2a499c5aa',
    )
  })

  it("is what burning uses by default; a caller's own fonts folder replaces it (and then the family is theirs to name)", () => {
    expect(subtitleBurnOptions({})).toEqual({
      fontsDir: bundledFontsDir(),
      style: { fontName: SUBTITLE_FONT_FAMILY },
    })
    expect(subtitleBurnOptions({ subtitleStyle: { fontSize: 20 } }).style).toEqual({
      fontName: SUBTITLE_FONT_FAMILY,
      fontSize: 20,
    })
    expect(subtitleBurnOptions({ fontsDir: '/my/fonts' })).toEqual({
      fontsDir: '/my/fonts',
      style: {},
    })
    expect(
      subtitleBurnOptions({ fontsDir: '/my/fonts', subtitleStyle: { fontName: 'My Font' } }).style,
    ).toEqual({ fontName: 'My Font' })
  })
})

describe('subtitle filter arguments, written the way Windows paths need them', () => {
  it('uses forward slashes so only the drive-letter colon needs escaping', () => {
    expect(filterPath('C:\\Users\\me\\AppData\\Local\\Temp\\dramai-x\\subs.srt')).toBe(
      'C\\:/Users/me/AppData/Local/Temp/dramai-x/subs.srt',
    )
    expect(filterPath('D:\\a\\dramai\\dramai\\packages\\core\\data\\fonts')).toBe(
      'D\\:/a/dramai/dramai/packages/core/data/fonts',
    )
    expect(filterPath('/tmp/a b/c,d/e[1].srt')).toBe('/tmp/a b/c\\,d/e\\[1\\].srt')
    expect(filterPath("/tmp/it's/x.srt")).toBe("/tmp/it\\'s/x.srt")
  })

  it('builds the same filter for a Windows fonts folder and a POSIX one (apart from the drive)', () => {
    const win = buildSubtitlesFilter('C:\\t\\subs.srt', 'C:\\app\\data\\fonts', {
      fontName: 'Noto Sans SC',
    })
    expect(win).toBe(
      "subtitles=filename='C\\:/t/subs.srt':fontsdir='C\\:/app/data/fonts':force_style='FontName=Noto Sans SC\\,FontSize=14\\,Alignment=2\\,MarginV=18\\,Outline=1.5\\,PrimaryColour=&H00FFFFFF\\,OutlineColour=&H00000000'",
    )
    expect(win).not.toMatch(/\\[A-Za-z]/) // no stray backslash path separators left
  })
})

describe('burning with the bundled font really draws Chinese (needs an ffmpeg with libass)', () => {
  let media: MediaEnv | undefined
  let dir = ''
  let previousFontconfig: string | undefined
  beforeAll(async () => {
    media = await locateMedia()
    dir = await mkdtemp(join(tmpdir(), 'dramai-subfont-'))
    // Hide every system font from fontconfig (Linux). libass on macOS uses CoreText and ignores this.
    previousFontconfig = process.env.FONTCONFIG_FILE
    process.env.FONTCONFIG_FILE = join(dir, 'fonts.conf')
    await writeFile(
      join(dir, 'fonts.conf'),
      `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><cachedir>${dir}/cache</cachedir></fontconfig>`,
    )
    await writeFile(
      join(dir, 't.srt'),
      '1\n00:00:00,000 --> 00:00:02,000\n这是一条旁白字幕：视频、影片與設定圖\n',
    )
  })
  afterAll(async () => {
    if (previousFontconfig === undefined) delete process.env.FONTCONFIG_FILE
    else process.env.FONTCONFIG_FILE = previousFontconfig
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
  })

  const real = (name: string, fn: () => Promise<void>) =>
    it(
      name,
      async (ctx) => {
        if (!media?.caps.features.subtitleBurnIn) return ctx.skip()
        await fn()
      },
      60_000,
    )

  real(
    'and without it the very same subtitles look different — the bundled font, not whatever the system offers, is what is drawn',
    async () => {
      // Both renderings of the same text on the same flat picture, in one ffmpeg run; their pixel difference in the band.
      const withFont = buildSubtitlesFilter(join(dir, 't.srt'), bundledFontsDir(), {
        fontName: SUBTITLE_FONT_FAMILY,
      })
      const without = buildSubtitlesFilter(join(dir, 't.srt'), undefined, {})
      const r = await runProcess(media!.bins.ffmpeg, [
        '-hide_banner',
        '-f',
        'lavfi',
        '-i',
        'color=c=gray:s=270x480:d=1',
        '-filter_complex',
        `[0:v]split[a][b];[a]${withFont}[a2];[b]${without}[b2];[a2][b2]blend=all_mode=difference,crop=270:140:0:340,signalstats,metadata=print:key=lavfi.signalstats.YAVG`,
        '-frames:v',
        '1',
        '-f',
        'null',
        '-',
      ])
      const yavg = Number(/YAVG=([\d.]+)/.exec(r.stderr + r.stdout)![1])
      expect(yavg, 'average pixel difference between the two renderings').toBeGreaterThan(0.5)
    },
  )
})
