import { useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AspectRatio } from '@dramai/api'
import { Chip, Hint, Input, SegmentedControl, Skeleton, cn } from '@dramai/ui/v2'
import { useStyles } from '@/data/queries'
import type { StylePick } from './style-choice'

const RATIO_BOX: Record<AspectRatio, { w: number; h: number }> = {
  '9:16': { w: 9, h: 16 },
  '16:9': { w: 16, h: 9 },
  '1:1': { w: 12, h: 12 },
}

/** 画幅：项目唯一的画幅，生图、生视频、合成都按它来。 */
export function AspectRatioPicker({
  value,
  onChange,
  label,
}: {
  value: AspectRatio
  onChange: (v: AspectRatio) => void
  label: string
}) {
  const { t } = useTranslation()
  return (
    <SegmentedControl
      aria-label={label}
      value={value}
      onValueChange={onChange}
      options={(['9:16', '16:9', '1:1'] as const).map((r) => ({
        value: r,
        label: t(`aspect.${r}`),
        icon: (
          <span
            aria-hidden
            className="inline-block rounded-[1px] border border-current"
            style={{ width: RATIO_BOX[r].w, height: RATIO_BOX[r].h }}
          />
        ),
      }))}
    />
  )
}

export interface RadioCardOption<T extends string> {
  value: T
  title: ReactNode
  description?: ReactNode
}

/** 单选卡片：标题加一句说明（旁白怎么出声、风格来源）。radiogroup，方向键切换。 */
export function RadioCards<T extends string>({
  options,
  value,
  onChange,
  label,
  columns = 3,
}: {
  options: RadioCardOption<T>[]
  value: T
  onChange: (v: T) => void
  label: string
  columns?: 1 | 3
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const move = (i: number, dir: 1 | -1) => {
    const n = (i + dir + options.length) % options.length
    onChange(options[n]!.value)
    refs.current[n]?.focus()
  }
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'grid gap-2',
        columns === 3 ? 'grid-cols-3 max-[640px]:grid-cols-1' : 'grid-cols-1',
      )}
    >
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault()
                move(i, 1)
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault()
                move(i, -1)
              }
            }}
            className={cn(
              'flex flex-col gap-1 rounded-md border border-border-strong bg-sunken p-3 text-left',
              'transition-colors duration-(--duration-fast) ease-standard hover:border-foreground/40',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              on && 'border-accent bg-accent-soft',
            )}
          >
            <span className="font-medium">{o.title}</span>
            {o.description && (
              <span className="text-xs leading-normal text-muted-foreground">{o.description}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export type NarrationValue = 'tts' | 'post' | 'none'
export function NarrationPicker({
  value,
  onChange,
  label,
}: {
  value: NarrationValue
  onChange: (v: NarrationValue) => void
  label: string
}) {
  const { t } = useTranslation()
  return (
    <RadioCards
      label={label}
      value={value}
      onChange={onChange}
      options={(['tts', 'post', 'none'] as const).map((v) => ({
        value: v,
        title: t(`narration.${v}.title`),
        description: t(`narration.${v}.desc`),
      }))}
    />
  )
}

/** 风格：20 个预设分组做成单选芯片（可取消），另有自由描述。两者互斥，选了模板就清掉描述。 */
export function StylePicker({
  value,
  onChange,
}: {
  value: StylePick
  onChange: (v: StylePick) => void
}) {
  const { t } = useTranslation()
  const styles = useStyles()
  return (
    <div className="flex flex-col gap-3">
      {styles.isPending && <Skeleton className="h-24" />}
      {styles.data?.groups.map((g) => (
        <div key={g.id} className="flex flex-col gap-2">
          <div className="text-xs text-subtle">{g.label}</div>
          <div className="flex flex-wrap gap-2">
            {g.presets.map((p) => (
              <Chip
                key={p.id}
                pressed={value.templateId === p.id}
                title={p.description}
                onClick={() =>
                  onChange({ templateId: value.templateId === p.id ? undefined : p.id, custom: '' })
                }
              >
                {p.label}
              </Chip>
            ))}
          </div>
        </div>
      ))}
      <Input
        aria-label={t('style.customLabel')}
        placeholder={t('style.customPlaceholder')}
        value={value.custom}
        onChange={(e) => onChange({ templateId: undefined, custom: e.target.value })}
      />
      <Hint>{t('style.hint')}</Hint>
    </div>
  )
}
