import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@dramai/ui/v2'
import { Block } from '@/features/common/PageHead'
import type { ShotInfo } from '@/features/common/use-shot-index'

/** 被这些镜头引用：按集列出镜头号，可跳转。 */
export function UsedByBlock({
  projectId,
  shotIds,
  shots,
}: {
  projectId: string
  shotIds: readonly string[]
  shots: ReadonlyMap<string, ShotInfo>
}) {
  const { t } = useTranslation()
  const byEpisode = new Map<string, { info: ShotInfo; nos: number[] }>()
  for (const id of shotIds) {
    const s = shots.get(id)
    if (!s) continue
    const e = byEpisode.get(s.episodeId) ?? { info: s, nos: [] }
    e.nos.push(s.index)
    byEpisode.set(s.episodeId, e)
  }
  const groups = [...byEpisode.values()].sort((a, b) => a.info.episodeNumber - b.info.episodeNumber)
  return (
    <Block
      title={t('assets.usage.title')}
      aside={<span className="font-mono">{shotIds.length}</span>}
      aria-label={t('assets.usage.title')}
    >
      {groups.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{t('assets.unused')}</p>
      ) : (
        <ul className="flex flex-col gap-3 p-4">
          {groups.map(({ info, nos }) => (
            <li key={info.episodeId} className="flex flex-col gap-1 text-sm">
              <span>
                {t('common.episodeTitle', { n: info.episodeNumber, title: info.episodeTitle })}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-muted-foreground">
                  {t('assets.usage.shots', {
                    list: nos
                      .sort((a, b) => a - b)
                      .map((n) => String(n).padStart(2, '0'))
                      .join(' '),
                  })}
                </span>
                <Link to={`/projects/${projectId}/episodes/${info.episodeId}/storyboard`}>
                  <Button size="sm" variant="ghost" tabIndex={-1}>
                    {t('assets.usage.open', { n: info.episodeNumber })}
                  </Button>
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Block>
  )
}
