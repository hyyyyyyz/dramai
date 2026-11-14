import { useTranslation } from 'react-i18next'
import type { Asset } from '@dramai/api'
import { isReasonCode } from './reasons'

/** 原因码 → 本地化文字；资产名由 assetId 查出来（名字是用户自己填的，原样显示）。 */
export function useReasonText(
  assets: ReadonlyMap<string, Asset>,
  opts?: { video?: boolean; speech?: { limit?: number; instructionChars?: number } },
) {
  const { t } = useTranslation()
  return (
    r: { code: string; message?: string; assetId?: string },
    ctx?: { chars?: number },
  ): string => {
    const name = (r.assetId && assets.get(r.assetId)?.name) || t('reasons.someAsset')
    // for a video shot, "reference images not supported" means the switch cannot be on, not that a sheet is missing
    if (r.code === 'REFERENCE_NOT_SUPPORTED' && opts?.video)
      return t('reasons.REFERENCE_NOT_SUPPORTED_VIDEO')
    // a narration that is too long: say how long it is and what the limit is (known from the shot and the model)
    if (r.code === 'TEXT_TOO_LONG') {
      const limit = opts?.speech?.limit
      return ctx?.chars !== undefined && limit !== undefined
        ? t('reasons.TEXT_TOO_LONG', { chars: ctx.chars, limit })
        : t('reasons.TEXT_TOO_LONG_PLAIN')
    }
    if (r.code === 'INSTRUCTION_TOO_LONG')
      return t('reasons.INSTRUCTION_TOO_LONG', { n: opts?.speech?.instructionChars ?? '' })
    if (isReasonCode(r.code)) return t(`reasons.${r.code}`, { name })
    // a code this version has no words for (a newer server): the server's own text, never a blank or a key name
    return r.message?.trim() ? r.message : t('reasons.unknown', { code: r.code })
  }
}
