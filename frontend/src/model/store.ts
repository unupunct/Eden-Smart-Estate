import { create } from 'zustand'
import type { Doc, EdenObject, Geom, Layer, Overlay, Pos, Props, PropertyMeta, PropertyModel, ProviderCatalog } from './types'
import type { Shape } from './kinds'
import { duplicateObject, emptyDoc, newId, sortedLayers } from './ops'

export type Tool =
  | { type: 'select' }
  | { type: 'draw'; kind: string; presetId?: string }
  | { type: 'measure'; mode: 'distance' | 'area' }
  | { type: 'calibrate' }

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export interface CalibrationState {
  file: File
  imageUrl: string
  name: string
  width: number
  height: number
  imgPts: [number, number][] // pixel coordinates picked on the image (max 2)
  geoPts: Pos[] // matching ground positions picked on the map (max 2)
  phase: 'pick-image' | 'pick-map'
  mode: 'points' | 'distance'
  distanceM: number
  bearingDeg: number
}

const HISTORY_LIMIT = 200
const COALESCE_MS = 900

export interface EditorState {
  property: PropertyMeta | null
  doc: Doc
  overlays: Overlay[]
  past: Doc[]
  future: Doc[]
  gestureBase: Doc | null
  lastCommit: { key: string; t: number } | null
  selection: string[]
  tool: Tool
  shape: Shape
  snap: boolean
  view3d: boolean
  baseMap: string
  catalog: ProviderCatalog | null
  save: { status: SaveStatus; error?: string; savedAt?: number }
  calibration: CalibrationState | null
  focusRequest: { id: string; n: number } | null
  flash: string | null

  loadModel: (m: PropertyModel) => void
  clearProperty: () => void
  setCatalog: (c: ProviderCatalog) => void
  setTool: (t: Tool) => void
  setShape: (s: Shape) => void
  setSnap: (v: boolean) => void
  setView3d: (v: boolean) => void
  setBaseMap: (id: string) => void
  setSelection: (ids: string[]) => void
  toggleSelection: (id: string) => void
  setSaveState: (s: EditorState['save']) => void
  renameProperty: (name: string, description?: string) => void
  notify: (msg: string | null) => void

  commit: (next: Doc, key?: string) => void
  beginGesture: () => void
  liveUpdate: (next: Doc) => void
  endGesture: () => void
  cancelGesture: () => void
  undo: () => void
  redo: () => void

  addObjects: (objs: EdenObject[], select?: boolean) => void
  patchObject: (id: string, patch: { name?: string; props?: Props; geometry?: Geom; layerId?: string }, key?: string) => void
  setGeometries: (geoms: Record<string, Geom>, live?: boolean) => void
  deleteObjects: (ids: string[]) => void
  duplicateObjects: (ids: string[]) => void
  moveToLayer: (ids: string[], layerId: string) => void

  updateLayer: (id: string, patch: Partial<Layer>) => void
  moveLayer: (id: string, dir: -1 | 1) => void
  addLayer: (name: string, group: string) => void
  deleteLayer: (id: string) => void

  setOverlays: (o: Overlay[]) => void
  setCalibration: (c: CalibrationState | null) => void
  requestFocus: (id: string) => void
}

export const useEditor = create<EditorState>((set, get) => ({
  property: null,
  doc: emptyDoc(),
  overlays: [],
  past: [],
  future: [],
  gestureBase: null,
  lastCommit: null,
  selection: [],
  tool: { type: 'select' },
  shape: 'polygon',
  snap: true,
  view3d: false,
  baseMap: 'satellite',
  catalog: null,
  save: { status: 'idle' },
  calibration: null,
  focusRequest: null,
  flash: null,

  loadModel: (m) =>
    set({
      property: m.property,
      doc: { layers: m.layers, objects: Object.fromEntries(m.objects.map((o) => [o.id, { id: o.id, layerId: o.layerId, kind: o.kind, name: o.name, geometry: o.geometry, props: o.props }])) },
      overlays: m.overlays,
      past: [], future: [], gestureBase: null, lastCommit: null, selection: [], tool: { type: 'select' },
      baseMap: m.property.baseMap, view3d: false, save: { status: 'idle' }, calibration: null,
    }),
  clearProperty: () => set({ property: null, doc: emptyDoc(), overlays: [], past: [], future: [], selection: [], save: { status: 'idle' } }),
  setCatalog: (catalog) => set({ catalog }),
  setTool: (tool) => set({ tool, selection: tool.type === 'select' ? get().selection : [] }),
  setShape: (shape) => set({ shape }),
  setSnap: (snap) => set({ snap }),
  setView3d: (view3d) => set({ view3d }),
  setBaseMap: (baseMap) => set({ baseMap }),
  setSelection: (selection) => set({ selection }),
  toggleSelection: (id) => set((s) => ({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] })),
  setSaveState: (save) => set({ save }),
  renameProperty: (name, description) =>
    set((s) => (s.property ? { property: { ...s.property, name, description: description ?? s.property.description } } : {})),
  notify: (flash) => set({ flash }),

  commit: (next, key) => {
    const s = get()
    if (next === s.doc) return
    const now = Date.now()
    const coalesce = key && s.lastCommit && s.lastCommit.key === key && now - s.lastCommit.t < COALESCE_MS
    set({
      doc: next,
      past: coalesce ? s.past : [...s.past, s.doc].slice(-HISTORY_LIMIT),
      future: [],
      lastCommit: key ? { key, t: now } : null,
    })
  },
  beginGesture: () => set((s) => ({ gestureBase: s.doc, lastCommit: null })),
  liveUpdate: (next) => set({ doc: next }),
  endGesture: () => {
    const s = get()
    if (s.gestureBase && s.gestureBase !== s.doc) set({ past: [...s.past, s.gestureBase].slice(-HISTORY_LIMIT), future: [], gestureBase: null })
    else set({ gestureBase: null })
  },
  cancelGesture: () => {
    const s = get()
    if (s.gestureBase) set({ doc: s.gestureBase, gestureBase: null })
  },
  undo: () => {
    const s = get()
    if (!s.past.length) return
    const prev = s.past[s.past.length - 1]
    set({ doc: prev, past: s.past.slice(0, -1), future: [s.doc, ...s.future], selection: s.selection.filter((id) => prev.objects[id]), lastCommit: null })
  },
  redo: () => {
    const s = get()
    if (!s.future.length) return
    const next = s.future[0]
    set({ doc: next, future: s.future.slice(1), past: [...s.past, s.doc], selection: s.selection.filter((id) => next.objects[id]), lastCommit: null })
  },

  addObjects: (objs, select = true) => {
    const s = get()
    const objects = { ...s.doc.objects }
    for (const o of objs) objects[o.id] = o
    s.commit({ ...s.doc, objects })
    if (select) set({ selection: objs.map((o) => o.id) })
  },
  patchObject: (id, patch, key) => {
    const s = get()
    const o = s.doc.objects[id]
    if (!o) return
    const next: EdenObject = {
      ...o,
      name: patch.name ?? o.name,
      geometry: patch.geometry ?? o.geometry,
      layerId: patch.layerId ?? o.layerId,
      props: patch.props ? { ...o.props, ...patch.props } : o.props,
    }
    s.commit({ ...s.doc, objects: { ...s.doc.objects, [id]: next } }, key ?? `patch:${id}`)
  },
  setGeometries: (geoms, live = false) => {
    const s = get()
    const objects = { ...s.doc.objects }
    for (const [id, g] of Object.entries(geoms)) if (objects[id]) objects[id] = { ...objects[id], geometry: g }
    const next = { ...s.doc, objects }
    if (live) s.liveUpdate(next)
    else s.commit(next)
  },
  deleteObjects: (ids) => {
    const s = get()
    const objects = { ...s.doc.objects }
    for (const id of ids) delete objects[id]
    s.commit({ ...s.doc, objects })
    set({ selection: s.selection.filter((id) => objects[id]) })
  },
  duplicateObjects: (ids) => {
    const s = get()
    const copies = ids.map((id) => s.doc.objects[id]).filter(Boolean).map((o) => duplicateObject(o))
    if (copies.length) s.addObjects(copies)
  },
  moveToLayer: (ids, layerId) => {
    const s = get()
    const objects = { ...s.doc.objects }
    for (const id of ids) if (objects[id]) objects[id] = { ...objects[id], layerId }
    s.commit({ ...s.doc, objects })
  },

  updateLayer: (id, patch) => {
    const s = get()
    s.commit({ ...s.doc, layers: s.doc.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) }, `layer:${id}:${Object.keys(patch).join()}`)
  },
  moveLayer: (id, dir) => {
    const s = get()
    const list = sortedLayers(s.doc.layers)
    const i = list.findIndex((l) => l.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    const a = list[i]
    const b = list[j]
    s.commit({ ...s.doc, layers: s.doc.layers.map((l) => (l.id === a.id ? { ...l, order: b.order } : l.id === b.id ? { ...l, order: a.order } : l)) })
  },
  addLayer: (name, group) => {
    const s = get()
    const order = Math.max(-1, ...s.doc.layers.map((l) => l.order)) + 1
    const layer: Layer = { id: newId(), key: `custom_${newId().slice(0, 6)}`, name, group, color: '#c4b5fd', visible: true, locked: false, order }
    s.commit({ ...s.doc, layers: [...s.doc.layers, layer] })
  },
  deleteLayer: (id) => {
    const s = get()
    const layer = s.doc.layers.find((l) => l.id === id)
    if (!layer || !layer.key.startsWith('custom_')) return
    if (Object.values(s.doc.objects).some((o) => o.layerId === id)) {
      set({ flash: 'Move or delete the objects on this layer first.' })
      return
    }
    s.commit({ ...s.doc, layers: s.doc.layers.filter((l) => l.id !== id) })
  },

  setOverlays: (overlays) => set({ overlays }),
  setCalibration: (calibration) => set({ calibration }),
  requestFocus: (id) => set((s) => ({ focusRequest: { id, n: (s.focusRequest?.n ?? 0) + 1 }, selection: [id] })),
}))
