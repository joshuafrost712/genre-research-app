/**
 * Deep-link highlighter. A feedback triage link opens the app at the base URL
 * carrying `?fbroute=<route>&fb=<nodeId>[&fbf=<field>][&fbt=<text>]`. This
 * component (mounted app-wide, in any mode) navigates to that route, scrolls the
 * commented spot into view, and briefly flashes it — so Josh sees a comment in
 * context instead of reconstructing the place in his head.
 *
 * Links target the always-served base URL + query (not a real sub-path) so they
 * work on GitHub Pages without a SPA 404 fallback: the app boots at the index,
 * then routes client-side. The fb params are stripped once acted on so a reload
 * doesn't re-trigger the flash.
 */
import { useEffect } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

const FLASH_MS = 2500
const STYLE_ID = 'fb-highlight-style'

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    @keyframes fbFlash {
      0%, 100% { background-color: transparent; box-shadow: 0 0 0 0 rgba(2,132,199,0); }
      15%      { background-color: rgba(2,132,199,0.18); box-shadow: 0 0 0 4px rgba(2,132,199,0.35); }
    }
    .fb-flash {
      animation: fbFlash ${FLASH_MS}ms ease-in-out;
      border-radius: 4px;
      scroll-margin: 120px;
    }
  `
  document.head.appendChild(style)
}

/** Find the element a comment points at: a tagged node (preferred) or text. */
function findTarget(nodeId: string | null, field: string | null, text: string | null): HTMLElement | null {
  if (nodeId) {
    if (field) {
      const withField = document.querySelector<HTMLElement>(
        `[data-dfb-node="${CSS.escape(nodeId)}"][data-dfb-field="${CSS.escape(field)}"]`,
      )
      if (withField) return withField
    }
    const byNode = document.querySelector<HTMLElement>(`[data-dfb-node="${CSS.escape(nodeId)}"]`)
    if (byNode) return byNode
  }
  if (text) {
    const scope = document.querySelector('main') ?? document.body
    const needle = text.trim().slice(0, 120)
    if (needle) {
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
      let node: Node | null
      while ((node = walker.nextNode())) {
        if ((node.textContent ?? '').includes(needle)) return node.parentElement
      }
    }
  }
  return null
}

export function FeedbackHighlight() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()

  const nodeId = params.get('fb')
  const field = params.get('fbf')
  const text = params.get('fbt')
  const route = params.get('fbroute')

  useEffect(() => {
    if (!nodeId && !text) return
    ensureStyle()

    // Not on the target route yet: go there, carrying the params so this effect
    // re-runs once the destination has mounted.
    if (route && location.pathname !== route) {
      navigate({ pathname: route, search: location.search }, { replace: true })
      return
    }

    const clear = () => {
      const next = new URLSearchParams(params)
      next.delete('fb')
      next.delete('fbf')
      next.delete('fbt')
      next.delete('fbroute')
      setParams(next, { replace: true })
    }

    let cancelled = false
    let tries = 0
    const tick = () => {
      if (cancelled) return
      const el = findTarget(nodeId, field, text)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('fb-flash')
        window.setTimeout(() => el.classList.remove('fb-flash'), FLASH_MS)
        clear()
        return
      }
      // Content may still be loading (async Dexie reads); poll briefly.
      if (tries++ < 30) window.setTimeout(tick, 100)
      else clear()
    }
    tick()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, field, text, route, location.pathname])

  return null
}
