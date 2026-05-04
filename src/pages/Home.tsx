import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  FileText,
  Image as ImageIcon,
  ScrollText,
  Sparkles,
  Users,
  Wand2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const FEATURE_ICONS = [FileText, ScrollText, Users, ImageIcon] as const

export function HomePage() {
  const { t } = useTranslation()
  const features = FEATURE_ICONS.map((icon, i) => ({
    icon,
    title: t(`home.feature${i + 1}Title`),
    desc: t(`home.feature${i + 1}Desc`),
  }))
  const stages = t('home.pipelineStages', { returnObjects: true }) as string[]

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-16 px-4 py-12 sm:px-6 sm:py-20">
      <div className="flex flex-col items-start gap-6">
        <Badge variant="accent" className="gap-1.5">
          <Sparkles className="h-3 w-3" /> {t('home.tag')}
        </Badge>
        <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          {t('home.heroLineA')} <span className="text-gradient-brand">{t('home.heroStory')}</span>
          <br />
          {t('home.heroLineB')} <span className="text-gradient-brand">{t('home.heroDrama')}</span>。
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted">{t('home.intro')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/projects">
            <Button size="lg" className="gap-2">
              {t('home.ctaNew')}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link to="/settings">
            <Button size="lg" variant="outline">
              {t('home.ctaSettings')}
            </Button>
          </Link>
          <a href="https://github.com/hyyyyyyz/dramai" target="_blank" rel="noreferrer noopener">
            <Button size="lg" variant="ghost">
              {t('home.ctaStar')}
            </Button>
          </a>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((f) => (
          <Card key={f.title}>
            <CardHeader>
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/15 text-accent">
                <f.icon className="h-5 w-5" />
              </div>
              <CardTitle>{f.title}</CardTitle>
              <CardDescription>{f.desc}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <Badge variant="muted" className="self-start">
            Pipeline
          </Badge>
          <CardTitle className="text-lg">
            <Wand2 className="mr-2 inline h-4 w-4 text-accent" />
            {t('home.pipelineTitle')}
          </CardTitle>
          <CardDescription>{t('home.pipelineDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-wrap gap-3 text-sm">
            {stages.map((stage, idx) => (
              <li
                key={stage}
                className="flex items-center gap-2 rounded-md border border-border bg-background-soft-2 px-3 py-1.5"
              >
                <span className="text-xs text-muted">{String(idx + 1).padStart(2, '0')}</span>
                <span>{stage}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </section>
  )
}
