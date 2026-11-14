import { useMemo } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { RotateCcw } from 'lucide-react'
import type { ArtifactReport, Asset, JobListItem, Verdict } from '@dramai/api'
import { Button, Notice, iconPropsSm } from '@dramai/ui/v2'
import { jobActions, failureKind } from '@/features/jobs/job-model'
import { useJobOps } from '@/features/jobs/job-ops-context'
import { reasonAction, type ReasonAction } from './reasons'
import { versionNumber } from './version-model'
import { useReasonText } from './use-reason-text'

/** 已过期：写明上游哪一项变了。过期不等于不可用——仍然可用，不会自动重新生成。 */
export function StaleNotice({
  report,
  assets,
  regenerating,
  onRegenerate,
  onKeep,
}: {
  report: ArtifactReport
  assets: ReadonlyMap<string, Asset>
  regenerating?: boolean
  onRegenerate: () => void
  onKeep: () => void
}) {
  const { t } = useTranslation()
  const lines = useMemo(() => {
    const out: string[] = []
    for (const c of report.changes) {
      if (c.kind === 'input') {
        out.push(
          t('storyboard.stale.input', {
            field: t(`storyboard.stale.fields.${c.field}`, { defaultValue: c.field }),
          }),
        )
        continue
      }
      const [kind, rest] = c.key.split(':', 2)
      const [assetId, variantName] = (rest ?? '').split('/')
      const asset = assets.get(assetId ?? '')
      const name = asset
        ? variantName
          ? `${asset.name} / ${variantName}`
          : asset.name
        : (c.label ?? t('reasons.someAsset'))
      const slot = variantName
        ? asset?.variants.find((v) => v.name === variantName)?.sheet
        : asset?.sheet
      const from = slot ? versionNumber(slot, c.from?.versionId) : undefined
      const to = slot ? versionNumber(slot, c.to?.versionId) : undefined
      out.push(
        from && to
          ? t('storyboard.stale.upstream', { name, from, to })
          : t('storyboard.stale.upstreamNoVersions', { name }),
      )
      void kind
    }
    return out
  }, [report, assets, t])
  return (
    <Notice
      tone="warn"
      title={t('storyboard.stale.title')}
      actions={
        <>
          <Button size="sm" variant="secondary" loading={regenerating} onClick={onRegenerate}>
            {t('storyboard.stale.regenerate')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onKeep}>
            {t('storyboard.stale.keep')}
          </Button>
        </>
      }
    >
      {lines.length > 0 ? (
        lines.map((l) => <p key={l}>{l}</p>)
      ) : (
        <p>{t('storyboard.stale.generic')}</p>
      )}
      <p>{t('storyboard.stale.note')}</p>
    </Notice>
  )
}

/** 不能生成：逐条列出缺什么，每条带直达补齐位置的按钮。 */
export function BlockedNotice({
  projectId,
  verdict,
  assets,
  onAction,
}: {
  projectId: string
  verdict: Verdict
  assets: ReadonlyMap<string, Asset>
  onAction: (a: ReasonAction) => void
}) {
  const { t } = useTranslation()
  const text = useReasonText(assets)
  const items = verdict.reasons.map((r) => ({ r, action: reasonAction(r) }))
  return (
    <Notice tone="danger" title={t('storyboard.blocked.title', { count: verdict.reasons.length })}>
      <ul className="mt-1 flex flex-col gap-2">
        {items.map(({ r, action }, i) => (
          <li key={`${r.code}-${r.assetId ?? i}`} className="flex flex-col gap-1">
            <span>{text(r)}</span>
            {action && (
              <span className="flex flex-wrap gap-2">
                {action.kind === 'asset' ? (
                  <Link to={`/projects/${projectId}/assets/${action.assetId}`}>
                    <Button size="sm" variant="secondary" tabIndex={-1}>
                      {t('storyboard.blocked.goAsset', {
                        name: assets.get(action.assetId)?.name ?? t('reasons.someAsset'),
                      })}
                    </Button>
                  </Link>
                ) : action.kind === 'candidates' ? (
                  <Link to={`/projects/${projectId}/candidates`}>
                    <Button size="sm" variant="secondary" tabIndex={-1}>
                      {t('storyboard.blocked.goCandidates')}
                    </Button>
                  </Link>
                ) : action.kind === 'projectVoice' ? (
                  <Link to={`/projects/${projectId}?voice=1`}>
                    <Button size="sm" variant="secondary" tabIndex={-1}>
                      {t('storyboard.blocked.goVoice')}
                    </Button>
                  </Link>
                ) : action.kind === 'providers' ? (
                  <Link to="/settings/providers">
                    <Button size="sm" variant="secondary" tabIndex={-1}>
                      {t('storyboard.blocked.goProviders')}
                    </Button>
                  </Link>
                ) : (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => onAction(action)}>
                      {t(`storyboard.blocked.action.${action.kind}`)}
                    </Button>
                    {action.kind === 'prompts' && (
                      <Button size="sm" variant="ghost" onClick={() => onAction({ kind: 'edit' })}>
                        {t('storyboard.blocked.action.edit')}
                      </Button>
                    )}
                  </>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Notice>
  )
}

/** 失败：按失败分类写原因；操作与任务面板是同一套（恢复原任务优先，重新生成要单独确认可能再次计费）。 */
export function FailedNotice({ job }: { job: JobListItem }) {
  const { t } = useTranslation()
  const ops = useJobOps()
  const actions = jobActions(job)
  const kind = failureKind(job)
  const busy = ops.busyId === job.id
  return (
    <Notice
      tone="danger"
      title={t(`storyboard.failed.${job.operation === 'shot_image' ? 'image' : 'video'}`)}
      actions={
        <>
          {actions.resume && (
            <Button size="sm" variant="primary" disabled={busy} onClick={() => ops.resume(job)}>
              <RotateCcw {...iconPropsSm} aria-hidden />
              {t('jobs.actions.resume')}
            </Button>
          )}
          {actions.regenerate && (
            <Button
              size="sm"
              variant={actions.resume ? 'secondary' : 'primary'}
              disabled={busy}
              onClick={() => ops.regenerate(job)}
            >
              {actions.regenerate === 'recharge'
                ? t('jobs.actions.regenerateRecharge')
                : t('jobs.actions.regenerate')}
            </Button>
          )}
          {actions.acknowledge && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => ops.acknowledge(job)}>
              {kind === 'submission_unknown'
                ? t('jobs.actions.acknowledgeChecked')
                : t('jobs.actions.acknowledge')}
            </Button>
          )}
        </>
      }
    >
      <p>{t(`jobs.failure.${kind}`)}</p>
      {kind === 'submission_unknown' && <p>{t('jobs.failureUnknownNote')}</p>}
    </Notice>
  )
}
