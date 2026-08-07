/**
 * The marker that separates "your session went missing" from "you have never
 * signed in".
 *
 * This is the whole basis of the signed-out notice, and both of its failure modes
 * are bad in opposite directions: forget to write it and a person whose session
 * was silently dropped is never told, which is the 2026-08-07 bug; forget to
 * clear it on a deliberate sign-out and everyone who signs out gets warned they
 * were signed out, which teaches people to dismiss the warning unread.
 *
 * Runs in the Node test environment, which has no localStorage, so one is stubbed
 * here. That is also a real code path — a browser in private mode with storage
 * disabled throws on access — hence the last test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { rememberAccount, rememberedAccount, forgetAccount } from '../src/lib/supabase/accountMemory'

function installStorage(): void {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
}

describe('account memory', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    installStorage()
  })

  it('reports no account before anyone has signed in, so a guest is never nagged', () => {
    expect(rememberedAccount()).toBeNull()
  })

  it('remembers the account after a sign-in', () => {
    rememberAccount('josh@sil.org')
    expect(rememberedAccount()).toBe('josh@sil.org')
  })

  it('forgets on a deliberate sign-out', () => {
    rememberAccount('josh@sil.org')
    forgetAccount()
    expect(rememberedAccount()).toBeNull()
  })

  it('survives a re-read, which is the point — it outlives the Supabase session entry', () => {
    rememberAccount('josh@sil.org')
    expect(rememberedAccount()).toBe('josh@sil.org')
    expect(rememberedAccount()).toBe('josh@sil.org')
  })

  it('degrades quietly when storage throws, rather than taking the app down with it', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage disabled')
      },
      setItem: () => {
        throw new Error('storage disabled')
      },
      removeItem: () => {
        throw new Error('storage disabled')
      },
    })
    expect(() => rememberAccount('a@b.c')).not.toThrow()
    expect(() => forgetAccount()).not.toThrow()
    expect(rememberedAccount()).toBeNull()
  })
})
