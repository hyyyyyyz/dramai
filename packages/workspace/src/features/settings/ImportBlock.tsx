import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { FileUp } from 'lucide-react'
import { Button, Checkbox, Hint, Notice, iconProps } from '@dramai/ui/v2'
import { qk } from '@/data/keys'
import { useCall } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import { Block } from '@/features/common/PageHead'

/**
 * 导入旧版（v0.4）备份：选一个备份 JSON，导入成新项目。旧版的生成记录和未完成的视频任务不会带过来，结果里写明。
 * 同一个旧项目默认不重复导入，要重复得勾选。
 */
export function ImportBlock() {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [allowDuplicate, setAllowDuplicate] = useState(false)
  const imp = useCall('import.legacy', { invalidate: [qk.projects] })
  const summary = imp.data

  return (
    <Block
      title={t('settings.data.import.title')}
      aside={t('settings.data.import.sub')}
      aria-label={t('settings.data.import.title')}
    >
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted-foreground">{t('settings.data.import.body')}</p>
        <div className="flex flex-wrap items-center gap-4">
          <Button
            variant="secondary"
            loading={imp.isPending}
            onClick={() => input.current?.click()}
          >
            <FileUp {...iconProps} aria-hidden />
            {t('settings.data.import.choose')}
          </Button>
          <Checkbox
            checked={allowDuplicate}
            onChange={(e) => setAllowDuplicate(e.target.checked)}
            label={t('settings.data.import.duplicate')}
          />
          <input
            ref={input}
            type="file"
            hidden
            accept="application/json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              const form = new FormData()
              form.append('file', f)
              if (allowDuplicate) form.append('allowDuplicate', 'true')
              imp.mutate({ form })
            }}
          />
        </div>
        <Hint>{t('settings.data.import.hint')}</Hint>
        {imp.isError && <ErrorNotice error={imp.error} />}
        {summary && (
          <div className="flex flex-col gap-3" role="status">
            <Notice tone={summary.projects.length > 0 ? 'info' : 'warn'}>
              {t('settings.data.import.done', { count: summary.projects.length })}
            </Notice>
            {summary.projects.length > 0 && (
              <ul className="flex flex-col gap-2">
                {summary.projects.map((p) => (
                  <li key={p.projectId} className="rounded-md bg-surface-2 p-3 text-sm">
                    <Link
                      to={`/projects/${p.projectId}`}
                      className="font-medium text-accent-text underline underline-offset-2"
                    >
                      {p.name}
                    </Link>
                    <div className="text-muted-foreground">
                      {t('settings.data.import.counts', {
                        episodes: p.episodes,
                        shots: p.shots,
                        assets: p.assets,
                        materials: p.materials,
                        images: p.images,
                        videos: p.videos,
                      })}
                    </div>
                    {p.artifactsSkipped > 0 && (
                      <div className="text-warn">
                        {t('settings.data.import.skippedArtifacts', { count: p.artifactsSkipped })}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {summary.skipped.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                {summary.skipped.map((s) => (
                  <li key={s.legacyId}>
                    {t('settings.data.import.skipped', { id: s.legacyId, reason: s.reason })}
                  </li>
                ))}
              </ul>
            )}
            {(summary.droppedGenerations > 0 || summary.droppedPendingVideoTasks > 0) && (
              <p className="text-sm text-muted-foreground">
                {t('settings.data.import.dropped', {
                  generations: summary.droppedGenerations,
                  tasks: summary.droppedPendingVideoTasks,
                })}
              </p>
            )}
          </div>
        )}
      </div>
    </Block>
  )
}
