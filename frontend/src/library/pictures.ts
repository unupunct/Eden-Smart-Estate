// Pictures of plants from Wikipedia / Wikimedia Commons (opt-in, free licences only, always credited). Never for mushrooms.
import { create } from 'zustand'

export interface PictureCredit {
  title: string
  artist: string
  licence: string
  licenceUrl: string
  page: string
  article: string
  source: string
}
export type Picture = { status: 'ok'; url: string; credit: PictureCredit } | { status: 'none'; why: string } | { status: 'error'; why: string } | { status: 'loading' }

interface Settings { enabled: boolean; sends: string; licences: string }

interface PicturesState {
  enabled: boolean
  settings: Settings | null
  cache: Record<string, Picture>
  loadSettings: () => Promise<void>
  setEnabled: (on: boolean) => Promise<void>
  fetchPicture: (kind: 'plants' | 'aquatic', id: string) => Promise<void>
  forget: () => Promise<void>
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init)
  if (r.status === 401) { location.reload(); throw new Error('Login required') }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}))
    throw new Error(typeof j.detail === 'string' ? j.detail : r.statusText)
  }
  return r.status === 204 ? (undefined as T) : ((await r.json()) as T)
}

export const usePictures = create<PicturesState>((set, get) => ({
  enabled: false,
  settings: null,
  cache: {},
  loadSettings: async () => {
    try {
      const s = await call<Settings>('/api/library/pictures/settings')
      set({ settings: s, enabled: s.enabled })
    } catch { /* the toggle stays off */ }
  },
  setEnabled: async (on) => {
    const s = await call<Settings>('/api/library/pictures/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: on }) })
    set({ settings: s, enabled: s.enabled, cache: on ? {} : get().cache })
  },
  fetchPicture: async (kind, id) => {
    const key = `${kind}/${id}`
    const cur = get().cache[key]
    if (!get().enabled || (cur && cur.status !== 'error')) return
    set({ cache: { ...get().cache, [key]: { status: 'loading' } } })
    try {
      const r = await call<Picture>(`/api/library/pictures/${key}`)
      set({ cache: { ...get().cache, [key]: r } })
    } catch (e) {
      set({ cache: { ...get().cache, [key]: { status: 'error', why: (e as Error).message } } })
    }
  },
  forget: async () => {
    await call('/api/library/pictures', { method: 'DELETE' })
    set({ cache: {} })
  },
}))
