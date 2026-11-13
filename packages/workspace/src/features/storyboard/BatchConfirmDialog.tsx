import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Asset, GenerateItem, Verdict } from '@dramai/api'
import { Button, Checkbox, Frame, Notice, Pill, Skeleton, useToast } from '@dramai/ui/v2'
import { Modal } from '@/components/overlay'
import { useApi } from '@/data/use-api'
import { qk } from '@/data/keys'
import {
  useCall,
  useProviderCapability,
  useProviders,
  usePreflight,
  useSettings,
} from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import { CapabilityValue } from '@/features/settings/CapabilityGrid'
import { CostBox } from './CostBox'
import { costHeadline } from './cost'
import { batchTargetId, type BatchCandidate, type BatchKind } from './batch-model'
import { visibleReasons } from './reasons'
import { useReasonText } from './use-reason-text'
import { VideoRefsControl } from './VideoRefsControl'
import { VIDEO_PLAN_WARNINGS, frameOutcome } from './video-refs-model'
import { useFormat } from '@/i18n/format'

/**
 * 生成前的确认（A2、A13）：批量是**整批通过或整批不跑**。
 * - 有镜头被拦下：整批不会运行，现在没有任何任务被创建、不会产生费用；逐镜头写原因，被整批拦下的指名是谁拦的；
 * - 全部可运行：模型、画幅、预估费用（币种分开，只是估算）、不会拦下但值得知道的警告；
 * - 依赖没验证过的能力：要用户明确确认才放行。
 * 单个镜头的生成也走这里（一行的批量），确认之前不会创建任务。
 */
export function BatchConfirmDialog({
  projectId,
  episodeNumber,
  aspect,
  kind,
  candidates,
  assets,
  onClose,
}: {
  projectId: string
  /** 镜头的批量才有（标题里写第几集）。 */
  episodeNumber?: number
  aspect: '9:16' | '16:9' | '1:1'
  kind: BatchKind
  candidates: BatchCandidate[]
  assets: ReadonlyMap<string, Asset>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const { toast } = useToast()
  const reasonText = useReasonText(assets, { video: kind === 'shot_video' })
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(candidates.map((c) => c.shotId)),
  )
  const [confirmUnverified, setConfirmUnverified] = useState(false)
  // reference images for video: off unless the user turns it on
  const [videoRefs, setVideoRefs] = useState(false)

  const chosen = useMemo(
    () => candidates.filter((c) => selected.has(c.shotId)),
    [candidates, selected],
  )
  const refsOn = kind === 'shot_video' && videoRefs
  const items: GenerateItem[] = useMemo(
    () => chosen.map((c) => ({ target: c.target, ...(refsOn ? { videoRefs: true } : {}) })),
    [chosen, refsOn],
  )
  const pre = usePreflight(projectId, items, { confirmUnverified })
  const submit = useCall('generate.submit', {
    invalidate: [qk.jobs, ['episode'], qk.preflight, qk.artifacts, qk.episodes(projectId)],
  })

  const settings = useSettings()
  const providers = useProviders()
  const providerKind = kind === 'shot_video' ? 'video' : kind === 'shot_audio' ? 'tts' : 'image'
  const provider = providers.data?.items.find(
    (p) => p.id === settings.data?.activeProviders[providerKind],
  )
  const cap = useProviderCapability(provider?.id ?? '', Boolean(provider))

  const verdictOf = (shotId: string) =>
    pre.data?.results.find((v) => v.targetId === batchTargetId(kind, shotId))
  const ok = pre.data?.ok === true && chosen.length > 0 && !pre.isPlaceholderData
  const blockers =
    pre.data?.results.filter((v) => v.status === 'blocked' || v.status === 'needs_confirmation') ??
    []
  const pendingUnverified =
    pre.data?.results.flatMap((v) => v.unverified.filter((u) => !u.confirmed)) ?? []
  const anyUnverified =
    (pre.data?.results.some((v) => v.unverified.length > 0) ?? false) || confirmUnverified
  // what a video shot does with its shot image and references is shown next to the shot, not in the general list
  const warnings = [
    ...new Map(
      (pre.data?.results ?? [])
        .flatMap((v) => v.warnings)
        .filter((w) => !(kind === 'shot_video' && VIDEO_PLAN_WARNINGS.includes(w.code)))
        .map((w) => [`${w.code}:${w.assetId ?? ''}`, w] as const),
    ).values(),
  ]
  const headline = pre.data ? costHeadline(pre.data.totals, fmt.money) : undefined

  /** “调整选择”：把没通过检查的镜头从这批里去掉，剩下的重新预检。 */
  const deselectBlockers = () =>
    setSelected((cur) => {
      const next = new Set(cur)
      for (const v of blockers) {
        const c = candidates.find((x) => batchTargetId(kind, x.shotId) === v.targetId)
        if (c) next.delete(c.shotId)
      }
      return next
    })

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const api = useApi()
  const send = async () => {
    try {
      const res = await submit.mutateAsync({
        params: { projectId },
        body: { items, ...(confirmUnverified ? { confirmUnverified: true } : {}) },
      })
      if (res.failed.length === 0 && res.blocked.length === 0) {
        toast({
          tone: 'success',
          title: t('storyboard.batch.queued', { count: res.succeeded.length }),
        })
        onClose()
      }
    } catch {
      /* 错误显示在对话框里 */
    }
  }
  const sendResult = submit.data
  const partial = sendResult && (sendResult.failed.length > 0 || sendResult.blocked.length > 0)

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t(
        kind === 'shot_image'
          ? 'storyboard.batch.titleImage'
          : kind === 'shot_video'
            ? 'storyboard.batch.titleVideo'
            : kind === 'shot_audio'
              ? 'storyboard.batch.titleAudio'
              : candidates[0]?.target.kind === 'asset_sheet' && candidates[0].target.editInstruction
                ? 'storyboard.batch.titleSheetEdit'
                : 'storyboard.batch.titleSheet',
        { n: episodeNumber ?? 0 },
      )}
      closeLabel={t('common.close')}
      dismissOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!ok || (pendingUnverified.length > 0 && !confirmUnverified)}
            loading={submit.isPending}
            onClick={send}
          >
            {headline
              ? t('storyboard.batch.confirmWithCost', { cost: headline })
              : t('storyboard.batch.confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {pre.isPending && <Skeleton className="h-16" />}
        {chosen.length === 0 && (
          <Notice tone="info">{t('storyboard.batch.nothingSelected')}</Notice>
        )}
        {pre.data && chosen.length > 0 && !pre.data.ok && (
          <Notice
            tone="danger"
            title={t('storyboard.batch.blockedTitle')}
            actions={
              <Button size="sm" variant="secondary" onClick={deselectBlockers}>
                {t('storyboard.batch.deselectBlocked')}
              </Button>
            }
          >
            {t('storyboard.batch.blockedBody', { total: chosen.length, bad: blockers.length })}
          </Notice>
        )}
        {pre.data?.ok && (
          <Notice tone="info">{t('storyboard.batch.okBody', { count: chosen.length })}</Notice>
        )}
        {pre.isError && <ErrorNotice error={pre.error} />}

        {kind === 'shot_video' && pre.data && (
          <VideoRefsControl
            on={videoRefs}
            onChange={setVideoRefs}
            plans={chosen.map((c) => verdictOf(c.shotId)?.video)}
          />
        )}

        <ul className="flex flex-col" aria-label={t('storyboard.batch.list')}>
          {[...candidates]
            .sort((a, b) => rank(verdictOf(a.shotId)?.status) - rank(verdictOf(b.shotId)?.status))
            .map((c) => {
              const v = verdictOf(c.shotId)
              const checked = selected.has(c.shotId)
              return (
                <li
                  key={c.shotId}
                  className="grid grid-cols-[auto_40px_minmax(0,1fr)_auto] items-start gap-3 border-t border-border py-3 first:border-t-0"
                >
                  <Checkbox
                    checked={checked}
                    onChange={() => toggle(c.shotId)}
                    aria-label={t('storyboard.batch.select', { name: c.label })}
                    className="mt-1"
                  />
                  <Frame
                    ratio={kind === 'asset_sheet' ? '9:16' : aspect}
                    src={c.thumb ? api.fileUrl(projectId, c.thumb) : undefined}
                  />
                  <div className="min-w-0 text-sm">
                    <h3 className="font-sans text-base font-medium">{c.label}</h3>
                    {c.note && <p className="text-sm text-muted-foreground">{c.note}</p>}
                    {checked && refsOn && v?.video && (
                      <VideoPlanLine video={v.video} blocked={v.status === 'blocked'} />
                    )}
                    {checked && v?.status === 'blocked' && (
                      <ul className="mt-1 flex flex-col gap-1 text-muted-foreground">
                        {visibleReasons(v.reasons).map((r, i) => (
                          <li key={`${r.code}-${i}`}>{reasonText(r)}</li>
                        ))}
                      </ul>
                    )}
                    {checked && v?.status === 'blocked_by_batch' && (
                      <p className="mt-1 text-muted-foreground">
                        {t('storyboard.batch.byBatch', {
                          who: (v.blockedBy ?? [])
                            .map((id) => {
                              const other = candidates.find(
                                (x) => batchTargetId(kind, x.shotId) === id,
                              )
                              return other ? other.label : id
                            })
                            .join(t('storyboard.batch.listSep')),
                        })}
                      </p>
                    )}
                    {checked && v?.status === 'needs_confirmation' && (
                      <p className="mt-1 text-muted-foreground">
                        {t('storyboard.batch.needsConfirm')}
                      </p>
                    )}
                  </div>
                  <div>
                    {!checked ? (
                      <Pill tone="neutral" hollow>
                        {t('storyboard.batch.skipped')}
                      </Pill>
                    ) : !v ? null : v.status === 'accepted' ? (
                      <Pill tone="success">{t('storyboard.batch.runnable')}</Pill>
                    ) : v.status === 'blocked' ? (
                      <Pill tone="danger">{t('storyboard.batch.blockedPill')}</Pill>
                    ) : v.status === 'needs_confirmation' ? (
                      <Pill tone="warn">{t('storyboard.batch.confirmPill')}</Pill>
                    ) : (
                      <Pill tone="neutral">{t('storyboard.batch.byBatchPill')}</Pill>
                    )}
                  </div>
                </li>
              )
            })}
        </ul>

        {pendingUnverified.length > 0 && (
          <Notice tone="warn" title={t('storyboard.batch.unverifiedTitle')}>
            <ul className="list-disc pl-4">
              {[...new Set(pendingUnverified.map((u) => u.key))].map((k) => (
                <li key={k}>
                  {t(`storyboard.batch.unverifiedKey.${unverifiedGroup(k)}`, { key: k })}
                </li>
              ))}
            </ul>
            <div className="mt-2">
              <Checkbox
                checked={confirmUnverified}
                onChange={(e) => setConfirmUnverified(e.target.checked)}
                label={t('storyboard.batch.unverifiedConfirm')}
              />
            </div>
          </Notice>
        )}
        {anyUnverified && pendingUnverified.length === 0 && confirmUnverified && (
          <Notice tone="info">{t('storyboard.batch.unverifiedAccepted')}</Notice>
        )}

        {provider && (
          <dl className="grid grid-cols-2 gap-2 text-sm max-[640px]:grid-cols-1">
            <Cap label={t('storyboard.batch.model')}>{provider.label}</Cap>
            {kind !== 'asset_sheet' && <Cap label={t('storyboard.batch.aspect')}>{aspect}</Cap>}
            {kind === 'shot_video' && cap.data && (
              <Cap label={t('storyboard.batch.nativeAudio')}>
                <CapabilityValue support={cap.data.capability.nativeAudio} />
              </Cap>
            )}
          </dl>
        )}
        {!provider && !settings.isPending && (
          <Notice tone="danger">{t('storyboard.batch.noProvider')}</Notice>
        )}

        {pre.data && chosen.length > 0 && <CostBox totals={pre.data.totals} />}

        {warnings.length > 0 && (
          <Notice tone="warn" title={t('storyboard.batch.warningsTitle')}>
            <ul className="list-disc pl-4">
              {warnings.map((w) => (
                <li key={`${w.code}:${w.assetId ?? ''}`}>{reasonText(w)}</li>
              ))}
            </ul>
          </Notice>
        )}

        {partial && sendResult && (
          <Notice tone="danger" title={t('storyboard.batch.partialTitle')}>
            {t('storyboard.batch.partialBody', {
              ok: sendResult.succeeded.length,
              bad: sendResult.failed.length + sendResult.blocked.length,
            })}
          </Notice>
        )}
        {submit.isError && <ErrorNotice error={submit.error} />}
      </div>
    </Modal>
  )
}

/** 被拦下的排在最前面，其次是需要确认的，被整批拦下的和能跑的在后面。 */
function rank(status: string | undefined): number {
  return status === 'blocked' ? 0 : status === 'needs_confirmation' ? 1 : 2
}

function Cap({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-background px-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  )
}

/** 未验证项的键（如 `mode:i2v`、`refImages`、`duration`）归成几类，文案按类写。 */
function unverifiedGroup(
  key: string,
):
  | 'mode'
  | 'refImages'
  | 'frames'
  | 'framesWithRefs'
  | 'duration'
  | 'resolution'
  | 'aspect'
  | 'other' {
  if (key.startsWith('mode:')) return 'mode'
  if (key === 'refImages') return 'refImages'
  if (key === 'firstFrame' || key === 'lastFrame') return 'frames'
  if (key === 'firstFrameWithRefs') return 'framesWithRefs'
  if (key === 'duration') return 'duration'
  if (key === 'resolution') return 'resolution'
  if (key === 'aspectRatio' || key === 'aspect') return 'aspect'
  return 'other'
}

/** One shot's reference-image plan: what happens to its shot image, how many references, how many were left out. */
function VideoPlanLine({
  video,
  blocked,
}: {
  video: NonNullable<Verdict['video']>
  blocked: boolean
}) {
  const { t } = useTranslation()
  if (video.ifRefsOn === 'not_available' || (blocked && video.refImages === 'unsupported'))
    return (
      <p className="mt-1 text-danger" data-testid="video-plan">
        {t('video.refs.shot.blocked')}
      </p>
    )
  return (
    <p className="mt-1 text-muted-foreground" data-testid="video-plan">
      {t(`video.refs.shot.${frameOutcome(video)}`)}
      {video.referenceCount > 0 && (
        <> · {t('video.refs.shot.count', { count: video.referenceCount })}</>
      )}
      {video.droppedReferences > 0 && (
        <> · {t('video.refs.shot.dropped', { count: video.droppedReferences })}</>
      )}
    </p>
  )
}
