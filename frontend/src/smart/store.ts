import { create } from 'zustand'
import { smartApi } from '../api/client'
import type { Automation, Camera, Device, Integration, SmartStatus } from './types'

interface SmartState {
  integrations: Integration[]
  devices: Device[]
  cameras: Camera[]
  automations: Automation[]
  status: SmartStatus | null
  loaded: boolean
  error: string | null
  load: () => Promise<void>
}

export const useSmart = create<SmartState>((set) => ({
  integrations: [], devices: [], cameras: [], automations: [], status: null, loaded: false, error: null,
  load: async () => {
    try {
      const [integrations, devices, cameras, automations, status] = await Promise.all([
        smartApi.integrations(), smartApi.devices(), smartApi.cameras(), smartApi.automations(), smartApi.status(),
      ])
      set({ integrations, devices, cameras, automations, status, loaded: true, error: null })
    } catch (e) {
      set({ error: (e as Error).message, loaded: true })
    }
  },
}))

if (typeof window !== 'undefined') (window as unknown as { __edenSmart?: unknown }).__edenSmart = useSmart // handle for the e2e tests

/** "unavailable" / "unknown" are real answers from Home Assistant; null means nothing was ever reported. */
export function stateText(d: Device): string {
  if (d.state === null) return 'no data'
  return d.unit ? `${d.state} ${d.unit}` : d.state
}

export function ago(iso: string | null): string {
  if (!iso) return 'never'
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 90) return 'just now'
  if (s < 5400) return `${Math.round(s / 60)} min ago`
  if (s < 172800) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} days ago`
}
