import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderPlus, Plus, Search } from 'lucide-react'
import {
  Button,
  EmptyState,
  Input,
  SegmentedControl,
  Skeleton,
  iconProps,
  iconPropsLg,
  useToast,
} from '@dramai/ui/v2'
import { Modal } from '@/components/overlay'
import { Link } from 'react-router'
import type { ProjectListItem } from '@dramai/api'
import { qk } from '@/data/keys'
import { useCall, useProjects } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import { PageHead } from '@/features/common/PageHead'
import { NewProjectDialog } from './NewProjectDialog'
import { ProjectCard } from './ProjectCard'
import { matchesFilter, type ProjectFilter } from './project-status'

export function ProjectsPage() {
  const { t } = useTranslation()
  const projects = useProjects()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ProjectFilter>('all')
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<ProjectListItem>()
  const { toast } = useToast()
  const remove = useCall('projects.delete', { invalidate: [qk.projects] })

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (projects.data?.items ?? [])
      .filter((p) => matchesFilter(p, filter) && (q === '' || p.name.toLowerCase().includes(q)))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [projects.data, query, filter])

  const total = projects.data?.items.length ?? 0
  return (
    <>
      <PageHead
        title={t('projects.title')}
        sub={t('projects.sub')}
        actions={
          <>
            <Link to="/settings/data">
              <Button variant="ghost" tabIndex={-1}>
                {t('projects.trashLink')}
              </Button>
            </Link>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus {...iconProps} aria-hidden />
              {t('projects.new.open')}
            </Button>
          </>
        }
      />

      {projects.isError && <ErrorNotice error={projects.error} className="mb-4" />}

      {total > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 basis-60 max-w-sm">
            <Search
              {...iconProps}
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle"
            />
            <Input
              type="search"
              className="pl-9"
              aria-label={t('projects.search')}
              placeholder={t('projects.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <SegmentedControl
            aria-label={t('projects.filter.label')}
            value={filter}
            onValueChange={setFilter}
            options={[
              { value: 'all', label: t('projects.filter.all') },
              { value: 'active', label: t('projects.filter.active') },
              { value: 'done', label: t('projects.filter.done') },
            ]}
          />
        </div>
      )}

      {projects.isPending && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4" aria-busy>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      )}

      {projects.isSuccess && total === 0 && (
        <EmptyState
          icon={<FolderPlus {...iconPropsLg} aria-hidden />}
          title={t('projects.empty.title')}
          description={t('projects.empty.body')}
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus {...iconProps} aria-hidden />
              {t('projects.new.open')}
            </Button>
          }
        />
      )}

      {total > 0 && shown.length === 0 && (
        <p className="py-12 text-center text-muted-foreground">{t('projects.noMatch')}</p>
      )}

      {shown.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {shown.map((p) => (
            <ProjectCard key={p.id} project={p} onDelete={setDeleting} />
          ))}
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong text-muted-foreground transition-colors duration-(--duration-fast) ease-standard hover:border-foreground/40 hover:text-foreground"
          >
            <Plus {...iconPropsLg} aria-hidden />
            {t('projects.new.open')}
          </button>
        </div>
      )}

      {creating && <NewProjectDialog open onClose={() => setCreating(false)} />}
      <Modal
        open={deleting !== undefined}
        onClose={() => setDeleting(undefined)}
        size="sm"
        title={t('projects.delete.title', { name: deleting?.name ?? '' })}
        closeLabel={t('common.close')}
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(undefined)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger-solid"
              loading={remove.isPending}
              onClick={() =>
                deleting &&
                remove.mutate(
                  { params: { projectId: deleting.id } },
                  {
                    onSuccess: () => {
                      toast({
                        tone: 'success',
                        title: t('projects.delete.done', { name: deleting.name }),
                      })
                      setDeleting(undefined)
                    },
                  },
                )
              }
            >
              {t('projects.delete.confirm')}
            </Button>
          </>
        }
      >
        <p>{t('projects.delete.body')}</p>
        {remove.isError && <ErrorNotice error={remove.error} className="mt-3" />}
      </Modal>
    </>
  )
}
