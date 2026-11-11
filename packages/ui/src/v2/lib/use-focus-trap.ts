import { useEffect, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusables(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true',
  )
}

/**
 * 弹层的焦点行为：打开时把焦点移进去，Tab 在里面循环，Esc 关闭，关闭后焦点还给打开前的元素，
 * 打开期间锁定页面滚动。Modal 和 Drawer 共用。
 */
export function useOverlayBehavior(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return
    const root = ref.current
    if (!root) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const first = root.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(root)[0] ?? root
    first.focus({ preventScroll: true })

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables(root)
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const head = items[0]
      const tail = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === head || !root.contains(active))) {
        e.preventDefault()
        tail.focus()
      } else if (!e.shiftKey && (active === tail || !root.contains(active))) {
        e.preventDefault()
        head.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = prevOverflow
      previous?.focus({ preventScroll: true })
    }
  }, [open, ref, onClose])
}
