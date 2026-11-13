import { useProviders, useSettings } from '@/data/queries'

/** True when the language-model provider in use is the ChatGPT sign-in channel and it is signed in. */
export function useUsingChatGptPlan(): boolean {
  const providers = useProviders()
  const settings = useSettings()
  const id = settings.data?.activeProviders.llm
  const p = providers.data?.items.find((x) => x.id === id)
  return (
    p?.auth.type === 'account_login' &&
    p.login?.state === 'signed_in' &&
    p.login.planUsage !== false
  )
}
