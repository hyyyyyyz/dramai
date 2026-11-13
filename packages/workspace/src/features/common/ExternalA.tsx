import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { iconProps } from '@dramai/ui/v2'

/** A link that leaves the app (opens in a new tab, with the usual safety attributes). */
export function ExternalA({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-accent-text underline underline-offset-2"
    >
      {children}
      <ExternalLink {...iconProps} size={12} aria-hidden />
    </a>
  )
}
