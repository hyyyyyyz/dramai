import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { Project } from '@dramai/api'
import { Button, Notice } from '@dramai/ui/v2'
import { useProviderCapability } from '@/data/queries'
import { voiceIssues } from './voice-issues'

/**
 * Shown the moment the speech provider is switched: a voice chosen for the old provider often does not exist on the
 * new one, and generation would be blocked later. Says which projects are affected and why, and goes straight to
 * where the voice is chosen.
 */
export function VoiceSwitchNotice({
  nextId,
  providerName,
  projects,
  onDismiss,
}: {
  nextId: string
  providerName: string
  projects: readonly Pick<Project, 'id' | 'name' | 'narrationDelivery' | 'narrationVoice'>[]
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  const next = useProviderCapability(nextId)
  if (!next.data) return null
  const issues = voiceIssues(projects, next.data)
  if (issues.length === 0) return null
  const blocking = issues.some((i) => i.kind === 'not_available' || i.kind === 'required')
  return (
    <Notice
      tone={blocking ? 'warn' : 'info'}
      title={t('providers.voiceSwitch.title', { name: providerName })}
      actions={
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          {t('providers.voiceSwitch.dismiss')}
        </Button>
      }
    >
      <ul className="flex flex-col gap-1" data-testid="voice-switch">
        {issues.map((i) => (
          <li key={i.project.id}>
            {t(`providers.voiceSwitch.${i.kind}`, {
              project: i.project.name,
              voice: i.voice ?? '',
            })}{' '}
            <Link
              to={`/projects/${i.project.id}?voice=1`}
              className="text-accent-text hover:underline"
            >
              {t('providers.voiceSwitch.go')}
            </Link>
          </li>
        ))}
      </ul>
    </Notice>
  )
}
