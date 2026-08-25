import type { ReactNode } from 'react'

/**
 * Minimal modal shell: fixed overlay, backdrop-click to close, scrollable card.
 * Extracted from the genre-bank confirmations so the jot picker shares one
 * modal behaviour instead of growing a second slightly-different one. On a
 * phone the centered card with max-h scroll already behaves acceptably as a
 * sheet, which is why there is no separate mobile variant.
 */
export function ModalDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className="relative max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
      >
        {children}
      </div>
    </div>
  )
}
