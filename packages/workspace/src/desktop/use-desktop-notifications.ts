import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { JobListItem } from '@dramai/api'
import { useJobs } from '@/data/queries'
import { isKnownOperation } from '@/features/jobs/job-model'
import { callBridge, isDesktop } from './bridge'
import { jobTransitions, notificationsEnabled } from './notifications'

const BATCH_MS = 1500

/**
 * In the desktop app, tell the user (system notification) when tasks finish or need attention. The desktop shell
 * itself stays quiet while its window is focused. Several jobs ending within a moment become one notification.
 * Does nothing in a browser.
 */
export function useDesktopNotifications() {
  const { t } = useTranslation()
  const jobs = useJobs()
  const seen = useRef(new Map<string, JobListItem['status']>())
  const loaded = useRef(false)
  const pending = useRef<{ done: JobListItem[]; attention: JobListItem[] }>({
    done: [],
    attention: [],
  })
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const items = jobs.data?.items
    if (!items || !isDesktop()) return
    if (loaded.current) {
      const moved = jobTransitions(seen.current, items)
      pending.current.done.push(...moved.done)
      pending.current.attention.push(...moved.attention)
      if ((moved.done.length > 0 || moved.attention.length > 0) && timer.current === undefined) {
        timer.current = setTimeout(() => {
          timer.current = undefined
          const { done, attention } = pending.current
          pending.current = { done: [], attention: [] }
          if (!notificationsEnabled()) return
          const name = (j: JobListItem) =>
            isKnownOperation(j.operation) ? t(`jobs.op.${j.operation}`) : j.operation
          if (attention.length > 0) {
            void callBridge(
              (b) =>
                b.notify({
                  title: t('desktop.notify.attention', { count: attention.length }),
                  body: attention.length === 1 ? name(attention[0]!) : undefined,
                }),
              false,
            )
          }
          if (done.length > 0) {
            void callBridge(
              (b) =>
                b.notify({
                  title: t('desktop.notify.done', { count: done.length }),
                  body: done.length === 1 ? name(done[0]!) : undefined,
                }),
              false,
            )
          }
        }, BATCH_MS)
      }
    }
    seen.current = new Map(items.map((j) => [j.id, j.status]))
    loaded.current = true
  }, [jobs.data, t])

  useEffect(() => () => clearTimeout(timer.current), [])
}
