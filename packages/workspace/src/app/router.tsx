import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { AppShell } from '@/layout/AppShell'
import { NotFoundPage } from '@/features/placeholders/NotFoundPage'
import { Booting } from './Booting'

/**
 * 路由与导航（DESIGN 4.2）。外壳和 404 随主包加载，每个页面按路由单独成块，进到才下载。
 * `lazy` 返回的组件在加载期间由外壳的 Suspense 兜底（见 AppShell）。
 */
const page = <T extends Record<string, unknown>>(
  load: () => Promise<T>,
  name: keyof T & string,
) => ({
  lazy: async () => ({ Component: (await load())[name] as React.ComponentType }),
})

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    HydrateFallback: Booting,
    children: [
      { index: true, element: <Navigate to="/projects" replace /> },
      {
        path: 'projects',
        ...page(() => import('@/features/projects/ProjectsPage'), 'ProjectsPage'),
      },
      {
        path: 'projects/:projectId',
        ...page(() => import('@/features/overview/OverviewPage'), 'OverviewPage'),
      },
      {
        path: 'projects/:projectId/materials',
        ...page(() => import('@/features/materials/MaterialsPage'), 'MaterialsPage'),
      },
      {
        path: 'projects/:projectId/assets',
        ...page(() => import('@/features/assets/AssetsPage'), 'AssetsPage'),
      },
      {
        path: 'projects/:projectId/assets/:assetId',
        ...page(() => import('@/features/assets/AssetDetailPage'), 'AssetDetailPage'),
      },
      {
        path: 'projects/:projectId/candidates',
        ...page(() => import('@/features/candidates/CandidatesPage'), 'CandidatesPage'),
      },
      {
        path: 'projects/:projectId/episodes/:episodeId/storyboard',
        ...page(() => import('@/features/storyboard/StoryboardPage'), 'StoryboardPage'),
      },
      {
        path: 'projects/:projectId/episodes/:episodeId/compose',
        ...page(() => import('@/features/compose/ComposePage'), 'ComposePage'),
      },
      {
        path: 'projects/:projectId/episodes/:episodeId/export',
        ...page(() => import('@/features/export/ExportPage'), 'ExportPage'),
      },
      {
        path: 'settings',
        ...page(() => import('@/features/settings/SettingsLayout'), 'SettingsLayout'),
        children: [
          { index: true, element: <Navigate to="providers" replace /> },
          {
            path: 'providers',
            ...page(() => import('@/features/settings/ProvidersPage'), 'ProvidersPage'),
          },
          {
            path: 'general',
            ...page(() => import('@/features/settings/GeneralPage'), 'GeneralPage'),
          },
          { path: 'access', ...page(() => import('@/features/settings/AccessPage'), 'AccessPage') },
          { path: 'data', ...page(() => import('@/features/settings/DataPage'), 'DataPage') },
          { path: 'about', ...page(() => import('@/features/settings/AboutPage'), 'AboutPage') },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export const createAppRouter = () => createBrowserRouter(routes)
