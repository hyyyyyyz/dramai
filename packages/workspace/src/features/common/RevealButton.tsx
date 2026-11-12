import { useTranslation } from 'react-i18next'
import { FolderOpen } from 'lucide-react'
import { Button, iconProps, useToast } from '@dramai/ui/v2'
import { callBridge, isDesktop } from '@/desktop/bridge'

/**
 * "Show in folder" for a project file (or the project folder when there is no path). Only exists inside the desktop
 * app: a browser cannot open the file manager, so there the button is simply not rendered.
 */
export function RevealButton({ projectId, path }: { projectId: string; path?: string }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  if (!isDesktop()) return null
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        const ok = await callBridge((b) => b.revealProjectFile({ projectId, path }), false)
        if (!ok) toast({ tone: 'info', title: t('desktop.revealMissing') })
      }}
    >
      <FolderOpen {...iconProps} size={14} aria-hidden />
      {t('desktop.reveal')}
    </Button>
  )
}
