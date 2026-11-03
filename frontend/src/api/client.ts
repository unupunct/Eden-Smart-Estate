import type { EdenObject, Layer, Overlay, Pos, PropertyMeta, PropertyModel, ProviderCatalog } from '../model/types'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new ApiError(0, 'Cannot reach the EDEN server. Is it running?')
  }
  if (!res.ok) {
    let msg = res.statusText
    try {
      const body = await res.json()
      msg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, msg)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export interface ChangeSet {
  layers?: Layer[]
  deleteLayers?: string[]
  objects?: Pick<EdenObject, 'id' | 'layerId' | 'kind' | 'name' | 'geometry' | 'props'>[]
  deleteObjects?: string[]
  view?: { center: Pos; zoom: number; bearing: number; pitch: number }
  baseMap?: string
  name?: string
  description?: string
}

export interface AppSettings {
  satelliteProvider: string
  customTilesUrl: string
  customAttribution: string
  esriMaxZoom: number
  hasMaptilerKey: boolean
  hasCustomKey: boolean
  satelliteChoices: string[]
}

export interface GeocodeHit {
  label: string
  center: Pos
}

export const api = {
  health: () => req<{ status: string; version: string; properties: number }>('/api/health'),
  listProperties: () => req<PropertyMeta[]>('/api/properties'),
  createProperty: (name: string, center: Pos, zoom = 17, description = '') =>
    req<PropertyMeta>('/api/properties', json('POST', { name, center, zoom, description })),
  createDemo: () => req<PropertyMeta>('/api/demo', { method: 'POST' }),
  getProperty: (id: string) => req<PropertyModel>(`/api/properties/${id}`),
  deleteProperty: (id: string) => req<void>(`/api/properties/${id}`, { method: 'DELETE' }),
  saveChanges: (id: string, cs: ChangeSet) => req<{ savedAt: string }>(`/api/properties/${id}/changes`, json('POST', cs)),
  providers: () => req<ProviderCatalog>('/api/map-providers'),
  settings: () => req<AppSettings>('/api/settings'),
  saveSettings: (s: Partial<{ satelliteProvider: string; customTilesUrl: string; customAttribution: string; esriMaxZoom: number; maptilerKey: string; customKey: string }>) =>
    req<AppSettings>('/api/settings', json('PUT', s)),
  geocode: (q: string) => req<GeocodeHit[]>(`/api/geocode?q=${encodeURIComponent(q)}`),
  addOverlay: (pid: string, file: File, corners: Pos[], name: string, calibration: unknown) => {
    const f = new FormData()
    f.append('file', file)
    f.append('corners', JSON.stringify(corners))
    f.append('name', name)
    f.append('calibration', JSON.stringify(calibration))
    return req<Overlay>(`/api/properties/${pid}/overlays`, { method: 'POST', body: f })
  },
  patchOverlay: (id: string, patch: Partial<Pick<Overlay, 'name' | 'opacity' | 'visible' | 'corners'>>) =>
    req<Overlay>(`/api/overlays/${id}`, json('PATCH', patch)),
  deleteOverlay: (id: string) => req<void>(`/api/overlays/${id}`, { method: 'DELETE' }),
  importFeatures: (pid: string, file: File) => {
    const f = new FormData()
    f.append('file', file)
    return req<{ imported: number; skipped: number }>(`/api/properties/${pid}/import`, { method: 'POST', body: f })
  },
  importProject: (file: File) => {
    const f = new FormData()
    f.append('file', file)
    return req<PropertyMeta>('/api/import-project', { method: 'POST', body: f })
  },
  restore: (file: File) => {
    const f = new FormData()
    f.append('file', file)
    return req<{ restored: boolean }>('/api/restore', { method: 'POST', body: f })
  },
  exportUrl: (pid: string, fmt: 'geojson' | 'kml' | 'csv' | 'json') => `/api/properties/${pid}/export.${fmt}`,
  backupUrl: '/api/backup',
}
