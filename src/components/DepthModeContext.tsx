import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { DepthMode } from '../schema/types'

interface DepthModeContextValue {
  mode: DepthMode
  setMode: (mode: DepthMode) => void
}

const DepthModeContext = createContext<DepthModeContextValue | null>(null)

const STORAGE_KEY = 'depthMode'

export function DepthModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<DepthMode>(() => {
    // Two modes now: Quick (minimal) and Standard (everything). Default Standard;
    // a saved legacy 'comprehensive' maps to Standard.
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved === 'quick' ? 'quick' : 'standard'
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode)
  }, [mode])

  return (
    <DepthModeContext.Provider value={{ mode, setMode: setModeState }}>
      {children}
    </DepthModeContext.Provider>
  )
}

export function useDepthMode(): DepthModeContextValue {
  const ctx = useContext(DepthModeContext)
  if (!ctx) throw new Error('useDepthMode must be used within a DepthModeProvider')
  return ctx
}
