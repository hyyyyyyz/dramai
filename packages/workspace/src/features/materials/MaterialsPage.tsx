import { useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@dramai/ui/v2'
import { useEpisodes, useMaterials, useProject } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import { PageHead } from '@/features/common/PageHead'
import { EpisodePlanBlock } from './EpisodePlanBlock'
import { SourceTextBlock } from './MaterialSources'
import { ReferenceImages } from './ReferenceImages'
import { StyleBlock } from './StyleBlock'

export function MaterialsPage() {
  const { projectId = '' } = useParams()
  const { t } = useTranslation()
  const project = useProject(projectId)
  const materials = useMaterials(projectId)
  const episodes = useEpisodes(projectId)
  const err = project.error ?? materials.error ?? episodes.error
  if (err) return <ErrorNotice error={err} />
  if (!project.data || !materials.data || !episodes.data) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64" />
      </div>
    )
  }
  return (
    <>
      <PageHead title={t('materials.title')} sub={t('materials.sub')} />
      <div className="grid items-start gap-6 @4xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <SourceTextBlock projectId={projectId} materials={materials.data.items} />
          <EpisodePlanBlock
            projectId={projectId}
            episodes={episodes.data.items}
            episodeOrder={project.data.episodeOrder}
            materials={materials.data.items}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <StyleBlock key={project.data.updatedAt} project={project.data} />
          <ReferenceImages projectId={projectId} materials={materials.data.items} />
        </div>
      </div>
    </>
  )
}
