import { create } from 'zustand'

type LibraryTab = 'plants' | 'mushrooms' | 'aquatic' | 'fish'

/** What a search result asks the destination page to show first (read once when the page opens). */
interface Intent {
  library: { tab: LibraryTab; q: string } | null
  documentsQ: string | null
  set: (p: Partial<Omit<Intent, 'set'>>) => void
}

export const useIntent = create<Intent>((set) => ({ library: null, documentsQ: null, set: (p) => set(p) }))
