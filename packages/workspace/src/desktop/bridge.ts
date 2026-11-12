import { useQuery } from '@tanstack/react-query'

/**
 * The native bridge the desktop app's preload script puts on the page (`window.dramaiDesktop`).
 * Declared here on purpose: the frontend never imports code from `apps/desktop`. Keep in step with
 * `apps/desktop/src/shared/bridge.ts` (the desktop README documents the contract).
 *
 * How the frontend decides it is running inside the desktop app: **the bridge object is the capability**.
 * Every native feature calls into it, so a feature is offered exactly when the bridge exists.
 * `GET /api/system` also reports `desktop`, but it describes the *server*, not this page:
 * - bridge present, flag false: still use the bridge (the page demonstrably runs inside the shell);
 * - bridge missing, flag true (for example the desktop app's server opened in a browser): offer nothing native,
 *   the browser behaviour is the fallback and nothing breaks.
 * So nothing here depends on the flag.
 */
export type DesktopLanguage = 'auto' | 'en' | 'zh-CN' | 'zh-TW'

export interface DesktopInfo {
  version: string
  platform: 'darwin' | 'win32' | 'linux'
  arch: string
  dataDir: string
  /** `os` = encrypted by the operating system; `plain` = no system key store, protected by file permissions. */
  secretStorage: 'os' | 'plain'
  language: 'en' | 'zh-CN' | 'zh-TW'
  languagePreference: DesktopLanguage
}

export interface DesktopBridge {
  getInfo(): Promise<DesktopInfo>
  selectFolder(options?: { title?: string; defaultPath?: string }): Promise<string | null>
  revealProjectFile(target: { projectId: string; path?: string }): Promise<boolean>
  notify(notification: { title: string; body?: string }): Promise<boolean>
  setLanguage(language: DesktopLanguage): Promise<boolean>
}

declare global {
  interface Window {
    dramaiDesktop?: DesktopBridge
  }
}

export const getBridge = (): DesktopBridge | undefined =>
  typeof window === 'undefined' ? undefined : window.dramaiDesktop

/** True when the page runs inside the desktop app. */
export const isDesktop = (): boolean => getBridge() !== undefined

/** A bridge call that can never throw into the UI: a failing or missing bridge is just "didn't happen". */
export async function callBridge<T>(
  run: (bridge: DesktopBridge) => Promise<T>,
  fallback: T,
): Promise<T> {
  const bridge = getBridge()
  if (!bridge) return fallback
  try {
    return await run(bridge)
  } catch {
    return fallback
  }
}

/** Keep the native menus and dialogs in the language the user just picked on the page. */
export const notifyDesktopLanguage = (language: Exclude<DesktopLanguage, 'auto'>) =>
  callBridge((b) => b.setLanguage(language), false)

/** Desktop facts (data folder, key storage); `undefined` in a browser. */
export function useDesktopInfo(): DesktopInfo | undefined {
  const bridge = getBridge()
  const { data } = useQuery({
    queryKey: ['desktop', 'info'],
    queryFn: () => callBridge((b) => b.getInfo(), undefined),
    enabled: bridge !== undefined,
    staleTime: Infinity,
  })
  return data
}
