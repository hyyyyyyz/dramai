import { Link, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Hammer } from 'lucide-react'
import { Button, EmptyState, iconPropsLg } from '@dramai/ui/v2'
import { PageHead } from '@/features/common/PageHead'

export type ComingKey =
  | 'assets'
  | 'assetDetail'
  | 'candidates'
  | 'storyboard'
  | 'compose'
  | 'export'
  | 'settingsGeneral'
  | 'settingsAccess'
  | 'settingsData'
  | 'settingsAbout'

/** 路由和导航已经就位、页面还没做的地方：如实说明，并给一条回得去的路。 */
export function ComingSoon({ page, back }: { page: ComingKey; back?: 'overview' | 'providers' }) {
  const { t } = useTranslation()
  const { projectId } = useParams()
  const to =
    back === 'providers'
      ? '/settings/providers'
      : projectId
        ? `/projects/${projectId}`
        : '/projects'
  return (
    <>
      <PageHead title={t(`coming.${page}.title`)} sub={t(`coming.${page}.job`)} />
      <EmptyState
        icon={<Hammer {...iconPropsLg} aria-hidden />}
        title={t('coming.title')}
        description={t('coming.body')}
        action={
          <Link to={to}>
            <Button variant="secondary" tabIndex={-1}>
              {back === 'providers' ? t('coming.backProviders') : t('coming.backOverview')}
            </Button>
          </Link>
        }
      />
    </>
  )
}
