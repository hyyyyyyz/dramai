import { useTranslation } from 'react-i18next'
import { Heart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { GithubIcon } from '@/components/icons/GithubIcon'

export function AboutPage() {
  const { t } = useTranslation()
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('about.title')}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t('about.intro')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('about.thanksTitle')}</CardTitle>
          <CardDescription>{t('about.thanksDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            <li>
              <a
                href="https://github.com/xhongc/ai_story"
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium text-accent hover:underline"
              >
                xhongc/ai_story
              </a>
              <p className="text-sm text-muted">{t('about.thanksAi_storyDesc')}</p>
            </li>
            <li>
              <a
                href="https://github.com/freestylefly/director_ai"
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium text-accent hover:underline"
              >
                freestylefly/director_ai
              </a>
              <p className="text-sm text-muted">{t('about.thanksDirector_aiDesc')}</p>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Heart className="h-4 w-4 text-accent" />
            {t('about.joinTitle')}
          </CardTitle>
          <CardDescription>{t('about.joinDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <a href="https://github.com/hyyyyyyz/dramai" target="_blank" rel="noreferrer noopener">
            <Button variant="outline" className="gap-2">
              <GithubIcon className="h-4 w-4" /> {t('about.joinCta')}
            </Button>
          </a>
        </CardContent>
      </Card>
    </section>
  )
}
