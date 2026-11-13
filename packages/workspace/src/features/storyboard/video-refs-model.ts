import type { VideoPlan } from '@dramai/api'

/**
 * Reference images for video ("use the character sheets as references", off by default). What it does depends on the
 * model, and the pre-flight result says which case this is, so the dialog can tell the user before they confirm:
 * - `frame_as_reference`: the model cannot take a first frame and references together (Seedance, Wan 3.0), so with the
 *   switch on the shot image becomes reference no. 1 and the strict first frame is given up;
 * - `frame_with_references`: the first frame is kept and the references go alongside (Kling; not verified);
 * - `not_available`: the model takes no reference images, so the switch cannot be on.
 */
export type IfRefsOn = VideoPlan['ifRefsOn']

/** The distinct "what would happen if on" values over the chosen shots, in a stable order. */
export function ifRefsOnOf(plans: readonly (VideoPlan | undefined)[]): IfRefsOn[] {
  const seen = new Set<IfRefsOn>()
  for (const p of plans) if (p) seen.add(p.ifRefsOn)
  return (['frame_as_reference', 'frame_with_references', 'not_available'] as const).filter((k) =>
    seen.has(k),
  )
}

/** The switch cannot be turned on when every chosen shot's model refuses reference images. */
export const refsUnavailable = (plans: readonly (VideoPlan | undefined)[]): boolean => {
  const known = plans.filter((p): p is VideoPlan => p !== undefined)
  return known.length > 0 && known.every((p) => p.ifRefsOn === 'not_available')
}

/** What this run does with the shot image, for a shot whose switch is on. */
export type FrameOutcome = 'strict_with_refs' | 'as_reference' | 'strict_no_refs'

export function frameOutcome(p: VideoPlan): FrameOutcome {
  if (p.frame === 'as_reference') return 'as_reference'
  if (p.frame === 'with_references') return 'strict_with_refs'
  // refs were asked for but nothing was sent with the first frame (no usable sheets)
  return 'strict_no_refs'
}

/** Warning codes the dialog shows itself, next to each shot, instead of in the general list. */
export const VIDEO_PLAN_WARNINGS: readonly string[] = [
  'FIRST_FRAME_REPLACED_BY_REFERENCE',
  'VIDEO_REFS_EMPTY',
  'REFS_TRIMMED',
]
