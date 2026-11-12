import { NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import { cn } from '@dramai/ui/v2'
import { useAssets, useCandidates } from '@/data/queries'

/** 资产页和候选页共用的两个标签：资产库 / 候选确认（候选数是朱砂色，因为它会阻塞镜头）。 */
export function AssetTabs({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const assets = useAssets(projectId)
  const candidates = useCandidates(projectId)
  const tab =
    'inline-flex h-10 items-center gap-2 border-b-2 border-transparent px-3 text-muted-foreground hover:text-foreground'
  return (
    <nav aria-label={t('assets.tabsLabel')} className="mb-4 flex gap-1 border-b border-border">
      <NavLink
        to={`/projects/${projectId}/assets`}
        end
        className={({ isActive }) =>
          cn(tab, '-mb-px', isActive && 'border-accent font-medium text-foreground')
        }
      >
        {t('assets.tabAssets')}
        <span className="font-mono text-xs text-subtle">{assets.data?.items.length ?? ''}</span>
      </NavLink>
      <NavLink
        to={`/projects/${projectId}/candidates`}
        className={({ isActive }) =>
          cn(tab, '-mb-px', isActive && 'border-accent font-medium text-foreground')
        }
      >
        {t('assets.tabCandidates')}
        <span className="font-mono text-xs text-accent-text">
          {candidates.data?.progress.pending || ''}
        </span>
      </NavLink>
    </nav>
  )
}
