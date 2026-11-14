import { useTranslation } from 'react-i18next'
import type { Notice } from '@/data/events'

/**
 * A `job.notice` in the interface's language: a code this version knows has its own words; a code it doesn't shows the
 * server's message (the style follows `level`, which the caller reads). Never a key name or a blank.
 */
export const KNOWN_NOTICE_CODES = ['native_audio_default_failed', 'audio_decode_warnings'] as const

export function useNoticeText() {
  const { t } = useTranslation()
  return (n: Pick<Notice, 'code' | 'message'>): { title?: string; body: string } =>
    (KNOWN_NOTICE_CODES as readonly string[]).includes(n.code)
      ? {
          title: t(
            `jobs.notice.${n.code}.title` as 'jobs.notice.native_audio_default_failed.title',
          ),
          body: t(`jobs.notice.${n.code}.body` as 'jobs.notice.native_audio_default_failed.body'),
        }
      : { body: n.message }
}
