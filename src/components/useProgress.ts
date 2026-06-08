import { useAllEntries } from '../lib/storage/entries'
import { computeProgress, type ProgressReport } from '../lib/progress'
import { useActiveContext } from './ActiveContextProvider'
import { useDepthMode } from './DepthModeContext'

/** Live progress for the active context at the current depth mode. */
export function useProgress(): ProgressReport | null {
  const { ctx } = useActiveContext()
  const { mode } = useDepthMode()
  const entries = useAllEntries(ctx)
  if (!ctx || entries === undefined) return null
  return computeProgress(entries, ctx, mode)
}
