import type { SVGProps } from 'react'

/** dramai 渐变 logo 的 React 版（与 public/favicon.svg 对应）。 */
export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" {...props}>
      <defs>
        <linearGradient id="dramaiBrandGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" />
          <stop offset="100%" stopColor="var(--color-accent-cyan)" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="var(--color-background-soft-2)" />
      <path
        d="M16 18h22a14 14 0 0 1 0 28H16Z"
        fill="none"
        stroke="url(#dramaiBrandGradient)"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <circle cx="44" cy="32" r="4" fill="var(--color-accent-cyan)" />
    </svg>
  )
}
