import { useTranslation } from 'react-i18next'
import type { VideoPlan } from '@dramai/api'
import { Notice, Switch } from '@dramai/ui/v2'
import { ifRefsOnOf, refsUnavailable } from './video-refs-model'

/**
 * The "use character sheets as references" switch for video, with one sentence on what it does and what it costs.
 * What the model will do with the first frame comes from the pre-flight result, so it is shown before anything is
 * confirmed. When no chosen shot's model takes references the switch is off and cannot be turned on, and the text says
 * what to do instead.
 */
export function VideoRefsControl({
  on,
  onChange,
  plans,
}: {
  on: boolean
  onChange: (on: boolean) => void
  /** The pre-flight `video` plan of each chosen shot (may still be loading). */
  plans: readonly (VideoPlan | undefined)[]
}) {
  const { t } = useTranslation()
  const unavailable = refsUnavailable(plans)
  const cases = ifRefsOnOf(plans)
  const id = 'video-refs-switch'
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm"
      data-testid="video-refs"
    >
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="font-medium">
          {t('video.refs.toggle')}
        </label>
        <Switch
          id={id}
          checked={on}
          // it cannot be turned on for a model that takes no references, but it can always be turned off
          disabled={unavailable && !on}
          onCheckedChange={onChange}
        />
      </div>
      <p className="text-muted-foreground">{t('video.refs.what')}</p>
      <ul className="flex flex-col gap-1 text-muted-foreground">
        {cases.map((c) => (
          <li key={c} className={c === 'not_available' ? 'text-danger' : undefined}>
            {t(`video.refs.ifOn.${c}`)}
          </li>
        ))}
      </ul>
      {on && <Notice tone="warn">{t('video.refs.stale')}</Notice>}
    </div>
  )
}
