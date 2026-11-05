import { create } from 'zustand'
import { browserZone } from './tz'
import type { LeafMode } from './shadows'

export interface SunState {
  on: boolean // draw shadows on the map
  tz: string // IANA zone used for dates and clocks
  instant: number // UTC ms being shown
  leaf: LeafMode
  heatOn: boolean
  heat: GeoJSON.FeatureCollection | null // sun-hours grid, filled by the Sun page
  terrainOn: boolean // tint the map by ground height
  terrain: GeoJSON.FeatureCollection | null // elevation cells, filled by the terrain card
  set: (p: Partial<Omit<SunState, 'set'>>) => void
}

export const useSun = create<SunState>((set) => ({
  on: false,
  tz: browserZone(),
  instant: Date.now(),
  leaf: 'auto',
  heatOn: false,
  heat: null,
  terrainOn: false,
  terrain: null,
  set: (p) => set(p),
}))

const zoneKey = (propertyId: string) => `eden.tz.${propertyId}`

/** The zone is remembered per property in this browser (a convenience only; the default is the browser's own zone). */
export function loadZone(propertyId: string): string {
  try {
    return localStorage.getItem(zoneKey(propertyId)) || browserZone()
  } catch {
    return browserZone()
  }
}

export function saveZone(propertyId: string, tz: string): void {
  try {
    localStorage.setItem(zoneKey(propertyId), tz)
  } catch {
    /* private mode: not remembered */
  }
}

if (typeof window !== 'undefined') (window as unknown as { __edenSun?: unknown }).__edenSun = useSun // handle for the e2e tests
