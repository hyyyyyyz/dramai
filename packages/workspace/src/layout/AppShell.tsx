import { Outlet } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Drawer } from '@dramai/ui/v2'
import { JobOpsProvider } from '@/features/jobs/JobOpsProvider'
import { TaskPanel } from '@/features/jobs/TaskPanel'
import { useMedia } from '@/lib/use-media'
import { usePersistentFlag } from '@/lib/use-persistent-flag'
import { useState } from 'react'
import { DemoBanner } from './DemoBanner'
import { MobileTabBar } from './MobileTabBar'
import { ShellContext } from './shell-context'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

/**
 * 工作台外框：侧栏 240 + 内容 + 右侧任务面板 320（可收起）。
 * ≥1181 三栏；801–1180 任务面板变右侧抽屉；≤800 侧栏变底部标签栏、任务面板变底部抽屉。
 * 所有尺寸下都是“外框固定、只有 main 自己滚动”：演示横幅和顶栏永远在视野里，不会随页面滚走。
 */
export function AppShell() {
  const { t } = useTranslation()
  const drawerMode = useMedia('(max-width: 1180px)')
  const phone = useMedia('(max-width: 800px)')
  const [docked, setDocked] = usePersistentFlag('dramai.tasks.open', true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const open = drawerMode ? drawerOpen : docked
  const openTasks = () => (drawerMode ? setDrawerOpen(true) : setDocked(true))
  const toggle = () => (drawerMode ? setDrawerOpen(!drawerOpen) : setDocked(!docked))

  return (
    <JobOpsProvider>
      <ShellContext.Provider value={{ openTasks }}>
        <div className="flex h-dvh flex-col">
          <DemoBanner />
          <div
            className={`grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] max-[800px]:grid-cols-[minmax(0,1fr)] ${
              open && !drawerMode
                ? 'grid-cols-[240px_minmax(0,1fr)_320px]'
                : 'grid-cols-[240px_minmax(0,1fr)]'
            }`}
          >
            <Sidebar />
            <div className="flex min-h-0 min-w-0 flex-col">
              <Topbar tasksOpen={open} onToggleTasks={toggle} />
              <main className="min-h-0 flex-1 overflow-y-auto p-6 max-[800px]:p-4 max-[800px]:pb-20">
                <div className="@container mx-auto max-w-[1200px]">
                  <Outlet />
                </div>
              </main>
            </div>
            {open && !drawerMode && (
              <aside className="flex min-h-0 flex-col border-l border-border bg-surface">
                <TaskPanel onClose={() => setDocked(false)} />
              </aside>
            )}
          </div>
          <MobileTabBar />
          {drawerMode && (
            <Drawer
              open={drawerOpen}
              onClose={() => setDrawerOpen(false)}
              side={phone ? 'bottom' : 'right'}
              title={t('jobs.title')}
              closeLabel={t('common.close')}
            >
              <TaskPanel embedded />
            </Drawer>
          )}
        </div>
      </ShellContext.Provider>
    </JobOpsProvider>
  )
}
