import { create } from 'zustand'
import { api } from '../api/client'
import { dropBaseline, flush, resetBaseline } from './autosave'
import { useEditor } from './store'
import type { PropertyMeta } from './types'

export type Route =
  | 'overview' | 'editor' | 'buildings' | 'garden' | 'orchard' | 'greenhouse' | 'pond' | 'library'
  | 'smart' | 'security' | 'automations' | 'sun' | 'sky' | 'tasks' | 'notes' | 'settings'

interface AppState {
  route: Route
  collapsed: boolean
  properties: PropertyMeta[]
  currentId: string | null
  booting: boolean
  serverError: string | null
  dialog: null | 'new-property' | 'image-import'
  go: (r: Route) => void
  toggleSidebar: () => void
  setDialog: (d: AppState['dialog']) => void
  boot: () => Promise<void>
  refresh: () => Promise<PropertyMeta[]>
  open: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

const LAST_KEY = 'eden.lastProperty'
const readLast = () => {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}

export const useApp = create<AppState>((set, get) => ({
  route: (location.hash.slice(1) as Route) || 'overview',
  collapsed: false,
  properties: [],
  currentId: null,
  booting: true,
  serverError: null,
  dialog: null,
  go: (route) => {
    location.hash = route
    set({ route })
  },
  toggleSidebar: () => set((s) => ({ collapsed: !s.collapsed })),
  setDialog: (dialog) => set({ dialog }),
  refresh: async () => {
    const properties = await api.listProperties()
    set({ properties })
    return properties
  },
  boot: async () => {
    try {
      const [catalog, props] = await Promise.all([api.providers(), api.listProperties()])
      useEditor.getState().setCatalog(catalog)
      set({ properties: props, serverError: null })
      const last = readLast()
      const pick = props.find((p) => p.id === last) ?? props[0]
      if (pick) await get().open(pick.id)
    } catch (e) {
      set({ serverError: (e as Error).message })
    } finally {
      set({ booting: false })
    }
  },
  open: async (id) => {
    await flush()
    const model = await api.getProperty(id)
    useEditor.getState().loadModel(model)
    resetBaseline(model)
    try {
      localStorage.setItem(LAST_KEY, id)
    } catch {
      /* private mode: just don't remember */
    }
    set({ currentId: id })
  },
  remove: async (id) => {
    if (get().currentId === id) {
      await flush()
      dropBaseline()
    }
    await api.deleteProperty(id)
    const props = await get().refresh()
    if (get().currentId === id) {
      useEditor.getState().clearProperty()
      set({ currentId: null })
      if (props[0]) await get().open(props[0].id)
    }
  },
}))

window.addEventListener('hashchange', () => {
  const r = location.hash.slice(1) as Route
  if (r && r !== useApp.getState().route) useApp.setState({ route: r })
})
