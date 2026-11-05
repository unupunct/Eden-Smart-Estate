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
  if (res.status === 401 && path !== '/api/auth/login') {
    location.reload() // the session ended: the app shows the sign-in screen
    throw new ApiError(401, 'Login required')
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

export interface PushStatus { publicKey: string; digest: boolean; hour: number; subscriptions: { id: string; label: string; createdAt: string; lastOk: string | null; failures: number }[] }
export interface PushResult { sent: number; failed: number; removed: number; subscribers: number; results: { label: string; ok: boolean; message: string }[] }

export interface AuthStatus { required: boolean; authenticated: boolean; setupAvailable: boolean; username: string | null }

export const api = {
  pushStatus: () => req<PushStatus>('/api/push/status'),
  pushSubscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, label: string) => req<PushStatus>('/api/push/subscribe', json('POST', { ...sub, label })),
  pushUnsubscribe: (endpoint: string) => req<PushStatus>('/api/push/unsubscribe', json('POST', { endpoint })),
  pushRemove: (id: string) => req<void>(`/api/push/subscriptions/${id}`, { method: 'DELETE' }),
  pushSettings: (patch: { digest?: boolean; hour?: number }) => req<PushStatus>('/api/push/settings', json('PUT', patch)),
  pushTest: () => req<PushResult>('/api/push/test', { method: 'POST' }),
  authStatus: () => req<AuthStatus>('/api/auth/status'),
  authSetup: (username: string, password: string) => req<{ ok: boolean; username: string }>('/api/auth/setup', json('POST', { username, password })),
  authPassword: (current: string, next: string) => req<{ ok: boolean }>('/api/auth/password', json('POST', { current, new: next })),
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

// ---------------------------------------------------------------------------------------------- smart home (Phase 5)
import type { Action, Automation, Camera, Condition, Device, Integration, LogEntry, SmartStatus, Trigger } from '../smart/types'

export const smartApi = {
  status: () => req<SmartStatus>('/api/smart/status'),
  integrations: () => req<Integration[]>('/api/integrations'),
  addIntegration: (b: { kind: string; name: string; url: string; token?: string; options?: Record<string, unknown> }) => req<Integration>('/api/integrations', json('POST', b)),
  patchIntegration: (id: string, b: Partial<{ name: string; url: string; token: string; enabled: boolean; options: Record<string, unknown> }>) => req<Integration>(`/api/integrations/${id}`, json('PATCH', b)),
  deleteIntegration: (id: string) => req<void>(`/api/integrations/${id}`, { method: 'DELETE' }),
  testIntegration: (id: string) => req<{ ok: boolean; message: string; count: number }>(`/api/integrations/${id}/test`, { method: 'POST' }),
  devices: () => req<Device[]>('/api/devices'),
  patchDevice: (id: string, b: Partial<{ name: string; objectId: string | null; risky: boolean; unit: string; commandTopic: string }>) => req<Device>(`/api/devices/${id}`, json('PATCH', b)),
  deleteDevice: (id: string) => req<void>(`/api/devices/${id}`, { method: 'DELETE' }),
  addMqttDevice: (b: { integrationId: string; name: string; stateTopic: string; commandTopic?: string; unit?: string; risky?: boolean }) => req<Device>('/api/devices/mqtt', json('POST', b)),
  command: (id: string, service: string, confirm: boolean) => req<{ ok: boolean; state: string | null }>(`/api/devices/${id}/command`, json('POST', { service, confirm })),
  cameras: () => req<Camera[]>('/api/cameras'),
  addCamera: (b: Partial<Camera> & { name: string; kind: string; password?: string; integrationId?: string | null }) => req<Camera>('/api/cameras', json('POST', b)),
  patchCamera: (id: string, b: Partial<{ name: string; url: string; username: string; password: string; objectId: string | null }>) => req<Camera>(`/api/cameras/${id}`, json('PATCH', b)),
  deleteCamera: (id: string) => req<void>(`/api/cameras/${id}`, { method: 'DELETE' }),
  snapshotUrl: (id: string) => `/api/cameras/${id}/snapshot`,
  streamUrl: (id: string) => `/api/cameras/${id}/stream`,
  automations: () => req<Automation[]>('/api/automations'),
  addAutomation: (b: { name: string; trigger: Trigger; conditions: Condition[]; actions: Action[]; enabled: boolean; riskAck: boolean }) => req<Automation>('/api/automations', json('POST', b)),
  patchAutomation: (id: string, b: Partial<{ name: string; trigger: Trigger; conditions: Condition[]; actions: Action[]; enabled: boolean; riskAck: boolean }>) => req<Automation>(`/api/automations/${id}`, json('PATCH', b)),
  deleteAutomation: (id: string) => req<void>(`/api/automations/${id}`, { method: 'DELETE' }),
  runAutomation: (id: string, dryRun: boolean, confirm = false) => req<{ ok: boolean; dryRun: boolean; messages: string[] }>(`/api/automations/${id}/run`, json('POST', { dryRun, confirm })),
  log: (limit = 60) => req<LogEntry[]>(`/api/automations-log?limit=${limit}`),
}

// ---------------------------------------------------------------------------------------------- management (Phase 6)
import type { DocText, DocumentInfo, HistoryEntry, OcrStatus, Task, TaskInput, TextHit, WeatherReply } from '../manage/types'

export const manageApi = {
  tasks: (propertyId: string) => req<Task[]>(`/api/tasks?propertyId=${propertyId}`),
  addTask: (b: TaskInput) => req<Task>('/api/tasks', json('POST', b)),
  patchTask: (id: string, b: Partial<Omit<TaskInput, 'propertyId'>> & { status?: 'open' | 'done' }) => req<Task>(`/api/tasks/${id}`, json('PATCH', b)),
  deleteTask: (id: string) => req<void>(`/api/tasks/${id}`, { method: 'DELETE' }),
  completeTask: (id: string, note = '', completedOn?: string) => req<Task>(`/api/tasks/${id}/complete`, json('POST', { note, completedOn })),
  history: (propertyId: string, limit = 200) => req<HistoryEntry[]>(`/api/tasks-history?propertyId=${propertyId}&limit=${limit}`),
  tasksCsvUrl: (propertyId: string) => `/api/properties/${propertyId}/tasks.csv`,
  tasksIcsUrl: (propertyId: string) => `/api/properties/${propertyId}/tasks.ics`,
  documents: (propertyId: string) => req<DocumentInfo[]>(`/api/documents?propertyId=${propertyId}`),
  upload: (propertyId: string, file: File, extra: { objectId?: string; title?: string; tags?: string; note?: string; takenAt?: string; stripMetadata?: string; readText?: string } = {}) => {
    const f = new FormData()
    f.append('file', file)
    f.append('propertyId', propertyId)
    for (const [k, v] of Object.entries(extra)) if (v) f.append(k, v)
    return req<DocumentInfo & { metadataRemoved: string[] }>('/api/documents', { method: 'POST', body: f })
  },
  patchDocument: (id: string, b: Partial<{ title: string; tags: string; note: string; objectId: string | null; takenAt: string | null }>) => req<DocumentInfo>(`/api/documents/${id}`, json('PATCH', b)),
  deleteDocument: (id: string) => req<void>(`/api/documents/${id}`, { method: 'DELETE' }),
  ocrStatus: () => req<OcrStatus>('/api/ocr/status'),
  ocrLanguages: (languages: string[]) => req<OcrStatus>('/api/ocr/settings', json('PUT', { languages })),
  ocrRunMissing: (propertyId: string) => req<{ queued: number }>(`/api/ocr/run-missing?propertyId=${propertyId}`, { method: 'POST' }),
  ocrReread: (id: string) => req<{ queued: number }>(`/api/documents/${id}/ocr`, { method: 'POST' }),
  documentText: (id: string) => req<DocText>(`/api/documents/${id}/text`),
  searchDocumentText: (propertyId: string, q: string) => req<TextHit[]>(`/api/documents-text/search?propertyId=${propertyId}&q=${encodeURIComponent(q)}`),
  weatherSettings: () => req<{ enabled: boolean; provider: string; url: string }>('/api/weather/settings'),
  setWeatherEnabled: (enabled: boolean) => req<{ enabled: boolean }>('/api/weather/settings', json('PUT', { enabled })),
  weather: (lat: number, lng: number) => req<WeatherReply>(`/api/weather?lat=${lat}&lng=${lng}`),
}
