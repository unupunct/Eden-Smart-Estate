import { create } from 'zustand'
import type { Surface } from '../sun/shadows'

export interface Terrain {
  center: [number, number]
  elevation: number
  slopeDeg: number
  aspectDeg: number | null
  aspect: string
  localRelief: number
  regionRelief: number
  horizon: { az: number; alt: number }[]
  horizonMax: { az: number; alt: number }
  local: { n: number; stepM: number; z: number[][] }
  region: { n: number; stepM: number; z: number[][] }
  source: { id?: string; name: string; resolutionM: number; licence: string; attribution: string; kind: string }
  fetchedAt: string
  stale: boolean
}
export interface TerrainProvider { id: string; name: string; resolutionM: number; licence: string; sends: string }
export interface TerrainSettings { enabled: boolean; providerId: string; provider: string; providers: TerrainProvider[] }
export interface TerrainReply { enabled: boolean; terrain: Terrain | null; error?: string }

/** Height of the land's skyline (degrees above the flat horizon) in a compass direction; the profile is every 10 degrees. */
export function horizonAt(horizon: { az: number; alt: number }[], az: number): number {
  const n = horizon.length
  if (!n) return 0
  const step = 360 / n
  const a = (((az % 360) + 360) % 360) / step
  const i = Math.floor(a) % n
  const f = a - Math.floor(a)
  return horizon[i].alt * (1 - f) + horizon[(i + 1) % n].alt * f
}

export function horizonFn(t: Terrain | null | undefined): ((az: number) => number) | undefined {
  if (!t || !t.horizon.length) return undefined
  return (az) => horizonAt(t.horizon, az)
}

const M_LAT = 110574
const mLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180)

/**
 * Slope and facing of the ground at a point, from the local elevation grid (Horn's method on the grid node nearest the point).
 * (x, y) are metres east and north of the grid centre. Returns null on level ground (< 0.5 degrees) or outside the grid.
 */
export function groundAt(t: Terrain, x: number, y: number): Surface | null {
  const { n, stepM, z } = t.local
  if (n < 3) return null
  const half = (n - 1) / 2
  const c = Math.round(x / stepM + half), r = Math.round(half - y / stepM)
  if (c < 0 || r < 0 || c > n - 1 || r > n - 1) return null
  const ci = Math.min(n - 2, Math.max(1, c)), ri = Math.min(n - 2, Math.max(1, r))
  const a = z[ri - 1][ci - 1], b = z[ri - 1][ci], cc = z[ri - 1][ci + 1]
  const d = z[ri][ci - 1], f = z[ri][ci + 1]
  const g = z[ri + 1][ci - 1], h = z[ri + 1][ci], i = z[ri + 1][ci + 1]
  const dzdx = ((cc + 2 * f + i) - (a + 2 * d + g)) / (8 * stepM) // rise per metre going east
  const dzdy = ((a + 2 * b + cc) - (g + 2 * h + i)) / (8 * stepM) // rise per metre going north
  const slopeDeg = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI
  if (slopeDeg < 0.5) return null
  return { slopeDeg, aspectDeg: ((((Math.atan2(-dzdx, -dzdy) * 180) / Math.PI) % 360) + 360) % 360 }
}

/** Ground tilt for the sun-hours maths: a function of a point in metres east/north of the PROPERTY origin (the terrain grid sits on the rounded centre). */
export function surfaceFn(t: Terrain | null | undefined, origin: [number, number]): ((p: [number, number]) => Surface | undefined) | undefined {
  if (!t) return undefined
  const dx = (origin[0] - t.center[0]) * mLng(origin[1]), dy = (origin[1] - t.center[1]) * M_LAT
  return (p) => groundAt(t, p[0] + dx, p[1] + dy) ?? undefined
}

/** Elevation cells for the map: the 90 m local grid on top of the 300 m regional one. `rel` is 0..1 within the whole area. */
export function elevationCells(t: Terrain): GeoJSON.FeatureCollection {
  const [lng, lat] = t.center
  const all = [...t.region.z.flat(), ...t.local.z.flat()]
  const lo = Math.min(...all), hi = Math.max(...all)
  const span = Math.max(1, hi - lo)
  const features: GeoJSON.Feature[] = []
  const add = (g: Terrain['local'], level: 'region' | 'local') => {
    const half = (g.n - 1) / 2
    for (let r = 0; r < g.n; r++) {
      for (let c = 0; c < g.n; c++) {
        const cx = (c - half) * g.stepM, cy = (half - r) * g.stepM
        const h = g.stepM / 2
        const pt = (x: number, y: number): [number, number] => [lng + x / mLng(lat), lat + y / M_LAT]
        const ring = [pt(cx - h, cy - h), pt(cx + h, cy - h), pt(cx + h, cy + h), pt(cx - h, cy + h), pt(cx - h, cy - h)]
        features.push({ type: 'Feature', properties: { z: g.z[r][c], rel: (g.z[r][c] - lo) / span, level }, geometry: { type: 'Polygon', coordinates: [ring] } })
      }
    }
  }
  add(t.region, 'region')
  add(t.local, 'local')
  return { type: 'FeatureCollection', features }
}

// ------------------------------------------------------------------ store
interface TerrainState {
  propertyId: string | null
  data: Terrain | null
  enabled: boolean
  loading: boolean
  error: string
  blocks: boolean // let the land's horizon block the sun in the sun-hours figures
  tilt: boolean // tilt beds to the lie of the land in the sun-hours figures
  providers: TerrainProvider[]
  providerId: string
  loadSettings: () => Promise<void>
  load: (propertyId: string, refresh?: boolean) => Promise<void>
  setEnabled: (propertyId: string, enabled: boolean, provider?: string) => Promise<void>
  forget: (propertyId: string) => Promise<void>
  set: (p: Partial<Pick<TerrainState, 'blocks' | 'tilt'>>) => void
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

export const useTerrain = create<TerrainState>((set, get) => ({
  propertyId: null, data: null, enabled: false, loading: false, error: '', blocks: true, tilt: true, providers: [], providerId: 'open-meteo',
  loadSettings: async () => {
    try {
      const s = await call<TerrainSettings>('/api/terrain/settings')
      set({ providers: s.providers, providerId: s.providerId, enabled: s.enabled })
    } catch { /* the card still works without the list */ }
  },
  load: async (propertyId, refresh = false) => {
    set({ loading: true, error: '', propertyId, ...(get().propertyId === propertyId ? {} : { data: null }) })
    try {
      const r = await call<TerrainReply>(`/api/properties/${propertyId}/terrain${refresh ? '?refresh=true' : ''}`)
      if (get().propertyId !== propertyId) return
      set({ data: r.terrain, enabled: r.enabled, error: r.error ?? '' })
    } catch (e) {
      if (get().propertyId === propertyId) set({ error: (e as Error).message })
    } finally {
      if (get().propertyId === propertyId) set({ loading: false })
    }
  },
  setEnabled: async (propertyId, enabled, provider) => {
    const s = await call<TerrainSettings>('/api/terrain/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(provider ? { enabled, provider } : { enabled }) })
    set({ enabled, providerId: s.providerId, providers: s.providers })
    if (enabled) await get().load(propertyId)
  },
  forget: async (propertyId) => {
    await call(`/api/properties/${propertyId}/terrain`, { method: 'DELETE' })
    set({ data: null })
  },
  set: (p) => set(p),
}))

if (typeof window !== 'undefined') (window as unknown as { __edenTerrain?: unknown }).__edenTerrain = useTerrain // handle for the e2e tests
