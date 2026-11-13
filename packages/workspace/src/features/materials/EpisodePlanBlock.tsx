import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, MoreHorizontal, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { CallOutput, JobListItem } from '@dramai/api'
import {
  Button,
  Field,
  Hint,
  IconButton,
  Input,
  Menu,
  Notice,
  Pill,
  useToast,
  iconProps,
} from '@dramai/ui/v2'
import { Modal } from '@/components/overlay'
import { qk } from '@/data/keys'
import { useCall } from '@/data/queries'
import { PlanUsageNote } from '@/features/common/PlanUsageNote'
import { Block } from '@/features/common/PageHead'
import { ErrorNotice } from '@/features/common/error-text'
import { failureKind } from '@/features/jobs/job-model'
import { episodeStatusTone, sourceChapterRange } from '@/lib/episode'
import { useOnJobFinished, usePlanJob } from './use-plan-job'
import { StreamedText } from '@/features/jobs/StreamedText'

type EpisodeItem = CallOutput<'episodes.list'>['items'][number]
type MaterialItem = CallOutput<'materials.list'>['items'][number]

const DEFAULT_TARGET = 2500

export function EpisodePlanBlock({
  projectId,
  episodes,
  episodeOrder,
  materials,
}: {
  projectId: string
  episodes: EpisodeItem[]
  episodeOrder: string[]
  materials: MaterialItem[]
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const invalidate = [qk.episodes(projectId), qk.project(projectId), qk.projects, qk.jobs]
  const plan = useCall('episodes.plan', { invalidate })
  const reorder = useCall('episodes.reorder', { invalidate })
  const rename = useCall('episodes.update', { invalidate })
  const remove = useCall('episodes.delete', { invalidate })
  const create = useCall('episodes.create', { invalidate })
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [target, setTarget] = useState(String(DEFAULT_TARGET))
  const [requirement, setRequirement] = useState('')
  const [renaming, setRenaming] = useState<EpisodeItem>()
  const [renameValue, setRenameValue] = useState('')
  const [deleting, setDeleting] = useState<EpisodeItem>()

  const job = usePlanJob(projectId)
  const active = job && (job.status === 'queued' || job.status === 'running')
  const textMaterials = materials.filter((m) => m.kind !== 'image')

  const onFinished = useCallback(
    (j: JobListItem) => {
      if (j.status === 'succeeded') {
        const n = Number((j.result as { episodes?: number } | undefined)?.episodes ?? 0)
        toast({ tone: 'success', title: t('materials.plan.done', { count: n }) })
      }
    },
    [toast, t],
  )
  useOnJobFinished(job, onFinished)

  const order = [...episodes].sort((a, b) => {
    const ia = episodeOrder.indexOf(a.id)
    const ib = episodeOrder.indexOf(b.id)
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || a.number - b.number
  })

  const targetNum = Number(target)
  const targetValid = Number.isInteger(targetNum) && targetNum >= 300 && targetNum <= 20000
  const runPlan = () =>
    plan.mutate({
      params: { projectId },
      body: {
        ...(targetValid && targetNum !== DEFAULT_TARGET ? { targetChars: targetNum } : {}),
        ...(requirement.trim() ? { instructions: requirement.trim() } : {}),
      },
    })
  const move = (i: number, dir: -1 | 1) => {
    const ids = order.map((e) => e.id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    reorder.mutate({ params: { projectId }, body: { order: ids } })
  }

  const failed = job?.status === 'failed' && job.needsAttention
  return (
    <Block title={t('materials.plan.title')} aria-label={t('materials.plan.title')}>
      <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
        <Field className="w-56" label={t('materials.plan.targetChars')}>
          <Input
            type="number"
            inputMode="numeric"
            min={300}
            max={20000}
            step={100}
            value={target}
            invalid={!targetValid}
            onChange={(e) => setTarget(e.target.value)}
          />
        </Field>
        <Field
          className="min-w-60 flex-1"
          label={t('materials.plan.requirement')}
          hint={t('materials.plan.requirementHint')}
        >
          <Input
            maxLength={1000}
            value={requirement}
            placeholder={t('materials.plan.requirementPlaceholder')}
            onChange={(e) => setRequirement(e.target.value)}
          />
        </Field>
        <Button
          variant={order.length === 0 ? 'primary' : 'secondary'}
          disabled={textMaterials.length === 0 || active || !targetValid}
          loading={plan.isPending}
          onClick={runPlan}
        >
          <Sparkles {...iconProps} aria-hidden />
          {order.length === 0 ? t('materials.plan.run') : t('materials.plan.runMore')}
        </Button>
        <Button variant="ghost" onClick={() => setAdding(true)}>
          <Plus {...iconProps} aria-hidden />
          {t('materials.plan.addEpisode')}
        </Button>
        <PlanUsageNote className="basis-full" />
      </div>
      <div className="flex flex-col gap-3 p-4 empty:hidden">
        {textMaterials.length === 0 && (
          <Notice tone="info">{t('materials.plan.needMaterial')}</Notice>
        )}
        {plan.isError && <ErrorNotice error={plan.error} />}
        {reorder.isError && <ErrorNotice error={reorder.error} />}
        {active && (
          <StreamedText
            job={job}
            labels={{
              running: t('materials.plan.running'),
              queued: t('materials.plan.queued'),
              waiting: t('materials.plan.waitingText'),
              queuedHint: t('materials.plan.queuedHint'),
              streamLabel: t('materials.plan.streamLabel'),
            }}
          />
        )}
        {failed && (
          <Notice tone="danger" title={t('materials.plan.failed')}>
            {t(`jobs.failure.${failureKind(job)}`)}
            <span className="mt-1 block">{t('materials.plan.failedSee')}</span>
          </Notice>
        )}
      </div>

      {order.length === 0 && textMaterials.length > 0 && !active && (
        <p className="border-t border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {t('materials.plan.empty')}
        </p>
      )}

      {order.length > 0 && (
        <ul className="border-t border-border" aria-label={t('materials.plan.ledger')}>
          {order.map((e, i) => {
            const range = sourceChapterRange(e, materials)
            return (
              <li
                key={e.id}
                className="grid grid-cols-[auto_40px_minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 max-[640px]:grid-cols-[auto_32px_minmax(0,1fr)_auto]"
              >
                <span className="flex flex-col">
                  <IconButton
                    size="sm"
                    label={t('materials.plan.moveUp', { n: i + 1 })}
                    disabled={i === 0 || reorder.isPending}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp {...iconProps} size={14} aria-hidden />
                  </IconButton>
                  <IconButton
                    size="sm"
                    label={t('materials.plan.moveDown', { n: i + 1 })}
                    disabled={i === order.length - 1 || reorder.isPending}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown {...iconProps} size={14} aria-hidden />
                  </IconButton>
                </span>
                <span className="font-mono text-muted-foreground">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-display text-[15px] leading-snug font-bold">
                    {e.title}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {range
                      ? t('common.sourceChapters', { from: range.from, to: range.to })
                      : t('common.noSourceRange')}
                  </div>
                </div>
                <Pill
                  tone={episodeStatusTone(e.status)}
                  hollow={e.status === 'planned'}
                  className="max-[640px]:hidden"
                >
                  {t(`episodeStatus.${e.status}`)}
                </Pill>
                <Menu
                  aria-label={t('materials.plan.rowMenu', { n: i + 1 })}
                  trigger={
                    <IconButton label={t('materials.plan.rowMenu', { n: i + 1 })}>
                      <MoreHorizontal {...iconProps} aria-hidden />
                    </IconButton>
                  }
                  items={[
                    {
                      key: 'rename',
                      label: t('materials.plan.rename'),
                      icon: <Pencil {...iconProps} aria-hidden />,
                      onSelect: () => {
                        setRenaming(e)
                        setRenameValue(e.title)
                      },
                    },
                    'separator',
                    {
                      key: 'delete',
                      label: t('common.delete'),
                      icon: <Trash2 {...iconProps} aria-hidden />,
                      danger: true,
                      onSelect: () => setDeleting(e),
                    },
                  ]}
                />
              </li>
            )
          })}
        </ul>
      )}
      <div className="border-t border-border p-4">
        <Hint>{t('materials.plan.hint')}</Hint>
      </div>

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        size="sm"
        title={t('materials.plan.addEpisode')}
        closeLabel={t('common.close')}
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={create.isPending}
              onClick={async () => {
                try {
                  await create.mutateAsync({
                    params: { projectId },
                    body: newTitle.trim() ? { title: newTitle.trim() } : {},
                  })
                  setNewTitle('')
                  setAdding(false)
                } catch {
                  /* 显示在对话框里 */
                }
              }}
            >
              {t('materials.plan.addEpisodeSubmit')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label={t('materials.plan.episodeTitle')} hint={t('materials.plan.addEpisodeHint')}>
            <Input value={newTitle} maxLength={60} onChange={(e) => setNewTitle(e.target.value)} />
          </Field>
          {create.isError && <ErrorNotice error={create.error} />}
        </div>
      </Modal>

      <Modal
        open={renaming !== undefined}
        onClose={() => setRenaming(undefined)}
        size="sm"
        title={t('materials.plan.rename')}
        closeLabel={t('common.close')}
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(undefined)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={renameValue.trim() === ''}
              loading={rename.isPending}
              onClick={async () => {
                if (!renaming) return
                try {
                  await rename.mutateAsync({
                    params: { episodeId: renaming.id },
                    body: { title: renameValue.trim() },
                  })
                  setRenaming(undefined)
                } catch {
                  /* 显示在对话框里 */
                }
              }}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label={t('materials.plan.episodeTitle')}>
            <Input
              value={renameValue}
              maxLength={120}
              onChange={(e) => setRenameValue(e.target.value)}
            />
          </Field>
          {rename.isError && <ErrorNotice error={rename.error} />}
        </div>
      </Modal>

      <Modal
        open={deleting !== undefined}
        onClose={() => setDeleting(undefined)}
        size="sm"
        title={t('materials.plan.deleteTitle')}
        closeLabel={t('common.close')}
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(undefined)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger-solid"
              loading={remove.isPending}
              onClick={async () => {
                if (!deleting) return
                try {
                  await remove.mutateAsync({ params: { episodeId: deleting.id } })
                  setDeleting(undefined)
                } catch {
                  /* 显示在对话框里 */
                }
              }}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <p>{t('materials.plan.deleteBody', { title: deleting?.title ?? '' })}</p>
          {remove.isError && <ErrorNotice error={remove.error} />}
        </div>
      </Modal>
    </Block>
  )
}
