import { create } from 'zustand'
import { buildIndex, type LibraryIndex } from './logic'
import type { Library } from './types'

interface LibraryState {
  lib: Library | null
  ix: LibraryIndex | null
  error: string | null
  load: () => Promise<void>
}

export const useLibrary = create<LibraryState>((set, get) => ({
  lib: null,
  ix: null,
  error: null,
  load: async () => {
    if (get().lib) return
    try {
      const res = await fetch('/api/library')
      if (!res.ok) throw new Error(res.statusText)
      const lib = (await res.json()) as Library
      set({ lib, ix: buildIndex(lib), error: null })
    } catch (e) {
      set({ error: `Plant library unavailable: ${(e as Error).message}` })
    }
  },
}))
