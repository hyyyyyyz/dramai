import type { CallOutput } from '@dramai/api'

export type Preset = CallOutput<'presets.list'>['items'][number]
export type Region = NonNullable<Preset['region']>

export interface VendorGroup {
  vendor: Preset['vendor']
  presets: Preset[]
}

const REGION_ORDER: Record<Region, number> = { cn: 0, global: 1, local: 2 }
const tested = (p: Preset) => (p.verification.status === 'tested' ? 0 : 1)

/** Host part of a preset's address, for matching a search like "deepseek.com". */
function host(url: string): string {
  try {
    return new URL(url.replace(/\{[^}]*\}/g, 'x')).host
  } catch {
    return url
  }
}

/** Does the preset match what the user typed? Name, vendor and address host, case-insensitive; empty matches all. */
export function matchesQuery(p: Preset, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return [p.label, p.vendor.label, p.vendor.id, host(p.baseUrl)].some((s) =>
    s.toLowerCase().includes(q),
  )
}

/**
 * Presets grouped by vendor for the catalog. Vendors that have a tested preset come first; inside a vendor tested
 * presets come first, then by region (domestic, international, local), then by name. Documented-only presets are
 * never the first thing offered.
 */
export function groupPresets(presets: readonly Preset[], query = ''): VendorGroup[] {
  const shown = presets.filter((p) => matchesQuery(p, query))
  const order: string[] = []
  const map = new Map<string, VendorGroup>()
  for (const p of shown) {
    let g = map.get(p.vendor.id)
    if (!g) {
      g = { vendor: p.vendor, presets: [] }
      map.set(p.vendor.id, g)
      order.push(p.vendor.id)
    }
    g.presets.push(p)
  }
  const groups = order.map((id) => map.get(id)!)
  for (const g of groups)
    g.presets.sort(
      (a, b) =>
        tested(a) - tested(b) ||
        (a.region ? REGION_ORDER[a.region] : 9) - (b.region ? REGION_ORDER[b.region] : 9) ||
        a.label.localeCompare(b.label),
    )
  return groups
    .map((g, i) => ({ g, i }))
    .sort(
      (a, b) =>
        Math.min(...a.g.presets.map(tested)) - Math.min(...b.g.presets.map(tested)) || a.i - b.i,
    )
    .map((x) => x.g)
}

/** A preset that cannot be created as it is: its address has `{placeholders}`, or it suggests no model. */
export function needsInput(p: Preset): boolean {
  return (p.baseUrlPlaceholders?.length ?? 0) > 0 || p.suggestedModel.trim() === ''
}

/**
 * A value that is safe inside a host name or a path segment: letters, digits and . _ ~ -, starting and ending with a letter
 * or digit. That refuses `.`, `..`, and values with a leading or trailing dot or hyphen (a bad host label, or a path trick).
 */
const VALUE = /^[A-Za-z0-9](?:[A-Za-z0-9._~-]*[A-Za-z0-9])?$/

export type InputProblem = { field: string; kind: 'missing' | 'invalid' }

/** What is still wrong with the values the user typed for a preset's placeholders and model. */
export function inputProblems(
  p: Preset,
  values: Record<string, string>,
  model: string,
): InputProblem[] {
  const out: InputProblem[] = []
  for (const name of p.baseUrlPlaceholders ?? []) {
    const v = (values[name] ?? '').trim()
    if (v === '') out.push({ field: name, kind: 'missing' })
    else if (!VALUE.test(v)) out.push({ field: name, kind: 'invalid' })
  }
  if (p.suggestedModel.trim() === '' && model.trim() === '')
    out.push({ field: 'model', kind: 'missing' })
  return out
}

/** The preset's address with the user's values put in. Values are trimmed; unknown placeholders are left alone. */
export function resolveBaseUrl(url: string, values: Record<string, string>): string {
  return url.replace(/\{([^}]+)\}/g, (m, name: string) =>
    values[name]?.trim() ? values[name]!.trim() : m,
  )
}
