import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import type { Asset, Shot } from '@dramai/api'
import {
  Button,
  Field,
  Hint,
  IconButton,
  Input,
  Modal,
  Notice,
  Select,
  Textarea,
  iconProps,
} from '@dramai/ui/v2'
import { qk } from '@/data/keys'
import { useCall } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import { mentionsToNames, namesToMentions } from './mentions'

const CAMERA_SHOTS = ['ECU', 'CU', 'MCU', 'MS', 'MLS', 'LS', 'ELS'] as const
const ANGLES = ['eye_level', 'high', 'low', 'dutch', 'birds_eye', 'over_shoulder'] as const
const MOVEMENTS = [
  'static',
  'pan_left',
  'pan_right',
  'tilt_up',
  'tilt_down',
  'zoom_in',
  'zoom_out',
  'orbit_left',
  'orbit_right',
  'dolly_in',
  'dolly_out',
] as const

interface DialogueRow {
  /** 原来的台词行（保留说话人资产、情绪等没有在这里编辑的字段）。 */
  base?: Shot['dialogue'][number]
  speakerName: string
  text: string
}

/** 单镜编辑：场景描述、景别 / 角度 / 运镜、时长、台词与旁白、提示词。保存只改镜头本身，不花钱。 */
export function ShotEditDialog({
  shot,
  index,
  projectId,
  assets,
  onClose,
}: {
  shot: Shot
  index: number
  projectId: string
  assets: ReadonlyMap<string, Asset>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const update = useCall('shots.update', {
    invalidate: [['episode'], qk.preflight, qk.artifacts, qk.episodes(projectId)],
  })
  const [excerpt, setExcerpt] = useState(shot.scriptExcerpt)
  const [cameraShot, setCameraShot] = useState<string>(shot.cameraShot ?? '')
  const [angle, setAngle] = useState<string>(shot.angle ?? '')
  const [movement, setMovement] = useState<string>(shot.movement)
  const [duration, setDuration] = useState(String(shot.durationSec))
  const [narration, setNarration] = useState(shot.narration ?? '')
  const [rows, setRows] = useState<DialogueRow[]>(
    shot.dialogue.map((d) => ({ base: d, speakerName: d.speakerName ?? '', text: d.text })),
  )
  const [firstFrame, setFirstFrame] = useState(
    mentionsToNames(shot.prompts.firstFrame ?? '', assets),
  )
  const [videoPrompt, setVideoPrompt] = useState(mentionsToNames(shot.prompts.video ?? '', assets))

  const durationNum = Number(duration)
  const durationValid = Number.isFinite(durationNum) && durationNum >= 1 && durationNum <= 60
  const hasDialogue = rows.some((r) => r.text.trim())
  const both = hasDialogue && narration.trim() !== ''

  const save = async () => {
    if (!durationValid) return
    try {
      await update.mutateAsync({
        params: { shotId: shot.id },
        body: {
          scriptExcerpt: excerpt,
          cameraShot: (cameraShot || null) as Shot['cameraShot'] | null,
          angle: (angle || null) as Shot['angle'] | null,
          movement: movement as Shot['movement'],
          durationSec: durationNum,
          narration: narration.trim() || null,
          dialogue: rows
            .filter((r) => r.text.trim())
            .map((r) => ({
              ...(r.base ?? {}),
              speakerName: r.speakerName.trim() || undefined,
              text: r.text.trim(),
            })),
          prompts: {
            firstFrame: namesToMentions(firstFrame.trim(), assets) || null,
            video: namesToMentions(videoPrompt.trim(), assets) || null,
          },
        },
      })
      onClose()
    } catch {
      /* 错误显示在对话框里 */
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t('storyboard.edit.title', { n: index })}
      closeLabel={t('common.close')}
      dismissOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!durationValid}
            loading={update.isPending}
            onClick={save}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label={t('storyboard.edit.excerpt')}>
          <Textarea rows={3} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-4 max-[640px]:grid-cols-1">
          <Field label={t('storyboard.edit.cameraShot')}>
            <Select value={cameraShot} onChange={(e) => setCameraShot(e.target.value)}>
              <option value="">{t('storyboard.edit.unset')}</option>
              {CAMERA_SHOTS.map((v) => (
                <option key={v} value={v}>
                  {t(`camera.shot.${v}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('storyboard.edit.angle')}>
            <Select value={angle} onChange={(e) => setAngle(e.target.value)}>
              <option value="">{t('storyboard.edit.unset')}</option>
              {ANGLES.map((v) => (
                <option key={v} value={v}>
                  {t(`camera.angle.${v}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('storyboard.edit.movement')}>
            <Select value={movement} onChange={(e) => setMovement(e.target.value)}>
              {MOVEMENTS.map((v) => (
                <option key={v} value={v}>
                  {t(`camera.movement.${v}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('storyboard.edit.duration')}
            error={durationValid ? undefined : t('storyboard.edit.durationInvalid')}
          >
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">{t('storyboard.edit.dialogue')}</div>
          {rows.map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-[120px_minmax(0,1fr)_auto] items-center gap-2 max-[640px]:grid-cols-[minmax(0,1fr)_auto]"
            >
              <Input
                aria-label={t('storyboard.edit.speaker', { n: i + 1 })}
                placeholder={t('storyboard.edit.speakerPlaceholder')}
                value={r.speakerName}
                onChange={(e) =>
                  setRows(rows.map((x, j) => (j === i ? { ...x, speakerName: e.target.value } : x)))
                }
                className="max-[640px]:col-span-1"
              />
              <Input
                aria-label={t('storyboard.edit.line', { n: i + 1 })}
                placeholder={t('storyboard.edit.linePlaceholder')}
                value={r.text}
                onChange={(e) =>
                  setRows(rows.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                }
              />
              <IconButton
                label={t('storyboard.edit.removeLine', { n: i + 1 })}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                <X {...iconProps} aria-hidden />
              </IconButton>
            </div>
          ))}
          <div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRows([...rows, { speakerName: '', text: '' }])}
            >
              <Plus {...iconProps} aria-hidden />
              {t('storyboard.edit.addLine')}
            </Button>
          </div>
        </div>

        <Field label={t('storyboard.edit.narration')}>
          <Textarea rows={2} value={narration} onChange={(e) => setNarration(e.target.value)} />
        </Field>
        {both && <Notice tone="warn">{t('storyboard.edit.bothVoices')}</Notice>}

        <Field label={t('storyboard.edit.firstFrame')}>
          <Textarea
            mono
            rows={3}
            value={firstFrame}
            onChange={(e) => setFirstFrame(e.target.value)}
          />
        </Field>
        <Field label={t('storyboard.edit.videoPrompt')}>
          <Textarea
            mono
            rows={3}
            value={videoPrompt}
            onChange={(e) => setVideoPrompt(e.target.value)}
          />
        </Field>
        <Hint>{t('storyboard.edit.hint')}</Hint>
        {update.isError && <ErrorNotice error={update.error} />}
      </div>
    </Modal>
  )
}
