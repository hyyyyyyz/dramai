// Works out which self-hosted font files the first screen needs, so the layout can preload them.
// Noto Sans SC is cut into ~100 slices by unicode-range; a preload for every slice would defeat the
// point, so only the slices that contain a character of the given text are returned.
import fontsCss from '../styles/fonts.css?raw'

const urls = import.meta.glob(
  [
    '../../node_modules/@fontsource/noto-sans-sc/files/*-700-normal.woff2',
    '../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  ],
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>

interface Slice {
  file: string
  ranges: [number, number][]
}

const slices: Slice[] = [...fontsCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].flatMap((m) => {
  const body = m[1] ?? ''
  const file = /files\/([^)]+\.woff2)\)/.exec(body)?.[1]
  const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1]
  if (!file || !range) return []
  const ranges = range.split(',').map((part): [number, number] => {
    const [from, to] = part.trim().replace(/^U\+/i, '').split('-')
    const lo = parseInt(from ?? '0', 16)
    return [lo, to ? parseInt(to, 16) : lo]
  })
  return [{ file, ranges }]
})

function urlFor(file: string): string | undefined {
  const key = Object.keys(urls).find((k) => k.endsWith(`/${file}`))
  return key ? urls[key] : undefined
}

/** URLs of the Noto Sans SC 700 slices that cover `text`, plus the Latin Inter slice. */
export function fontPreloads(text: string): string[] {
  const wanted = new Set<string>(['inter-latin-wght-normal.woff2'])
  for (const ch of new Set(text)) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 0x2e80) continue // Latin and punctuation come from Inter
    const hit = slices.find(
      (s) =>
        s.file.includes('noto-sans-sc') && s.ranges.some(([lo, hi]) => code >= lo && code <= hi),
    )
    if (hit) wanted.add(hit.file)
  }
  return [...wanted].flatMap((file) => urlFor(file) ?? [])
}
