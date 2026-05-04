import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { HomePage } from '@/pages/Home'
import { ProjectsPage } from '@/pages/Projects'
import { ProjectDetailPage } from '@/pages/ProjectDetail'
import { CharactersPage } from '@/pages/Characters'
import { SettingsPage } from '@/pages/Settings'
import { AboutPage } from '@/pages/About'
import { NotFoundPage } from '@/pages/NotFound'

// Vite 注入的 BASE_URL 等于 vite.config.ts 的 base，
// 与 GitHub Pages 子路径保持一致。
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppLayout />,
      errorElement: <NotFoundPage />,
      children: [
        { index: true, element: <HomePage /> },
        { path: 'projects', element: <ProjectsPage /> },
        { path: 'projects/:projectId', element: <ProjectDetailPage /> },
        {
          path: 'projects/:projectId/characters',
          element: <CharactersPage />,
        },
        { path: 'settings', element: <SettingsPage /> },
        { path: 'about', element: <AboutPage /> },
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ],
  { basename },
)
