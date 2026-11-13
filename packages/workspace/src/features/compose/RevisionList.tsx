import { useTranslation } from 'react-i18next'
import type { TimelineView } from '@dramai/api'
import { Button, Pill } from '@dramai/ui/v2'
import { useFormat } from '@/i18n/format'
import { Block } from '@/features/common/PageHead'
import { clipName } from './timeline-model'

/** 修订历史：只追加，不改写；回滚是把旧修订的内容追加成一个新修订。 */
export function RevisionList({
  view,
  onRollback,
  busy,
  cutRevision,
}: {
  view: TimelineView
  onRollback: (revision: number) => void
  busy?: boolean
  /** 现有成片是按哪一版渲染的（没有就不写）。 */
  cutRevision?: number
}) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const list = [...view.revisions].sort((a, b) => b.number - a.number)
  // System revisions are described in the interface's language from what they are, not from the server's Chinese summary
  // (and an automatic change is the system's, not an "agent edit"). Everything else shows the summary it was saved with.
  const titleOf = (r: TimelineView['revisions'][number]): string => {
    if (r.reason === 'native_audio_default') {
      const names = (r.changedClipIds ?? []).map((id) => clipName(view.revision.content, id))
      return names.length > 0
        ? t('compose.revisions.nativeAudioClips', {
            clips: names.join(t('compose.revisions.listSep')),
          })
        : t('compose.revisions.nativeAudio')
    }
    if (r.restoredFrom) return t('compose.revisions.restoredTo', { n: r.restoredFrom })
    if (r.number === 1 && r.parent === undefined) return t('compose.revisions.initial')
    return r.summary
  }
  const authorOf = (r: TimelineView['revisions'][number]) =>
    r.reason ? t('compose.revisions.author.system') : t(`compose.revisions.author.${r.author.kind}`)
  return (
    <Block title={t('compose.revisions.title')} aria-label={t('compose.revisions.title')}>
      <ul className="flex flex-col p-4">
        {list.map((r) => (
          <li
            key={r.number}
            className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 border-t border-border py-3 first:border-t-0 first:pt-0"
          >
            <span className="font-mono text-muted-foreground tabular-nums">{r.number}</span>
            <div className="min-w-0">
              <div className={r.reason ? undefined : 'truncate'}>{titleOf(r)}</div>
              <small className="text-xs text-muted-foreground">
                {[
                  authorOf(r),
                  fmt.ago(r.createdAt),
                  cutRevision === r.number ? t('compose.revisions.cutFrom') : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            </div>
            {r.number === view.head ? (
              <Pill tone="accent">{t('compose.revisions.current')}</Pill>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={t('compose.revisions.rollbackLabel', { n: r.number })}
                onClick={() => onRollback(r.number)}
              >
                {t('compose.revisions.rollback')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="border-t border-border p-4 text-xs text-subtle">
        {t('compose.revisions.hint')}
      </p>
    </Block>
  )
}
