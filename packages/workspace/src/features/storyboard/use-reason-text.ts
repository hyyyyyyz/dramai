import { useTranslation } from 'react-i18next'
import type { Asset } from '@dramai/api'
import { isReasonCode } from './reasons'

/** 原因码 → 本地化文字；资产名由 assetId 查出来（名字是用户自己填的，原样显示）。 */
export function useReasonText(assets: ReadonlyMap<string, Asset>) {
  const { t } = useTranslation()
  return (r: { code: string; assetId?: string }): string => {
    const name = (r.assetId && assets.get(r.assetId)?.name) || t('reasons.someAsset')
    if (isReasonCode(r.code)) return t(`reasons.${r.code}`, { name })
    return t('reasons.unknown', { code: r.code })
  }
}
