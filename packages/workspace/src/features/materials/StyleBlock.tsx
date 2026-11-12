import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Project } from '@dramai/api'
import { Button, Hint, iconProps } from '@dramai/ui/v2'
import { Upload } from 'lucide-react'
import { useApi } from '@/data/use-api'
import { qk } from '@/data/keys'
import { useCall } from '@/data/queries'
import { Block } from '@/features/common/PageHead'
import { ErrorNotice } from '@/features/common/error-text'
import { StylePicker } from '@/features/projects/pickers'
import { toStyleChoice, type StylePick } from '@/features/projects/style-choice'

function initial(style: Project['style']): StylePick {
  if (style.source === 'template') return { templateId: style.templateId, custom: '' }
  if (style.source === 'custom') return { custom: style.description }
  return { custom: '' }
}

/** 风格：模板 / 自己描述 / 不指定，三选一。风格在创建时展开成快照，之后模板更新不会改动本项目。 */
export function StyleBlock({ project }: { project: Project }) {
  const { t } = useTranslation()
  const [pick, setPick] = useState<StylePick>(() => initial(project.style))
  const api = useApi()
  const file = useRef<HTMLInputElement>(null)
  const update = useCall('projects.update', { invalidate: [qk.project(project.id), qk.projects] })
  const reference = useCall('projects.setStyleReference', {
    invalidate: [qk.project(project.id), qk.projects],
  })
  const base = initial(project.style)
  const dirty = pick.templateId !== base.templateId || pick.custom.trim() !== base.custom.trim()
  const current =
    project.style.source === 'none'
      ? t('style.none')
      : project.style.source === 'reference_image'
        ? t('style.referenceImage')
        : project.style.label
  return (
    <Block title={t('style.title')} aria-label={t('style.title')}>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm">
          <span className="text-muted-foreground">{t('style.current')}</span> {current}
        </p>
        <StylePicker value={pick} onChange={setPick} />
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="text-sm font-medium">{t('style.reference.title')}</div>
          <div className="flex items-center gap-3">
            {project.style.referenceFile && (
              <img
                src={api.fileUrl(project.id, project.style.referenceFile.path)}
                alt={t('style.reference.alt')}
                className="aspect-[3/4] w-12 rounded-sm bg-sunken object-cover"
              />
            )}
            <Button
              size="sm"
              variant="secondary"
              loading={reference.isPending}
              onClick={() => file.current?.click()}
            >
              <Upload {...iconProps} aria-hidden />
              {project.style.referenceFile
                ? t('style.reference.replace')
                : t('style.reference.upload')}
            </Button>
            <input
              ref={file}
              type="file"
              hidden
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                const form = new FormData()
                form.append('file', f)
                reference.mutate({ params: { projectId: project.id }, form })
              }}
            />
          </div>
          <Hint>{t('style.reference.hint')}</Hint>
        </div>
        {(update.isError || reference.isError) && (
          <ErrorNotice error={update.error ?? reference.error} />
        )}
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            disabled={!dirty}
            loading={update.isPending}
            onClick={() =>
              update.mutate({
                params: { projectId: project.id },
                body: { style: toStyleChoice(pick) },
              })
            }
          >
            {t('style.save')}
          </Button>
        </div>
      </div>
    </Block>
  )
}
