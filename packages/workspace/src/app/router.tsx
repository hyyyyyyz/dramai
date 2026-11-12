import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { AppShell } from '@/layout/AppShell'
import { ComingSoon } from '@/features/placeholders/ComingSoon'
import { ProjectsPage } from '@/features/projects/ProjectsPage'
import { AssetDetailPage } from '@/features/assets/AssetDetailPage'
import { AssetsPage } from '@/features/assets/AssetsPage'
import { CandidatesPage } from '@/features/candidates/CandidatesPage'
import { StoryboardPage } from '@/features/storyboard/StoryboardPage'
import { OverviewPage } from '@/features/overview/OverviewPage'
import { MaterialsPage } from '@/features/materials/MaterialsPage'
import { SettingsLayout } from '@/features/settings/SettingsLayout'
import { ProvidersPage } from '@/features/settings/ProvidersPage'
import { NotFoundPage } from '@/features/placeholders/NotFoundPage'

/**
 * 路由与导航（DESIGN 4.2）。已有页面：项目列表、概览、素材、资产库与详情、候选确认、分镜、设置 · 服务商。
 * 合成、导出和其余设置分区还没做：路由都在，页面显示“还在开发中”的空状态（ComingSoon）。
 */
export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/projects" replace /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/:projectId', element: <OverviewPage /> },
      { path: 'projects/:projectId/materials', element: <MaterialsPage /> },
      { path: 'projects/:projectId/assets', element: <AssetsPage /> },
      { path: 'projects/:projectId/assets/:assetId', element: <AssetDetailPage /> },
      { path: 'projects/:projectId/candidates', element: <CandidatesPage /> },
      {
        path: 'projects/:projectId/episodes/:episodeId/storyboard',
        element: <StoryboardPage />,
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
