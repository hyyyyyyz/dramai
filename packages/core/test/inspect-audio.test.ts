import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { inspectAudio } from '../src/media/ffmpeg.ts'

/**
 * `inspectAudio` with stand-in tools (small shell scripts), so each verdict is produced on purpose:
 * tier 1 `not_audio` (cannot open / no audio stream) - rejected; tier 2 `flawed` (opens, has audio, but no duration or
 * decode errors) - kept with a warning; `unknown` (the tool itself is the problem) - nothing is concluded.
 */

const posix = process.platform !== 'win32'
let dir: string
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dramai-inspect-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function script(name: string, body: string): Promise<string> {
  const file = join(dir, name)
  await writeFile(file, `#!/bin/sh\n${body}\n`)
  await chmod(file, 0o755)
  return file
}
const audioJson = (duration?: string) =>
  JSON.stringify({
    streams: [{ codec_type: 'audio', codec_name: 'mp3', ...(duration ? { duration } : {}) }],
    format: duration ? { duration } : {},
  })

const run = async (probe: string, decode: string) =>
  inspectAudio(
    {
      ffmpeg: await script('ffmpeg-' + Math.random(), decode),
      ffprobe: await script('ffprobe-' + Math.random(), probe),
      source: 'option',
    },
    '/dev/null',
  )

describe.skipIf(!posix)(
  'inspectAudio: the two tiers and "the tool is the problem"',
  { timeout: 30_000 },
  () => {
    it('ok: opens, has audio, has a duration, decodes cleanly', async () => {
      const r = await run(`echo '${audioJson('2.0')}'`, 'exit 0')
      expect(r).toMatchObject({ verdict: 'ok', info: { hasAudio: true, durationSec: 2 } })
    })

    it('tier 1: the file cannot be opened - not audio', async () => {
      for (const msg of [
        'x.mp3: Invalid data found when processing input',
        'x: End of file',
        'moov atom not found',
        "[wav @ 0x1] no 'data' tag found",
      ]) {
        const r = await run(`echo "${msg}" >&2; exit 1`, 'exit 0')
        expect(r.verdict, msg).toBe('not_audio')
      }
    })

    it('tier 1: it opens but there is no audio stream - not audio', async () => {
      const r = await run(
        `echo '{"streams":[{"codec_type":"video","width":2,"height":2}],"format":{"duration":"1.0"}}'`,
        'exit 0',
      )
      expect(r).toMatchObject({ verdict: 'not_audio', reason: '文件里没有音频流' })
    })

    it('tier 2: opens and has audio but no duration - flawed, kept (the duration is simply unknown)', async () => {
      const r = await run(`echo '${audioJson()}'`, 'exit 0')
      expect(r).toMatchObject({ verdict: 'flawed', reason: '读不出音频的时长' })
      if (r.verdict === 'flawed') expect(r.info.durationSec).toBeUndefined()
      const zero = await run(`echo '${audioJson('0.000000')}'`, 'exit 0')
      expect(zero.verdict).toBe('flawed')
    })

    it('tier 2: decode errors (exit code 0) - flawed, and the duration that was read is kept', async () => {
      const r = await run(
        `echo '${audioJson('1.5')}'`,
        `echo '[flac @ 0x1] Decoding error: Invalid data found when processing input' >&2; exit 0`,
      )
      expect(r).toMatchObject({ verdict: 'flawed', info: { durationSec: 1.5 } })
    })

    it('unknown: the tool fails for its own reasons, cannot start, or prints something unreadable - nothing is concluded', async () => {
      expect((await run('echo "permission problem" >&2; exit 126', 'exit 0')).verdict).toBe(
        'unknown',
      )
      expect((await run('echo "this is not json"', 'exit 0')).verdict).toBe('unknown')
      const gone = await inspectAudio(
        { ffmpeg: '/nonexistent/ffmpeg', ffprobe: '/nonexistent/ffprobe', source: 'option' },
        '/dev/null',
      )
      expect(gone.verdict).toBe('unknown')
    })

    it('messages that can come from OUR OWN handling or from tool misuse are never tier 1', async () => {
      for (const msg of [
        'x: No such file or directory',
        'x: Permission denied',
        'Error opening input: Permission denied',
        'Error opening input: Invalid data found when processing input; x: No such file or directory',
        'Unrecognized option; Invalid argument',
        'Unsupported codec with id 86076',
        'x: Is a directory',
      ]) {
        const r = await run(`echo "${msg}" >&2; exit 1`, 'exit 0')
        expect(r.verdict, msg).toBe('unknown')
      }
    })

    it('a decode check that cannot start does not change the answer', async () => {
      const ffprobe = await script('ffprobe-ok', `echo '${audioJson('2.0')}'`)
      const r = await inspectAudio(
        { ffmpeg: '/nonexistent/ffmpeg', ffprobe, source: 'option' },
        '/dev/null',
      )
      expect(r.verdict).toBe('ok')
    })
  },
)
