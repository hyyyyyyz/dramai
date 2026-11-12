import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigStore } from '../src/main/config.ts'
import { resolveBundledFfmpeg, withToolDirs } from '../src/main/ffmpeg.ts'
import { buildMenuTemplate } from '../src/main/menu.ts'
import { cleanText, parseFolderRequest, resolveProjectPath } from '../src/main/native.ts'
import { resolveDataDir } from '../src/main/paths.ts'
import { detectLang, isLangPreference, resolveLang, strings } from '../src/main/strings.ts'
import { classifyStartError } from '../src/shared/protocol.ts'

let dir: string
beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), 'dramai-misc-'))))
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('data directory', () => {
  const base = { userData: join('/home/u/.config/Dramai') }
  it('env wins over the saved choice, which wins over the default', () => {
    expect(resolveDataDir({ ...base, env: { DRAMAI_DATA_DIR: '/x' }, configured: '/y' })).toEqual({
      dir: '/x',
      source: 'env',
    })
    expect(resolveDataDir({ ...base, env: {}, configured: '/y' })).toEqual({
      dir: '/y',
      source: 'config',
    })
    expect(resolveDataDir({ ...base, env: {} })).toEqual({
      dir: join(base.userData, 'data'),
      source: 'default',
    })
  })
  it('ignores a blank env var', () => {
    expect(resolveDataDir({ ...base, env: { DRAMAI_DATA_DIR: '  ' } }).source).toBe('default')
  })
})

describe('desktop config', () => {
  it('round-trips and falls back to defaults on a missing or damaged file', async () => {
    const file = join(dir, 'sub', 'desktop.json')
    const a = new ConfigStore(file)
    expect(a.get()).toEqual({ checkForUpdates: true })
    a.update({ dataDir: '/data', port: 4000, skippedVersion: '0.5.0' })
    const b = new ConfigStore(file)
    expect(b.get()).toMatchObject({
      dataDir: '/data',
      port: 4000,
      skippedVersion: '0.5.0',
      checkForUpdates: true,
    })
    b.update({ port: undefined })
    expect(JSON.parse(await readFile(file, 'utf8'))).not.toHaveProperty('port')
    await writeFile(file, '{ nope')
    expect(new ConfigStore(file).get()).toEqual({ checkForUpdates: true })
  })
  it('drops fields of the wrong type', async () => {
    const file = join(dir, 'c.json')
    await writeFile(
      file,
      JSON.stringify({
        port: 'x',
        dataDir: 5,
        checkForUpdates: 'yes',
        window: { width: 1, height: 'a', maximized: true },
      }),
    )
    expect(new ConfigStore(file).get()).toEqual({ checkForUpdates: true })
  })
})

describe('ffmpeg resolution', () => {
  it('finds a bundled ffmpeg (and ffprobe) in the resources folder, or nothing', () => {
    const exists = (set: string[]) => (p: string) => set.includes(p)
    const r = join('/res', 'ffmpeg')
    expect(
      resolveBundledFfmpeg('/res', 'darwin', exists([join(r, 'ffmpeg'), join(r, 'ffprobe')])),
    ).toEqual({
      ffmpegPath: join(r, 'ffmpeg'),
      ffprobePath: join(r, 'ffprobe'),
    })
    expect(resolveBundledFfmpeg('/res', 'win32', exists([join(r, 'ffmpeg.exe')]))).toEqual({
      ffmpegPath: join(r, 'ffmpeg.exe'),
    })
    expect(resolveBundledFfmpeg('/res', 'darwin', exists([]))).toBeUndefined()
  })
  it('adds the usual install folders to PATH once (Finder-launched apps lack the shell PATH)', () => {
    const env = withToolDirs({ PATH: ['/usr/bin', '/opt/homebrew/bin'].join(delimiter) }, 'darwin')
    const parts = env.PATH!.split(delimiter)
    expect(parts.filter((p) => p === '/opt/homebrew/bin')).toHaveLength(1)
    expect(parts).toContain('/usr/local/bin')
    const win = withToolDirs(
      { Path: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' },
      'win32',
    )
    expect(String(win.Path)).toContain('WinGet')
  })
})

describe('native bridge argument checks', () => {
  const data = join(sep, 'data')
  it('resolves files inside the project folder only', () => {
    expect(resolveProjectPath(data, 'proj_1', 'images/a.png')).toBe(
      join(data, 'projects', 'proj_1', 'images', 'a.png'),
    )
    expect(resolveProjectPath(data, 'proj_1', undefined)).toBe(join(data, 'projects', 'proj_1'))
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'a\\b', 'a//b', './a', 'a\0b'])
      expect(resolveProjectPath(data, 'proj_1', bad)).toBeUndefined()
    for (const id of ['../x', 'a/b', '', 5, undefined, 'a b'])
      expect(resolveProjectPath(data, id, 'a')).toBeUndefined()
  })
  it('cleans notification text', () => {
    expect(cleanText('  hi\u0000 there  ', 50)).toBe('hi there')
    expect(cleanText('x'.repeat(500), 10)).toHaveLength(10)
    expect(cleanText('   ', 10)).toBeUndefined()
    expect(cleanText(42, 10)).toBeUndefined()
  })
  it('only takes strings for the folder dialog', () => {
    expect(parseFolderRequest({ title: 5, defaultPath: {} })).toEqual({
      title: undefined,
      defaultPath: undefined,
    })
    expect(parseFolderRequest('x')).toEqual({})
  })
})

describe('start failure classification', () => {
  it('maps by error name / code, not by message', () => {
    const named = (name: string) => Object.assign(new Error('whatever'), { name })
    expect(classifyStartError(named('DataDirLockedError'))).toBe('DATA_DIR_LOCKED')
    expect(classifyStartError(named('SchemaTooNewError'))).toBe('SCHEMA_TOO_NEW')
    expect(classifyStartError(named('TokenRequiredError'))).toBe('TOKEN_REQUIRED')
    expect(classifyStartError(Object.assign(new Error('x'), { code: 'EADDRINUSE' }))).toBe(
      'PORT_IN_USE',
    )
    expect(classifyStartError(new Error('boom'))).toBe('UNKNOWN')
    expect(classifyStartError('string')).toBe('UNKNOWN')
  })
})

describe('application menu', () => {
  const noop = () => {}
  const actions = {
    about: noop,
    checkForUpdates: noop,
    toggleAutoCheck: noop,
    changeDataDir: noop,
    showDataDir: noop,
    openLogs: noop,
    openExternal: noop,
    setLanguage: noop,
  }
  const input = {
    strings: strings.en,
    devTools: false,
    autoCheck: true,
    language: 'auto' as const,
    homepage: 'https://h',
    issuesUrl: 'https://i',
    actions,
  }
  const labels = (t: ReturnType<typeof buildMenuTemplate>) => t.map((m) => m.label)

  it('has About under the app menu on macOS and under Help elsewhere', () => {
    const mac = buildMenuTemplate({ ...input, platform: 'darwin' })
    expect(labels(mac)[0]).toBe('Dramai')
    expect(JSON.stringify(mac.map((m) => m.label))).toContain('Dramai')
    const win = buildMenuTemplate({ ...input, platform: 'win32' })
    const help = win.find((m) => m.role === 'help')!.submenu as Array<{ label?: string }>
    expect(help.map((i) => i.label)).toContain('About Dramai')
    expect(labels(win)).not.toContain('Dramai')
  })
  it('offers developer tools only when asked', () => {
    const flat = (t: ReturnType<typeof buildMenuTemplate>) => JSON.stringify(t)
    expect(flat(buildMenuTemplate({ ...input, platform: 'linux', devTools: false }))).not.toContain(
      'toggleDevTools',
    )
    expect(flat(buildMenuTemplate({ ...input, platform: 'linux', devTools: true }))).toContain(
      'toggleDevTools',
    )
  })
  it('exposes the data-folder and update actions', () => {
    const all = JSON.stringify(buildMenuTemplate({ ...input, platform: 'linux' }))
    for (const label of [
      'Change Data Folder…',
      'Check for Updates…',
      'Check for Updates on Launch',
      'Open Log Folder',
    ])
      expect(all).toContain(label)
  })
})

describe('interface language', () => {
  it('maps system locales onto English / Simplified / Traditional Chinese', () => {
    expect(detectLang('en-US')).toBe('en')
    expect(detectLang('fr')).toBe('en')
    expect(detectLang('zh-CN')).toBe('zh-CN')
    expect(detectLang('zh')).toBe('zh-CN')
    expect(detectLang('zh-Hans-CN')).toBe('zh-CN')
    for (const l of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-TW'])
      expect(detectLang(l)).toBe('zh-TW')
  })
  it('a saved choice beats the system locale; auto follows it', () => {
    expect(resolveLang('zh-TW', 'en-US')).toBe('zh-TW')
    expect(resolveLang('auto', 'zh-CN')).toBe('zh-CN')
    expect(resolveLang(undefined, 'ja')).toBe('en')
  })
  it('validates the preference coming from the page', () => {
    for (const ok of ['auto', 'en', 'zh-CN', 'zh-TW']) expect(isLangPreference(ok)).toBe(true)
    for (const bad of ['zh', 'fr', '', 5, undefined, null, {}])
      expect(isLangPreference(bad)).toBe(false)
  })
  it('every language has the same set of strings', () => {
    const shape = (v: unknown): unknown =>
      typeof v === 'object' && v !== null
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]))
        : typeof v
    expect(shape(strings['zh-TW'])).toEqual(shape(strings.en))
    expect(shape(strings['zh-CN'])).toEqual(shape(strings.en))
  })
  it('the config keeps a valid language and drops an invalid one', async () => {
    const file = join(dir, 'lang.json')
    await writeFile(file, JSON.stringify({ language: 'zh-TW' }))
    expect(new ConfigStore(file).get().language).toBe('zh-TW')
    await writeFile(file, JSON.stringify({ language: 'klingon' }))
    expect(new ConfigStore(file).get().language).toBeUndefined()
  })
  it('the View menu offers a language radio group with the current choice checked', () => {
    const noop2 = () => {}
    const template = buildMenuTemplate({
      platform: 'linux',
      strings: strings['zh-TW'],
      devTools: false,
      autoCheck: true,
      language: 'zh-TW',
      homepage: 'h',
      issuesUrl: 'i',
      actions: {
        setLanguage: noop2,
        about: noop2,
        checkForUpdates: noop2,
        toggleAutoCheck: noop2,
        changeDataDir: noop2,
        showDataDir: noop2,
        openLogs: noop2,
        openExternal: noop2,
      },
    })
    const view = template.find((m) => m.label === '檢視')!.submenu as Array<{
      label?: string
      submenu?: Array<{ label: string; checked: boolean }>
    }>
    const group = view.find((i) => i.label === '語言')!.submenu!
    expect(group.map((i) => i.label)).toEqual(['跟隨系統', 'English', '简体中文', '繁體中文'])
    expect(group.filter((i) => i.checked).map((i) => i.label)).toEqual(['繁體中文'])
  })
})
