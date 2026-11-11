import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { AppShell } from '@/layout/AppShell'
import { ComingSoon } from '@/features/placeholders/ComingSoon'
import { ProjectsPage } from '@/features/projects/ProjectsPage'
import { OverviewPage } from '@/features/overview/OverviewPage'
import { MaterialsPage } from '@/features/materials/MaterialsPage'
import { SettingsLayout } from '@/features/settings/SettingsLayout'
import { ProvidersPage } from '@/features/settings/ProvidersPage'
import { NotFoundPage } from '@/features/placeholders/NotFoundPage'

/**
 * 路由与导航（DESIGN 4.2）。已有页面：项目列表、概览、素材、设置 · 服务商。
 * 其余路由都在，页面显示“下一阶段到达”的空状态（ComingSoon）。
 */
export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/projects" replace /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/:projectId', element: <OverviewPage /> },
      { path: 'projects/:projectId/materials', element: <MaterialsPage /> },
      { path: 'projects/:projectId/assets', element: <ComingSoon page="assets" /> },
      { path: 'projects/:projectId/assets/:assetId', element: <ComingSoon page="assetDetail" /> },
      { path: 'projects/:projectId/candidates', element: <ComingSoon page="candidates" /> },
      {
        path: 'projects/:projectId/episodes/:episodeId/storyboard',
        element: <ComingSoon page="storyboard" />,
      },
      {
        path: 'projects/:projectId/episodes/:episodeId/compose',
        element: <ComingSoon page="compose" />,
      },
      {
        path: 'projects/:projectId/episodes/:episodeId/export',
        element: <ComingSoon page="export" />,
      },
      {
        path: 'settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="providers" replace /> },
          { path: 'providers', element: <ProvidersPage /> },
          { path: 'general', element: <ComingSoon page="settingsGeneral" back="providers" /> },
          { path: 'access', element: <ComingSoon page="settingsAccess" back="providers" /> },
          { path: 'data', element: <ComingSoon page="settingsData" back="providers" /> },
          { path: 'about', element: <ComingSoon page="settingsAbout" back="providers" /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export const createAppRouter = () => createBrowserRouter(routes)
