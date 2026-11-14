import { useTranslation } from 'react-i18next'
import type { Asset } from '@dramai/api'
import { isReasonCode } from './reasons'

/** The numbers of a "too long" reason, as the server gives them (`details`). */
type Details = { limit: number; actual: number; counting: string }

/** 原因码 → 本地化文字；资产名由 assetId 查出来（名字是用户自己填的，原样显示）。 */
export function useReasonText(assets: ReadonlyMap<string, Asset>, opts?: { video?: boolean }) {
  const { t } = useTranslation()
  /**
   * `warning`: the same code can come as a warning (an address that isn't the vendor's own, or a model with no
   * profile, is only warned about), and then the words say it "may fail", not that it cannot be generated.
   */
  return (
    r: { code: string; message?: string; assetId?: string; details?: Details },
    ctx?: { warning?: boolean },
  ): string => {
    const name = (r.assetId && assets.get(r.assetId)?.name) || t('reasons.someAsset')
    // for a video shot, "reference images not supported" means the switch cannot be on, not that a sheet is missing
    if (r.code === 'REFERENCE_NOT_SUPPORTED' && opts?.video)
      return t('reasons.REFERENCE_NOT_SUPPORTED_VIDEO')
    const kind = ctx?.warning && SPEECH_WARNABLE.includes(r.code) ? 'reasons.warn.' : 'reasons.'
    // a text that is too long: the limit and the actual length come from the server's own count, never from here
    if (r.code === 'TEXT_TOO_LONG' || r.code === 'INSTRUCTION_TOO_LONG') {
      const d = r.details
      return d
        ? t(`${kind}${r.code}` as 'reasons.TEXT_TOO_LONG', {
            actual: d.actual,
            limit: d.limit,
            how:
              d.counting === 'characters' || d.counting === 'cjk_double'
                ? t(`reasons.how.${d.counting}` as 'reasons.how.characters')
                : '',
          })
        : t(`${kind}${r.code}_PLAIN` as 'reasons.TEXT_TOO_LONG_PLAIN')
    }
    if (isReasonCode(r.code)) return t(`${kind}${r.code}` as 'reasons.PROMPT_EMPTY', { name })
    // a code this version has no words for (a newer server): the server's own text, never a blank or a key name
    return r.message?.trim() ? r.message : t('reasons.unknown', { code: r.code })
  }
}

/** The speech codes that can come as a warning as well as a block. */
export const SPEECH_WARNABLE: readonly string[] = [
  'VOICE_NOT_AVAILABLE',
  'VOICE_FROM_ANOTHER_SERVICE',
  'VOICE_FORMAT_INVALID',
  'INSTRUCTION_TOO_LONG',
  'TEXT_TOO_LONG',
]
