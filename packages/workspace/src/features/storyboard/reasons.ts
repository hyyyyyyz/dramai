/**
 * 准入 / 预检给出的原因码（core 的 admission 与 generation/inputs）。界面按码取文案（i18n 的 `reasons.<码>`），
 * 不用服务端的 message：它有的是英文、有的是中文，也没有名字的本地化。
 */
export const REASON_CODES = [
  'PROMPT_EMPTY',
  'ASSET_SHEET_MISSING',
  'ASSET_NOT_REGISTERED',
  'BASE_SHEET_MISSING',
  'SHEET_TO_EDIT_MISSING',
  'EDIT_INSTRUCTION_EMPTY',
  'VARIANT_NOT_FOUND',
  'VARIANT_COSTUME_INVALID',
  'START_FRAME_MISSING',
  'IN_FLIGHT_CONFLICT',
  'RECOVER_ORIGINAL_FIRST',
  'PROVIDER_DISABLED',
  'PROVIDER_KIND_MISMATCH',
  'NO_PROVIDER',
  'PROVIDER_NOT_FOUND',
  'MODE_UNSUPPORTED',
  'REFERENCE_NOT_SUPPORTED',
  'FIRST_FRAME_UNSUPPORTED',
  'LAST_FRAME_UNSUPPORTED',
  'DURATION_UNSUPPORTED',
  'RESOLUTION_UNSUPPORTED',
  'ASPECT_UNSUPPORTED',
  'NARRATION_EMPTY',
  'NARRATION_NOT_TTS',
  'NARRATION_VOICE_DEFAULTED',
  'VOICE_CONFLICT',
  'DIALOGUE_NOT_VOICED',
  'TARGET_NOT_FOUND',
  'FILE_UNREADABLE',
  'ORIGINAL_UNREADABLE',
  'DUPLICATE_TARGET',
  'ENQUEUE_ABORTED',
  'ENQUEUE_FAILED',
  'CAPABILITY_UNVERIFIED',
  'UNVERIFIED_NEEDS_CONFIRMATION',
  'BLOCKED_BY_BATCH',
  'DURATION_SNAPPED',
  'OPTIONAL_INPUT_OMITTED',
  'REFS_TRIMMED',
] as const
export type ReasonCode = (typeof REASON_CODES)[number]
export const isReasonCode = (code: string): code is ReasonCode =>
  (REASON_CODES as readonly string[]).includes(code)

/** 原因旁边的“直达补齐的地方”按钮。 */
export type ReasonAction =
  | { kind: 'asset'; assetId: string }
  | { kind: 'candidates' }
  | { kind: 'prompts' }
  | { kind: 'generateImage' }
  | { kind: 'providers' }
  | { kind: 'tasks' }
  | { kind: 'edit' }

export function reasonAction(r: { code: string; assetId?: string }): ReasonAction | undefined {
  switch (r.code) {
    case 'ASSET_SHEET_MISSING':
    case 'BASE_SHEET_MISSING':
    case 'VARIANT_COSTUME_INVALID':
      return r.assetId ? { kind: 'asset', assetId: r.assetId } : undefined
    case 'ASSET_NOT_REGISTERED':
      return { kind: 'candidates' }
    case 'PROMPT_EMPTY':
      return { kind: 'prompts' }
    case 'START_FRAME_MISSING':
      return { kind: 'generateImage' }
    case 'RECOVER_ORIGINAL_FIRST':
    case 'IN_FLIGHT_CONFLICT':
      return { kind: 'tasks' }
    case 'PROVIDER_DISABLED':
    case 'PROVIDER_KIND_MISMATCH':
    case 'NO_PROVIDER':
    case 'PROVIDER_NOT_FOUND':
    case 'MODE_UNSUPPORTED':
    case 'REFERENCE_NOT_SUPPORTED':
    case 'FIRST_FRAME_UNSUPPORTED':
    case 'LAST_FRAME_UNSUPPORTED':
    case 'RESOLUTION_UNSUPPORTED':
    case 'ASPECT_UNSUPPORTED':
    case 'NARRATION_NOT_TTS':
      return { kind: 'providers' }
    case 'DURATION_UNSUPPORTED':
    case 'NARRATION_EMPTY':
    case 'VOICE_CONFLICT':
      return { kind: 'edit' }
    default:
      return undefined
  }
}
