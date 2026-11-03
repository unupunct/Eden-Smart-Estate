import { api, type ChangeSet } from '../api/client'
import type { Doc, EdenObject, Layer, Pos, PropertyModel } from './types'
import { useEditor } from './store'

interface Baseline {
  propertyId: string
  layers: Map<string, Layer>
  objects: Map<string, EdenObject>
  baseMap: string
  name: string
  description: string
}

const DEBOUNCE_MS = 700
let baseline: Baseline | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let inflight: Promise<void> | null = null
let pendingView: { center: Pos; zoom: number; bearing: number; pitch: number } | null = null

function snapshotOf(propertyId: string, doc: Doc, baseMap: string, name: string, description: string): Baseline {
  return { propertyId, layers: new Map(doc.layers.map((l) => [l.id, l])), objects: new Map(Object.values(doc.objects).map((o) => [o.id, o])), baseMap, name, description }
}

/** Pure diff between what the server has and what the editor holds. Exported for tests. */
export function diffDoc(base: Pick<Baseline, 'layers' | 'objects'>, doc: Doc): ChangeSet {
  const cs: ChangeSet = {}
  const layers = doc.layers.filter((l) => base.layers.get(l.id) !== l)
  if (layers.length) cs.layers = layers
  const deleteLayers = [...base.layers.keys()].filter((id) => !doc.layers.some((l) => l.id === id))
  if (deleteLayers.length) cs.deleteLayers = deleteLayers
  const objects = Object.values(doc.objects).filter((o) => base.objects.get(o.id) !== o)
  if (objects.length) cs.objects = objects.map(({ id, layerId, kind, name, geometry, props }) => ({ id, layerId, kind, name, geometry, props }))
  const deleteObjects = [...base.objects.keys()].filter((id) => !doc.objects[id])
  if (deleteObjects.length) cs.deleteObjects = deleteObjects
  return cs
}

export function resetBaseline(m: PropertyModel): void {
  const doc = useEditor.getState().doc
  baseline = snapshotOf(m.property.id, doc, m.property.baseMap, m.property.name, m.property.description)
  pendingView = null
  clearTimeout(timer)
}

export function dropBaseline(): void {
  baseline = null
  pendingView = null
  clearTimeout(timer)
}

export function noteView(v: { center: Pos; zoom: number; bearing: number; pitch: number }): void {
  if (!baseline) return
  pendingView = v
  schedule(2500, false)
}

let dueAt = 0

/**
 * reset=true is a trailing debounce (content edits: wait for a quiet moment).
 * reset=false never postpones an earlier pending save (view moves must not delay content saves).
 */
function schedule(ms = DEBOUNCE_MS, reset = true): void {
  const due = Date.now() + ms
  if (!reset && timer && dueAt <= due) return
  clearTimeout(timer)
  dueAt = due
  timer = setTimeout(() => {
    timer = undefined
    void flush()
  }, ms)
}

function buildChangeSet(): { cs: ChangeSet; next: Baseline } | null {
  const s = useEditor.getState()
  if (!baseline || !s.property || s.property.id !== baseline.propertyId) return null
  const cs = diffDoc(baseline, s.doc)
  if (s.baseMap !== baseline.baseMap) cs.baseMap = s.baseMap
  if (s.property.name !== baseline.name) cs.name = s.property.name
  if (s.property.description !== baseline.description) cs.description = s.property.description
  if (pendingView) cs.view = pendingView
  if (Object.keys(cs).length === 0) return null
  return { cs, next: snapshotOf(baseline.propertyId, s.doc, s.baseMap, s.property.name, s.property.description) }
}

export function flush(): Promise<void> {
  clearTimeout(timer)
  timer = undefined
  if (inflight) return inflight.then(() => flush())
  const built = buildChangeSet()
  if (!built || !baseline) {
    const st = useEditor.getState().save.status
    if (st === 'dirty') useEditor.getState().setSaveState({ status: 'saved', savedAt: Date.now() })
    return Promise.resolve()
  }
  const { cs, next } = built
  const sentView = pendingView
  const onlyView = Object.keys(cs).length === 1 && cs.view
  if (!onlyView) useEditor.getState().setSaveState({ status: 'saving' })
  inflight = api
    .saveChanges(baseline.propertyId, cs)
    .then(() => {
      baseline = next
      if (pendingView === sentView) pendingView = null
      const st = useEditor.getState()
      const stillDirty = buildChangeSet()
      st.setSaveState(stillDirty && !stillDirty.cs.view ? { status: 'dirty' } : { status: 'saved', savedAt: Date.now() })
      if (stillDirty && !(Object.keys(stillDirty.cs).length === 1 && stillDirty.cs.view)) schedule(DEBOUNCE_MS, false)
    })
    .catch((e: Error) => {
      useEditor.getState().setSaveState({ status: 'error', error: e.message })
      schedule(5000, false) // keep retrying quietly; the status pill stays red until it works
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Watch the store and persist changes. Returns an unsubscribe function. */
export function startAutosave(): () => void {
  let prevDoc = useEditor.getState().doc
  let prevBase = useEditor.getState().baseMap
  let prevName = useEditor.getState().property?.name
  let prevDesc = useEditor.getState().property?.description
  const unsub = useEditor.subscribe((s) => {
    if (!baseline || s.property?.id !== baseline.propertyId) {
      prevDoc = s.doc
      return
    }
    if (s.doc !== prevDoc || s.baseMap !== prevBase || s.property?.name !== prevName || s.property?.description !== prevDesc) {
      prevDoc = s.doc
      prevBase = s.baseMap
      prevName = s.property?.name
      prevDesc = s.property?.description
      // gestures (dragging) mutate the doc continuously; the debounce keeps us from saving mid-drag
      if (s.save.status !== 'saving') s.setSaveState({ status: 'dirty' })
      schedule()
    }
  })
  const onHide = () => {
    if (document.visibilityState === 'hidden') void flush()
  }
  document.addEventListener('visibilitychange', onHide)
  return () => {
    unsub()
    document.removeEventListener('visibilitychange', onHide)
  }
}
