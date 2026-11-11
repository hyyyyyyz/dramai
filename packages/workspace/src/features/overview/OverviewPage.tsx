import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { FolderOpen, SlidersHorizontal } from 'lucide-react'
import { Button, EmptyState, Skeleton, iconProps, iconPropsLg } from '@dramai/ui/v2'
import { useCurrentEpisode } from '@/data/current-episode'
import { qk } from '@/data/keys'
import {
  useAssets,
  useCall,
  useCandidates,
  useMaterials,
  useProject,
  useProviders,
  useSettings,
} from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import { Block, PageHead } from '@/features/common/PageHead'
import { projectMeta } from '@/features/projects/project-meta'
import { EpisodeList } from './EpisodeList'
import { NextSteps } from './NextSteps'
import { useActiveOps } from './use-active-ops'
import { ProjectSettingsDialog } from './ProjectSettingsDialog'

function Kv({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2 p-4 text-sm leading-normal tabular-nums">
      {children}
    </dl>
  )
}
const Dt = ({ children }: { children: React.ReactNode }) => (
  <dt className="text-muted-foreground">{children}</dt>
)
const Dd = ({ children }: { children: React.ReactNode }) => <dd className="min-w-0">{children}</dd>

export function OverviewPage() {
  const { projectId = '' } = useParams()
  const { t } = useTranslation()
  const project = useProject(projectId)
  const { current, episodes, select } = useCurrentEpisode(projectId)
  const materials = useMaterials(projectId)
  const assets = useAssets(projectId)
  const candidates = useCandidates(projectId)
  const settings = useSettings()
  const providers = useProviders()
  const [editing, setEditing] = useState(false)
  const activeOps = useActiveOps(projectId)
  const invalidate = [qk.jobs, qk.episodes(projectId), qk.projects]
  const breakdown = useCall('episodes.breakdown', { invalidate })
  const extract = useCall('episodes.extractEntities', { invalidate })

  if (project.isError) return <ErrorNotice error={project.error} />
  if (project.isPending || !episodes) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-72" />
      </div>
    )
  }
  const p = project.data
  const inProgress = episodes.filter(
    (e) => e.status !== 'planned' && e.status !== 'exported',
  ).length
  const textMaterials = (materials.data?.items ?? []).filter((m) => m.kind !== 'image')
  const images = (materials.data?.items ?? []).filter((m) => m.kind === 'image')
  const chapters = textMaterials.reduce((n, m) => n + m.chapters.length, 0)
  const byKind = (k: string) => assets.data?.items.filter((a) => a.kind === k).length ?? 0
  const active = settings.data?.activeProviders
  const activeLabels = (['llm', 'image', 'video', 'tts'] as const)
    .map((k) => providers.data?.items.find((x) => x.id === active?.[k])?.label)
    .filter(Boolean)
  const firstError = breakdown.error ?? extract.error

  const runBreakdown = (id: string) => breakdown.mutate({ params: { episodeId: id }, body: {} })
  const runExtract = (id: string) => extract.mutate({ params: { episodeId: id }, body: {} })

  return (
    <>
      <PageHead
        title={p.name}
        sub={`${projectMeta(p, t)} · ${t('overview.episodeCount', { count: episodes.length })}`}
        actions={
          <>
            <Link to={`/projects/${projectId}/materials`}>
              <Button variant="ghost" tabIndex={-1}>
                <FolderOpen {...iconProps} aria-hidden />
                {t('overview.materialsAndPlan')}
              </Button>
            </Link>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <SlidersHorizontal {...iconProps} aria-hidden />
              {t('overview.settings.open')}
            </Button>
          </>
        }
      />
      {firstError !== null && firstError !== undefined && (
        <ErrorNotice error={firstError} className="mb-4" />
      )}

      <div className="grid items-start gap-6 @4xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          {episodes.length === 0 ? (
            <EmptyState
              icon={<FolderOpen {...iconPropsLg} aria-hidden />}
              title={
                textMaterials.length === 0
                  ? t('overview.empty.noMaterialTitle')
                  : t('overview.empty.noEpisodesTitle')
              }
              description={
                textMaterials.length === 0
                  ? t('overview.empty.noMaterialBody')
                  : t('overview.empty.noEpisodesBody')
              }
              action={
                <Link to={`/projects/${projectId}/materials`}>
                  <Button variant="primary" tabIndex={-1}>
                    {textMaterials.length === 0
                      ? t('overview.empty.uploadAction')
                      : t('overview.empty.planAction')}
                  </Button>
                </Link>
              }
            />
          ) : (
            <>
              {current && (
                <NextSteps
                  projectId={projectId}
                  episode={current}
                  progress={current.progress}
                  episodesInProgress={inProgress}
                  episodeCount={episodes.length}
                  onBreakdown={() => runBreakdown(current.id)}
                  onExtract={() => runExtract(current.id)}
                  busy={
                    (breakdown.isPending && breakdown.variables?.params.episodeId === current.id) ||
                    activeOps.has(`episode_breakdown:${current.id}`)
                      ? 'breakdown'
                      : (extract.isPending && extract.variables?.params.episodeId === current.id) ||
                          activeOps.has(`entities_extract:${current.id}`)
                        ? 'extract'
                        : undefined
                  }
                />
              )}
              <EpisodeList
                projectId={projectId}
                episodes={episodes}
                materials={materials.data?.items ?? []}
                currentId={current?.id}
                onSelect={select}
                onBreakdown={runBreakdown}
                breakingDown={(id) =>
                  (breakdown.isPending && breakdown.variables?.params.episodeId === id) ||
                  activeOps.has(`episode_breakdown:${id}`)
                }
              />
            </>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Block title={t('overview.settings.title')}>
            <Kv>
              <Dt>{t('overview.kv.aspect')}</Dt>
              <Dd>
                {t(`aspect.${p.aspectRatio}`)}
                <span className="mt-1 block text-xs text-subtle">
                  {t('overview.kv.aspectNote')}
                </span>
              </Dd>
              <Dt>{t('overview.kv.style')}</Dt>
              <Dd>
                {p.style.source === 'none' ? t('style.none') : p.style.label}
                <span className="mt-1 block text-xs text-subtle">{t('overview.kv.styleNote')}</span>
              </Dd>
              <Dt>{t('overview.kv.narration')}</Dt>
              <Dd>{t(`narration.${p.narrationDelivery}.title`)}</Dd>
              <Dt>{t('overview.kv.models')}</Dt>
              <Dd>
                {activeLabels.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {activeLabels.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                ) : (
                  <Link to="/settings/providers" className="text-accent-text hover:underline">
                    {t('overview.kv.noModels')}
                  </Link>
                )}
              </Dd>
            </Kv>
          </Block>
          <Block
            title={t('nav.assets')}
            aside={
              <Link
                to={`/projects/${projectId}/assets`}
                className="text-accent-text hover:underline"
              >
                {t('common.open')}
              </Link>
            }
          >
            <Kv>
              <Dt>{t('assetKind.character')}</Dt>
              <Dd>{byKind('character')}</Dd>
              <Dt>{t('assetKind.location')}</Dt>
              <Dd>{byKind('location')}</Dd>
              <Dt>{t('assetKind.prop')}</Dt>
              <Dd>{byKind('prop')}</Dd>
              <Dt>{t('assetKind.costume')}</Dt>
              <Dd>{byKind('costume')}</Dd>
              <Dt>{t('nav.candidates')}</Dt>
              <Dd>
                <Link
                  to={`/projects/${projectId}/candidates`}
                  className="text-accent-text hover:underline"
                >
                  {t('overview.kv.candidatesPending', {
                    count: candidates.data?.progress.pending ?? 0,
                  })}
                </Link>
              </Dd>
            </Kv>
          </Block>
          <Block
            title={t('nav.materials')}
            aside={
              <Link
                to={`/projects/${projectId}/materials`}
                className="text-accent-text hover:underline"
              >
                {t('common.open')}
              </Link>
            }
          >
            <Kv>
              <Dt>{t('overview.kv.sourceText')}</Dt>
              <Dd>
                {textMaterials.length === 0
                  ? t('overview.kv.none')
                  : t('overview.kv.textSummary', { files: textMaterials.length, chapters })}
              </Dd>
              <Dt>{t('overview.kv.referenceImages')}</Dt>
              <Dd>{t('overview.kv.imageCount', { count: images.length })}</Dd>
            </Kv>
          </Block>
        </div>
      </div>
      {editing && <ProjectSettingsDialog project={p} onClose={() => setEditing(false)} />}
    </>
  )
}
