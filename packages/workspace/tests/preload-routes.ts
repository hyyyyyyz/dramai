import type { RouteObject } from 'react-router'
import { routes } from '@/app/router'

/**
 * Pages are route-level lazy chunks (`lazy: () => import(...)`). The first navigation to a page therefore pays for a
 * dynamic import, and in a test that cost lands inside the first `findBy…` / `waitFor` window: cold module loading
 * can take well over a second on a slow runner (Windows CI), which is how the app tests became flaky.
 * Tests that render the whole app call this once in `beforeAll`, so loading happens before any assertion's clock
 * starts. It walks the real route table, so a new lazy page is covered without touching this file.
 */
export async function preloadRoutes(list: RouteObject[] = routes): Promise<void> {
  await Promise.all(
    list.map(async (r) => {
      const lazy = r.lazy
      if (typeof lazy === 'function') await lazy()
      else if (lazy) await Promise.all(Object.values(lazy).map((load) => load?.()))
      if (r.children) await preloadRoutes(r.children)
    }),
  )
}
