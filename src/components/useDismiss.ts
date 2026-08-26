import { useEffect, type RefObject } from 'react'

/**
 * Close an open popover on an outside click or Escape.
 *
 * `pointerdown`, not `click`: a tap that lands outside must close the panel
 * before the field it lands on takes focus, and click fires too late for that.
 * It is also the event a touch device delivers first, so a phone behaves like a
 * laptop rather than needing the panel tapped twice.
 *
 * The listener only exists while the panel is open. A permanently-attached
 * document listener that early-returns is the same cost every tap pays for a
 * menu nobody opened.
 */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onDismiss: () => void,
): void {
  useEffect(() => {
    if (!active) return

    const onPointerDown = (e: PointerEvent) => {
      const el = ref.current
      if (el && e.target instanceof Node && !el.contains(e.target)) onDismiss()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [ref, active, onDismiss])
}
