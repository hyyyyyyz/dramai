import { useMemo } from 'react'
import { useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Undo2 } from 'lucide-react'
import type { Candidate } from '@dramai/api'
import { Button, EmptyState, Pill, Progress, Skeleton, iconProps } from '@dramai/ui/v2'
import { qk } from '@/data/keys'
import { useAssets, useCall, useCandidates } from '@/data/queries'
import { AssetTabs } from '@/features/common/ProjectTabs'
import { ErrorNotice } from '@/features/common/error-text'
import { PageHead } from '@/features/common/PageHead'
import { useShotIndex } from '@/features/common/use-shot-index'
import { CandidateRow } from './CandidateRow'
import { groupPending } from './candidate-model'

export function CandidatesPage() {
  const { projectId = '' } = useParams()
  const { t } = useTranslation()
  const candidates = useCandidates(projectId)
  const assetsQ = useAssets(projectId)
  const index = useShotIndex(projectId)
  const invalidate = [
    qk.candidates(projectId),
    qk.assets(projectId),
    qk.episodes(projectId),
    qk.preflight,
    qk.artifacts,
    ['asset'],
    ['episode'],
  ]
  const accept = useCall('candidates.accept', { invalidate })
  const link = useCall('candidates.link', { invalidate })
  const ignore = useCall('candidates.ignore', { invalidate })
  const undo = useCall('candidates.undoLink', { invalidate })

  const items = useMemo(() => candidates.data?.items ?? [], [candidates.data])
  const assets = useMemo(() => assetsQ.data?.items ?? [], [assetsQ.data])
  const assetsById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets])
  const groups = useMemo(() => groupPending(items), [items])
  const handled = items.filter((c) => c.status !== 'pending')
  const busyId =
    (accept.isPending && accept.variables?.params.candidateId) ||
    (link.isPending && link.variables?.params.candidateId) ||
    (ignore.isPending && ignore.variables?.params.candidateId) ||
    (undo.isPending && undo.variables?.params.candidateId) ||
    undefined
  const error = accept.error ?? link.error ?? ignore.error ?? undo.error

  const progress = candidates.data?.progress
  const infosOf = (c: Candidate) =>
    c.shotIds.flatMap((id) => (index.shots.get(id) ? [index.shots.get(id)!] : []))

  return (
    <>
      <PageHead title={t('candidates.title')} sub={t('candidates.sub')} />
      <AssetTabs projectId={projectId} />
      {candidates.isError && <ErrorNotice error={candidates.error} />}
      {error !== null && error !== undefined && <ErrorNotice error={error} className="mb-4" />}
      {candidates.isPending && <Skeleton className="h-48" />}

      {progress && progress.total > 0 && (
        <div className="mb-4 flex items-center gap-4">
          <span className="font-mono text-sm text-muted-foreground">
            {t('candidates.progress', { done: progress.handled, total: progress.total })}
          </span>
          <Progress
            className="max-w-sm flex-1"
            aria-label={t('candidates.progressLabel')}
            value={progress.handled}
            max={progress.total}
          />
        </div>
      )}

      {progress && progress.total === 0 && (
        <EmptyState title={t('candidates.empty.title')} description={t('candidates.empty.body')} />
      )}
      {progress && progress.total > 0 && groups.length === 0 && (
        <EmptyState
          title={t('candidates.allDone.title')}
          description={t('candidates.allDone.body')}
        />
      )}

      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <section
            key={g.kind}
            aria-label={t(`assetKind.${g.kind}`)}
            className="rounded-lg border border-border bg-surface"
          >
            <div className="border-b border-border px-4 py-2 text-sm font-medium text-muted-foreground">
              {t(`assetKind.${g.kind}`)} · <span className="font-mono">{g.items.length}</span>
            </div>
            <ul>
              {g.items.map((c) => (
                <CandidateRow
                  key={c.id}
                  candidate={c}
                  assets={assets}
                  assetsById={assetsById}
                  shotInfos={infosOf(c)}
                  busy={busyId === c.id}
                  onAccept={(variants) =>
                    accept.mutate({
                      params: { candidateId: c.id },
                      body: variants.length ? { createVariants: variants } : {},
                    })
                  }
                  onLink={(assetId, variants) =>
                    link.mutate({
                      params: { candidateId: c.id },
                      body: { assetId, ...(variants.length ? { createVariants: variants } : {}) },
                    })
                  }
                  onIgnore={() => ignore.mutate({ params: { candidateId: c.id } })}
                />
              ))}
            </ul>
          </section>
        ))}

        {handled.length > 0 && (
          <details className="group rounded-lg border border-border bg-surface">
            <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg px-4 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
              <strong className="font-medium">{t('candidates.handled.title')}</strong>
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {t('candidates.handled.sum', {
                  total: handled.length,
                  linked: handled.filter((c) => c.status === 'linked').length,
                  created: handled.filter((c) => c.status === 'accepted_new').length,
                  ignored: handled.filter((c) => c.status === 'ignored').length,
                })}
              </span>
              <ChevronDown
                {...iconProps}
                aria-hidden
                className="text-subtle transition-transform group-open:rotate-180"
              />
            </summary>
            <ul className="border-t border-border">
              {handled.map((c) => {
                const target = assetsById.get(c.linkedAssetId ?? c.createdAssetId ?? '')
                return (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3 first:border-t-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {c.name}{' '}
                        <span className="text-sm font-normal text-muted-foreground">
                          · {t(`assetKindSingular.${c.kind}`)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {c.status === 'linked'
                          ? t(
                              c.linkSource === 'auto'
                                ? 'candidates.handled.linkedAuto'
                                : 'candidates.handled.linkedTo',
                              { name: target?.name ?? '' },
                            )
                          : c.status === 'accepted_new'
                            ? t('candidates.handled.createdAs', { name: target?.name ?? c.name })
                            : t('candidates.handled.ignored')}
                      </p>
                    </div>
                    <Pill tone={c.status === 'ignored' ? 'neutral' : 'success'}>
                      {t(`candidates.status.${c.status}`)}
                    </Pill>
                    {c.status === 'linked' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === c.id}
                        onClick={() => undo.mutate({ params: { candidateId: c.id }, body: {} })}
                      >
                        <Undo2 {...iconProps} aria-hidden />
                        {t('candidates.undoLink')}
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </details>
        )}
      </div>
    </>
  )
}
