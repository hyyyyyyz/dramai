import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import type { Asset, ArtifactReport } from '@dramai/api'
import {
  Button,
  Field,
  IconButton,
  Input,
  Modal,
  Pill,
  Select,
  Textarea,
  iconProps,
} from '@dramai/ui/v2'
import { qk } from '@/data/keys'
import { useCall, useProjectArtifacts } from '@/data/queries'
import { useApi } from '@/data/use-api'
import { Block } from '@/features/common/PageHead'
import { RadioCards } from '@/features/projects/pickers'
import { ErrorNotice } from '@/features/common/error-text'
import { BatchConfirmDialog } from '@/features/storyboard/BatchConfirmDialog'
import { versionNumber } from '@/features/storyboard/version-model'
import { sheetPath } from './asset-model'

/**
 * 衍生形态：换装、变身。由本体设定图编辑生成的会随本体变化而**过期**（不自动重做）；
 * 你上传的成品不随本体失效。
 */
export function VariantsBlock({
  projectId,
  asset,
  costumes,
  aspect,
}: {
  projectId: string
  asset: Asset
  costumes: Asset[]
  aspect: '9:16' | '16:9' | '1:1'
}) {
  const { t } = useTranslation()
  const api = useApi()
  const artifacts = useProjectArtifacts(projectId)
  const invalidate = [
    qk.asset(asset.id),
    qk.assets(projectId),
    qk.preflight,
    qk.artifacts,
    qk.episodes(projectId),
  ]
  const upload = useCall('assets.uploadSheet', { invalidate })
  const remove = useCall('variants.delete', { invalidate })
  const [creating, setCreating] = useState(false)
  const [generating, setGenerating] = useState<string>()
  const [deleting, setDeleting] = useState<string>()
  const reports = useMemo(
    () => new Map<string, ArtifactReport>((artifacts.data?.items ?? []).map((r) => [r.key, r])),
    [artifacts.data],
  )
  const file = useRef<HTMLInputElement>(null)
  const [replacing, setReplacing] = useState<string>()
  const baseNo = versionNumber(asset.sheet, asset.sheet.currentVersionId)

  const gen = asset.variants.find((v) => v.name === generating)
  return (
    <Block
      title={t('assets.variants.title')}
      aria-label={t('assets.variants.title')}
      aside={
        <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
          <Plus {...iconProps} aria-hidden />
          {t('assets.variants.new')}
        </Button>
      }
    >
      {asset.variants.length === 0 && (
        <p className="p-4 text-sm text-muted-foreground">{t('assets.variants.empty')}</p>
      )}
      <ul>
        {asset.variants.map((v) => {
          const report = reports.get(`variant_sheet:${asset.id}/${v.name}`)
          const stale = v.origin === 'edit' && report?.status === 'stale'
          const path = sheetPath(v.sheet)
          const costume = v.costumeAssetId
            ? costumes.find((c) => c.id === v.costumeAssetId)
            : undefined
          return (
            <li
              key={v.name}
              className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 border-t border-border p-4 first:border-t-0 max-[640px]:grid-cols-[72px_minmax(0,1fr)]"
            >
              {path ? (
                <img
                  src={api.fileUrl(projectId, path)}
                  alt={t('assets.variants.alt', { name: v.name })}
                  loading="lazy"
                  className="aspect-[3/4] w-full rounded-sm bg-sunken object-cover"
                />
              ) : (
                <div className="grid aspect-[3/4] w-full place-items-center rounded-sm border border-dashed border-border-strong text-xs text-subtle">
                  {t('assets.variants.noSheet')}
                </div>
              )}
              <div className="min-w-0">
                <h3 className="flex flex-wrap items-center gap-2 font-sans text-base font-medium">
                  {v.name}
                  {stale && <Pill tone="warn">{t('storyboard.state.stale')}</Pill>}
                  <Pill tone="neutral" dot={false}>
                    {t(`assets.variants.origin.${v.origin}`)}
                  </Pill>
                </h3>
                <p className="text-sm text-muted-foreground">
                  {v.description}
                  {costume && (
                    <span> · {t('assets.variants.costume', { name: costume.name })}</span>
                  )}
                </p>
                <p className="mt-1 text-xs text-subtle">
                  {v.origin === 'upload'
                    ? t('assets.variants.uploadNote')
                    : stale
                      ? t('assets.variants.staleNote', { n: baseNo ?? '' })
                      : t('assets.variants.editNote')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 max-[640px]:col-span-2">
                {v.origin === 'edit' ? (
                  <Button
                    size="sm"
                    variant={stale || !path ? 'secondary' : 'ghost'}
                    onClick={() => setGenerating(v.name)}
                    disabled={!asset.sheet.currentVersionId}
                  >
                    {path
                      ? t('assets.variants.regenerate', { n: baseNo ?? '' })
                      : t('assets.variants.generate')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={upload.isPending && replacing === v.name}
                    onClick={() => {
                      setReplacing(v.name)
                      file.current?.click()
                    }}
                  >
                    {path ? t('assets.variants.replace') : t('assets.variants.uploadNow')}
                  </Button>
                )}
                <IconButton
                  label={t('assets.variants.delete', { name: v.name })}
                  onClick={() => setDeleting(v.name)}
                >
                  <Trash2 {...iconProps} aria-hidden />
                </IconButton>
              </div>
            </li>
          )
        })}
      </ul>
      <input
        ref={file}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f || !replacing) return
          const form = new FormData()
          form.append('file', f)
          form.append('variantName', replacing)
          upload.mutate({ params: { assetId: asset.id }, form })
        }}
      />
      {(upload.isError || remove.isError) && (
        <div className="p-4 pt-0">
          <ErrorNotice error={upload.error ?? remove.error} />
        </div>
      )}

      {creating && (
        <NewVariantDialog
          projectId={projectId}
          asset={asset}
          costumes={costumes}
          onClose={() => setCreating(false)}
        />
      )}
      {gen && (
        <BatchConfirmDialog
          projectId={projectId}
          aspect={aspect}
          kind="asset_sheet"
          candidates={[
            {
              shotId: `${asset.id}/${gen.name}`,
              label: `${asset.name} / ${gen.name}`,
              thumb: sheetPath(gen.sheet),
              target: { kind: 'asset_sheet', assetId: asset.id, variantName: gen.name },
            },
          ]}
          assets={new Map([[asset.id, asset]])}
          onClose={() => setGenerating(undefined)}
        />
      )}
      <Modal
        open={deleting !== undefined}
        onClose={() => setDeleting(undefined)}
        size="sm"
        title={t('assets.variants.deleteTitle', { name: deleting ?? '' })}
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
                  await remove.mutateAsync({ params: { assetId: asset.id, variantName: deleting } })
                } catch {
                  /* 显示在列表下面（被镜头引用时按错误码说明） */
                }
                setDeleting(undefined)
              }}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t('assets.variants.deleteBody')}</p>
      </Modal>
    </Block>
  )
}

function NewVariantDialog({
  projectId,
  asset,
  costumes,
  onClose,
}: {
  projectId: string
  asset: Asset
  costumes: Asset[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const create = useCall('variants.create', {
    invalidate: [qk.asset(asset.id), qk.assets(projectId), qk.preflight],
  })
  const upload = useCall('assets.uploadSheet', {
    invalidate: [qk.asset(asset.id), qk.assets(projectId), qk.preflight],
  })
  const [mode, setMode] = useState<'edit' | 'upload'>('edit')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instruction, setInstruction] = useState('')
  const [costume, setCostume] = useState('')
  const [fileObj, setFileObj] = useState<File>()
  const [submitted, setSubmitted] = useState(false)
  const nameBad = submitted && name.trim() === ''
  const instructionBad = submitted && mode === 'edit' && instruction.trim() === ''
  const fileBad = submitted && mode === 'upload' && !fileObj

  const submit = async () => {
    setSubmitted(true)
    if (
      name.trim() === '' ||
      (mode === 'edit' && instruction.trim() === '') ||
      (mode === 'upload' && !fileObj)
    )
      return
    try {
      await create.mutateAsync({
        params: { assetId: asset.id },
        body: {
          name: name.trim(),
          description: description.trim(),
          ...(costume ? { costumeAssetId: costume } : {}),
          ...(mode === 'edit' ? { editInstruction: instruction.trim() } : {}),
        },
      })
      if (mode === 'upload' && fileObj) {
        const form = new FormData()
        form.append('file', fileObj)
        form.append('variantName', name.trim())
        await upload.mutateAsync({ params: { assetId: asset.id }, form })
      }
      onClose()
    } catch {
      /* 显示在对话框里 */
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={t('assets.variants.newTitle')}
      closeLabel={t('common.close')}
      dismissOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={create.isPending || upload.isPending} onClick={submit}>
            {t('assets.variants.create')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <RadioCards
          label={t('assets.variants.modeLabel')}
          value={mode}
          onChange={setMode}
          options={[
            {
              value: 'edit',
              title: t('assets.variants.mode.edit.title'),
              description: t('assets.variants.mode.edit.desc'),
            },
            {
              value: 'upload',
              title: t('assets.variants.mode.upload.title'),
              description: t('assets.variants.mode.upload.desc'),
            },
          ]}
        />
        <Field
          label={t('assets.variants.name')}
          error={nameBad ? t('assets.new.nameRequired') : undefined}
          required
        >
          <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={t('assets.variants.description')}>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {mode === 'edit' ? (
          <Field
            label={t('assets.variants.instruction')}
            hint={t('assets.variants.instructionHint')}
            error={instructionBad ? t('assets.variants.instructionRequired') : undefined}
            required
          >
            <Textarea
              rows={2}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
          </Field>
        ) : (
          <Field
            label={t('assets.variants.file')}
            error={fileBad ? t('assets.variants.fileRequired') : undefined}
            required
          >
            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setFileObj(e.target.files?.[0])}
            />
          </Field>
        )}
        {costumes.length > 0 && (
          <Field label={t('assets.variants.costumeLabel')} hint={t('assets.variants.costumeHint')}>
            <Select value={costume} onChange={(e) => setCostume(e.target.value)}>
              <option value="">{t('assets.variants.noCostume')}</option>
              {costumes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {(create.isError || upload.isError) && <ErrorNotice error={create.error ?? upload.error} />}
      </div>
    </Modal>
  )
}
