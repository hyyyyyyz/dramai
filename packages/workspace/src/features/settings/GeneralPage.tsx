import { useTranslation } from 'react-i18next'
import { SegmentedControl, Skeleton, Hint } from '@dramai/ui/v2'
import { qk } from '@/data/keys'
import { useCall, useSettings } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import { Block } from '@/features/common/PageHead'
import { LOCALES, setLocale, type Locale } from '@/i18n'
import { useTheme } from '@/lib/theme'
import { ConversionBlock } from './ConversionBlock'

const NAMES: Record<Locale, string> = { 'zh-CN': '简体中文', 'zh-TW': '繁體中文', en: 'English' }

/** 设置 · 通用：语言、主题、成片字幕默认方式、费用折算。 */
export function GeneralPage() {
  const { t, i18n } = useTranslation()
  const [theme, setTheme] = useTheme()
  const settings = useSettings()
  const update = useCall('settings.update', { invalidate: [qk.settings] })

  if (settings.isError) return <ErrorNotice error={settings.error} />
  if (!settings.data) return <Skeleton className="h-40" aria-busy />
  const s = settings.data

  return (
    <div className="flex flex-col gap-6">
      <Block
        title={t('settings.general.language.title')}
        aria-label={t('settings.general.language.title')}
      >
        <div className="flex flex-col gap-2 p-4">
          <SegmentedControl
            aria-label={t('settings.general.language.title')}
            value={
              (LOCALES as readonly string[]).includes(i18n.language)
                ? (i18n.language as Locale)
                : 'en'
            }
            onValueChange={(l) => {
              void setLocale(l)
              update.mutate({ body: { ...s, locale: l } })
            }}
            options={LOCALES.map((l) => ({ value: l, label: NAMES[l] }))}
          />
          <Hint>{t('settings.general.language.hint')}</Hint>
        </div>
      </Block>

      <Block
        title={t('settings.general.theme.title')}
        aria-label={t('settings.general.theme.title')}
      >
        <div className="flex flex-col gap-2 p-4">
          <SegmentedControl
            aria-label={t('settings.general.theme.title')}
            value={theme}
            onValueChange={setTheme}
            options={[
              { value: 'dark', label: t('settings.general.theme.dark') },
              { value: 'light', label: t('settings.general.theme.light') },
            ]}
          />
          <Hint>{t('settings.general.theme.hint')}</Hint>
        </div>
      </Block>

      <Block
        title={t('settings.general.subtitles.title')}
        aria-label={t('settings.general.subtitles.title')}
      >
        <div className="flex flex-col gap-2 p-4">
          <SegmentedControl
            aria-label={t('settings.general.subtitles.title')}
            value={s.defaultSubtitles ?? 'soft'}
            onValueChange={(v) => update.mutate({ body: { ...s, defaultSubtitles: v } })}
            options={[
              { value: 'soft', label: t('compose.render.sub.soft') },
              { value: 'burn', label: t('compose.render.sub.burn') },
              { value: 'none', label: t('compose.render.sub.none') },
            ]}
          />
          <Hint>{t('settings.general.subtitles.hint')}</Hint>
        </div>
      </Block>

      <ConversionBlock
        key={JSON.stringify(s.cost.conversion ?? null)}
        conversion={s.cost.conversion}
        saving={update.isPending}
        onSave={(conversion) => update.mutate({ body: { ...s, cost: { ...s.cost, conversion } } })}
      />
      {update.isError && <ErrorNotice error={update.error} />}
    </div>
  )
}
