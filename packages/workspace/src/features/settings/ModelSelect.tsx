import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Field, Input, Select } from '@dramai/ui/v2'

/** From this many choices on, a box above the list narrows it (a provider can answer with hundreds of models). */
const FILTER_FROM = 30

/**
 * Enter and this control. A drop-down never adds the provider (the form ignores a submit that comes from a select). The
 * box that “Type it in” turns it into does not either until the user has typed in it: an Enter right after switching
 * is not “Add”. Every other text box adds on Enter, as before.
 *
 * “Type it in” is a button next to the drop-down, not one of its options: the browser's type-ahead in a native list
 * jumps between options by their first letters, and it would otherwise land on it halfway through typing a model id.
 *
 * The model of a provider being added: a visible drop-down when there are choices (what the provider listed, or the
 * suggestions from the model data), a plain box when there are none. The choices are not a whitelist: "Type it in"
 * turns the drop-down into a box, and the link under the box goes back. Only the model id is shown, in the order it
 * came, with nothing marked. The browser's own `<select>` is the control (keyboard, screen readers, phones), the same
 * kind the provider card uses once it has a list.
 */
export function ModelSelect({
  value,
  onChange,
  options,
  hint,
}: {
  value: string
  onChange: (v: string) => void
  options: readonly string[]
  hint: string
}) {
  const { t } = useTranslation()
  const [manual, setManual] = useState(false)
  const [justSwitched, setJustSwitched] = useState(false)
  const [filter, setFilter] = useState('')
  const box = useRef<HTMLInputElement>(null)
  const focusBox = useRef(false)
  const hasOptions = options.length > 0
  useEffect(() => {
    if (manual && focusBox.current) {
      focusBox.current = false
      box.current?.focus()
    }
  }, [manual])

  if (!hasOptions || manual) {
    return (
      <Field label={t('providers.form.model')} required hint={hint}>
        <Input
          ref={box}
          mono
          autoComplete="off"
          value={value}
          onChange={(e) => {
            setJustSwitched(false)
            onChange(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && justSwitched) e.preventDefault()
          }}
        />
        {hasOptions && (
          <div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setManual(false)
                setJustSwitched(false)
                setFilter('')
              }}
            >
              {t('providers.add.model.backToList')}
            </Button>
          </div>
        )}
      </Field>
    )
  }

  const needle = filter.trim().toLowerCase()
  const shown =
    needle === '' ? options : options.filter((o) => o === value || o.toLowerCase().includes(needle))
  return (
    <Field label={t('providers.form.model')} required hint={hint}>
      {options.length > FILTER_FROM && (
        <Input
          id={`${'model-filter'}-${options.length}`}
          aria-label={t('providers.add.model.filter')}
          placeholder={t('providers.add.model.filter')}
          autoComplete="off"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      <Select mono value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('providers.add.model.placeholder')}</option>
        {value !== '' && !options.includes(value) && <option value={value}>{value}</option>}
        {shown.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
      <div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            focusBox.current = true
            setJustSwitched(true)
            setManual(true)
          }}
        >
          {t('providers.add.model.manual')}
        </Button>
      </div>
    </Field>
  )
}
