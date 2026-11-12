import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'

// Async queries (`findBy…`, `waitFor`) return as soon as the condition holds, so a long limit costs nothing when
// things are fast; it only stops a slow CI machine from turning "not there yet" into a failure. The real fixes for
// slowness (preloading lazy routes, injectable timers) live where the slowness comes from.
configure({ asyncUtilTimeout: 5000 })

afterEach(() => cleanup())

// jsdom 没有 matchMedia：桌面宽度（不匹配任何 max-width 查询）
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}
