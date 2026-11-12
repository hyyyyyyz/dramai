import { useLayoutEffect, useState, type RefObject } from 'react'

export type Placement = 'top' | 'bottom' | 'top-start' | 'bottom-start' | 'top-end' | 'bottom-end'

export interface AnchoredPosition {
  top: number
  left: number
  placement: Placement
  /** 触发元素的宽度，用于让浮层至少一样宽。 */
  anchorWidth: number
  ready: boolean
}

const GAP = 6
const MARGIN = 8

/**
 * 把浮层定位到触发元素旁边（position: fixed，配合 portal 使用）。
 * 空间不够时上下翻转，左右夹在视口内。滚动与缩放时重新计算。
 */
export function useAnchored(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  floating: RefObject<HTMLElement | null>,
  placement: Placement = 'bottom-start',
): AnchoredPosition {
  const [pos, setPos] = useState<AnchoredPosition>({
    top: 0,
    left: 0,
    placement,
    anchorWidth: 0,
    ready: false,
  })

  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const a = anchor.current?.getBoundingClientRect()
      const f = floating.current?.getBoundingClientRect()
      if (!a || !f) return
      const vw = document.documentElement.clientWidth
      const vh = document.documentElement.clientHeight

      let side: 'top' | 'bottom' = placement.startsWith('top') ? 'top' : 'bottom'
      const spaceBelow = vh - a.bottom - GAP - MARGIN
      const spaceAbove = a.top - GAP - MARGIN
      if (side === 'bottom' && f.height > spaceBelow && spaceAbove > spaceBelow) side = 'top'
      else if (side === 'top' && f.height > spaceAbove && spaceBelow > spaceAbove) side = 'bottom'

      const align = placement.endsWith('start')
        ? 'start'
        : placement.endsWith('end')
          ? 'end'
          : 'center'
      let left =
        align === 'start'
          ? a.left
          : align === 'end'
            ? a.right - f.width
            : a.left + a.width / 2 - f.width / 2
      left = Math.max(MARGIN, Math.min(left, vw - f.width - MARGIN))
      const top = side === 'bottom' ? a.bottom + GAP : a.top - GAP - f.height

      setPos({
        top,
        left,
        placement: (align === 'center' ? side : `${side}-${align}`) as Placement,
        anchorWidth: a.width,
        ready: true,
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, anchor, floating, placement])

  return pos
}
