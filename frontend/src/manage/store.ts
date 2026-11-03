import { create } from 'zustand'
import { manageApi } from '../api/client'
import type { DocumentInfo, HistoryEntry, Task, WeatherReply } from './types'

interface ManageState {
  propertyId: string | null
  tasks: Task[]
  history: HistoryEntry[]
  documents: DocumentInfo[]
  weatherEnabled: boolean
  weather: WeatherReply | null
  weatherError: string | null
  loaded: boolean
  error: string | null
  load: (propertyId: string | null) => Promise<void>
  loadWeather: (lat: number, lng: number) => Promise<void>
}

export const useManage = create<ManageState>((set, get) => ({
  propertyId: null, tasks: [], history: [], documents: [], weatherEnabled: false, weather: null, weatherError: null, loaded: false, error: null,
  load: async (propertyId) => {
    if (!propertyId) return set({ propertyId: null, tasks: [], history: [], documents: [], loaded: true })
    try {
      const [tasks, history, documents, ws] = await Promise.all([manageApi.tasks(propertyId), manageApi.history(propertyId), manageApi.documents(propertyId), manageApi.weatherSettings()])
      set({ propertyId, tasks, history, documents, weatherEnabled: ws.enabled, loaded: true, error: null, ...(propertyId !== get().propertyId ? { weather: null } : {}) })
    } catch (e) {
      set({ error: (e as Error).message, loaded: true })
    }
  },
  loadWeather: async (lat, lng) => {
    try {
      set({ weather: await manageApi.weather(lat, lng), weatherError: null })
    } catch (e) {
      set({ weatherError: (e as Error).message })
    }
  },
}))

if (typeof window !== 'undefined') (window as unknown as { __edenManage?: unknown }).__edenManage = useManage // handle for the e2e tests

export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`)
