import * as maplibregl from 'maplibre-gl'
import type { Feature, FeatureCollection, Point as GPoint } from 'geojson'
import { angleBetween, bbox, circlePolygon, insertVertex, moveVertex, polygonFrom, removeVertex, rotate, translate } from '../geo/transform'
import { centroid, distance, fmtArea, fmtLength, lineLength, polygonArea } from '../geo/measure'
import { flush } from '../model/autosave'
import { kindDef, num } from '../model/kinds'
import { createObject } from '../model/ops'
import { useEditor } from '../model/store'
import type { Doc, EdenObject, Geom, Pos } from '../model/types'
import type { LabelItem } from './features'
import { HIT_LAYERS } from './layers'
import { useStatus } from './support'

type Pt = maplibregl.Point
type Ev = maplibregl.MapMouseEvent | maplibregl.MapTouchEvent

type Drag =
  | { type: 'move'; ids: string[]; startLL: Pos; base: Doc; start: Pt; started: boolean }
  | { type: 'vertex'; id: string; index: number; base: Doc }
  | { type: 'rotate'; id: string; pivot: Pos; startAngle: number; base: Doc }

interface Candidate {
  shape: 'line' | 'polygon'
  coords: Pos[]
  closed: boolean
}

const VERTEX_GRAB = 12
const DRAG_THRESHOLD = 4
const CLOSE_PX = 11
const SNAP_PX = 11

export class Interaction {
  private drag: Drag | null = null
  private pts: Pos[] = []
  private anchor: Pos | null = null
  private hover: Pos | null = null
  private snapMark: Pos | null = null
  private finalMeasure: Candidate | null = null
  private downAt: { pt: Pt; onEmpty: boolean } | null = null
  private bboxCache = new WeakMap<Geom, [number, number, number, number]>()
  private offs: (() => void)[] = []

  constructor(private map: maplibregl.Map, private drawSource: () => maplibregl.GeoJSONSource | undefined) {
    const on = <T extends keyof maplibregl.MapEventType>(t: T, f: (e: maplibregl.MapEventType[T]) => void) => {
      map.on(t, f as never)
      this.offs.push(() => map.off(t, f as never))
    }
    on('mousedown', (e) => this.onDown(e))
    on('touchstart', (e) => e.originalEvent.touches.length === 1 && this.onDown(e))
    on('mousemove', (e) => this.onMove(e))
    on('touchmove', (e) => e.originalEvent.touches.length === 1 && this.onMove(e))
    on('mouseup', () => this.onUp())
    on('touchend', () => this.onUp())
    on('click', (e) => this.onClick(e))
    on('dblclick', (e) => this.onDblClick(e))
    on('contextmenu', (e) => this.onContext(e))
    const key = (e: KeyboardEvent) => this.onKey(e)
    window.addEventListener('keydown', key)
    this.offs.push(() => window.removeEventListener('keydown', key))
    this.offs.push(useEditor.subscribe((s, p) => { if (s.tool !== p.tool) this.resetDrawing() }))
  }

  destroy(): void {
    this.offs.forEach((f) => f())
  }

  // ------------------------------------------------------------------ helpers
  private st() {
    return useEditor.getState()
  }

  private px(p: Pos): Pt {
    return this.map.project(p)
  }

  private setCursor(c: string) {
    this.map.getCanvas().style.cursor = c
  }

  private layersExist(ids: string[]): string[] {
    return ids.filter((id) => this.map.getLayer(id))
  }

  private box(pt: Pt, n: number): [maplibregl.PointLike, maplibregl.PointLike] {
    return [[pt.x - n, pt.y - n], [pt.x + n, pt.y + n]]
  }

  private geomBox(g: Geom) {
    let b = this.bboxCache.get(g)
    if (!b) {
      b = bbox(g)
      this.bboxCache.set(g, b)
    }
    return b
  }

  /** Pick the object under the pointer: points beat lines beat polygons; among polygons the smallest wins. */
  private pick(pt: Pt): string | null {
    const m = this.map
    const unlocked = (f: Feature) => f.properties && !f.properties.locked
    const pointHits = m.queryRenderedFeatures(this.box(pt, 14), { layers: this.layersExist(HIT_LAYERS.points) }).filter(unlocked)
    if (pointHits.length) {
      let best = pointHits[0]
      let bd = Infinity
      for (const f of pointHits) {
        const c = (f.geometry as GPoint).coordinates as Pos
        const d = Math.hypot(this.px(c).x - pt.x, this.px(c).y - pt.y)
        if (d < bd) {
          bd = d
          best = f
        }
      }
      return String(best.properties!.id)
    }
    const lineHits = m.queryRenderedFeatures(this.box(pt, 7), { layers: this.layersExist(HIT_LAYERS.lines) }).filter(unlocked)
    const pureLines = lineHits.filter((f) => f.geometry.type === 'LineString')
    if (pureLines.length) return String(pureLines.sort((a, b) => Number(b.properties!.sort) - Number(a.properties!.sort))[0].properties!.id)
    const fillHits = m.queryRenderedFeatures(pt as unknown as maplibregl.PointLike, { layers: this.layersExist(HIT_LAYERS.fills), filter: ['==', ['get', 'fh'], 1] }).filter(unlocked)
    const polyHits = [...lineHits, ...fillHits]
    if (polyHits.length) return String(polyHits.sort((a, b) => Number(a.properties!.area) - Number(b.properties!.area))[0].properties!.id)
    return null
  }

  private pickHandle(pt: Pt): { role: string; index: number } | null {
    const layers = this.layersExist(['h-rotate', 'h-vertex', 'h-mid'])
    if (!layers.length) return null
    const hits = this.map.queryRenderedFeatures(this.box(pt, VERTEX_GRAB), { layers })
    for (const role of ['rotate', 'vertex', 'mid']) {
      const f = hits.find((h) => h.properties?.role === role)
      if (f) return { role, index: Number(f.properties!.index ?? 0) }
    }
    return null
  }

  /** Snap to nearby vertices, then edges, of visible & unlocked objects (and optionally the shape being drawn). */
  private resolve(e: { lngLat: maplibregl.LngLat; point: Pt; originalEvent?: MouseEvent | TouchEvent }, exclude: Set<string> = new Set(), extra: Pos[] = []): Pos {
    const raw: Pos = [e.lngLat.lng, e.lngLat.lat]
    this.snapMark = null
    const s = this.st()
    const alt = !!(e.originalEvent && 'altKey' in e.originalEvent && e.originalEvent.altKey)
    if (!s.snap || alt) return raw
    const p = e.point
    const a = this.map.unproject([p.x - SNAP_PX, p.y + SNAP_PX])
    const b = this.map.unproject([p.x + SNAP_PX, p.y - SNAP_PX])
    const w = Math.min(a.lng, b.lng), ea = Math.max(a.lng, b.lng), so = Math.min(a.lat, b.lat), no = Math.max(a.lat, b.lat)
    let best: { d: number; pos: Pos } | null = null
    const consider = (pos: Pos, bonus = 0) => {
      const q = this.px(pos)
      const d = Math.hypot(q.x - p.x, q.y - p.y) - bonus
      if (d < SNAP_PX && (!best || d < best.d)) best = { d, pos }
    }
    for (const v of extra) consider(v, 2)
    const layers = new Map(s.doc.layers.map((l) => [l.id, l]))
    for (const o of Object.values(s.doc.objects)) {
      if (exclude.has(o.id)) continue
      const layer = layers.get(o.layerId)
      if (!layer || !layer.visible || layer.locked) continue
      const bb = this.geomBox(o.geometry)
      if (bb[2] < w || bb[0] > ea || bb[3] < so || bb[1] > no) continue
      const vs = o.geometry.type === 'Point' ? [o.geometry.coordinates] : o.geometry.type === 'LineString' ? o.geometry.coordinates : o.geometry.coordinates[0]
      for (const v of vs) consider(v, 2)
      if (o.geometry.type !== 'Point') {
        for (let i = 0; i < vs.length - 1; i++) {
          const q1 = this.px(vs[i])
          const q2 = this.px(vs[i + 1])
          const dx = q2.x - q1.x
          const dy = q2.y - q1.y
          const l2 = dx * dx + dy * dy
          if (!l2) continue
          const t = Math.max(0, Math.min(1, ((p.x - q1.x) * dx + (p.y - q1.y) * dy) / l2))
          const qp = this.map.unproject([q1.x + t * dx, q1.y + t * dy])
          consider([qp.lng, qp.lat])
        }
      }
    }
    const hit = best as { d: number; pos: Pos } | null
    if (hit) {
      this.snapMark = hit.pos
      return hit.pos
    }
    return raw
  }

  // ------------------------------------------------------------------ pointer events
  private onDown(e: Ev) {
    const s = this.st()
    if (e.type === 'mousedown' && (e.originalEvent as MouseEvent).button !== 0) return
    if (s.tool.type !== 'select') return
    const pt = e.point
    // 1. handles of the single selected object
    if (s.selection.length === 1) {
      const sel = s.doc.objects[s.selection[0]]
      const h = this.pickHandle(pt)
      if (sel && h && !this.isLocked(sel)) {
        this.map.dragPan.disable()
        s.beginGesture()
        if (h.role === 'rotate') {
          const pivot = centroid(bboxAsPolygon(sel.geometry))
          this.drag = { type: 'rotate', id: sel.id, pivot, startAngle: angleBetween(pivot, [e.lngLat.lng, e.lngLat.lat]), base: s.doc }
        } else if (h.role === 'vertex') {
          this.drag = { type: 'vertex', id: sel.id, index: h.index, base: s.doc }
        } else {
          // drag a midpoint handle: insert a vertex there, then keep dragging it
          const mid = this.map.queryRenderedFeatures(this.box(pt, VERTEX_GRAB), { layers: ['h-mid'] })[0]
          const at = (mid.geometry as GPoint).coordinates as Pos
          const g = insertVertex(sel.geometry, h.index, at)
          s.setGeometries({ [sel.id]: g }, true)
          this.drag = { type: 'vertex', id: sel.id, index: h.index + 1, base: this.st().doc }
        }
        return
      }
    }
    // 2. an object
    const id = this.pick(pt)
    if (id) {
      const shift = !!(e.originalEvent as MouseEvent).shiftKey
      if (shift) s.toggleSelection(id)
      else if (!s.selection.includes(id)) s.setSelection([id])
      const ids = this.st().selection
      if (ids.includes(id)) {
        const base = this.st().doc
        this.drag = { type: 'move', ids, startLL: [e.lngLat.lng, e.lngLat.lat], base, start: pt, started: false }
        this.map.dragPan.disable()
      }
      this.downAt = null
      return
    }
    this.downAt = { pt, onEmpty: true }
  }

  private isLocked(o: EdenObject): boolean {
    return !!this.st().doc.layers.find((l) => l.id === o.layerId)?.locked
  }

  private onMove(e: Ev) {
    const s = this.st()
    const ll: Pos = [e.lngLat.lng, e.lngLat.lat]
    useStatus.setState({ cursor: ll })
    const d = this.drag
    if (d) {
      if (d.type === 'move') {
        if (!d.started) {
          if (Math.hypot(e.point.x - d.start.x, e.point.y - d.start.y) < DRAG_THRESHOLD) return
          d.started = true
          s.beginGesture()
        }
        const dLng = ll[0] - d.startLL[0]
        const dLat = ll[1] - d.startLL[1]
        const objects = { ...d.base.objects }
        for (const id of d.ids) {
          const o = objects[id]
          if (o && !this.isLocked(o)) objects[id] = { ...o, geometry: translate(o.geometry, dLng, dLat) }
        }
        s.liveUpdate({ ...d.base, objects })
      } else if (d.type === 'vertex') {
        const o = d.base.objects[d.id]
        const pos = this.resolve(e, new Set([d.id]))
        const objects = { ...d.base.objects, [d.id]: { ...o, geometry: moveVertex(o.geometry, d.index, pos) } }
        s.liveUpdate({ ...d.base, objects })
        this.renderSnap()
      } else {
        const o = d.base.objects[d.id]
        let delta = angleBetween(d.pivot, ll) - d.startAngle
        if ((e.originalEvent as MouseEvent).shiftKey) delta = Math.round(delta / 15) * 15
        const props = { ...o.props }
        props.orientation = (((num(o.props.orientation, 0) + delta) % 360) + 360) % 360
        if (typeof o.props.roofOrientation === 'number') props.roofOrientation = (((o.props.roofOrientation + delta) % 360) + 360) % 360
        const objects = { ...d.base.objects, [d.id]: { ...o, geometry: rotate(o.geometry, delta, d.pivot), props } }
        s.liveUpdate({ ...d.base, objects })
      }
      return
    }
    if (s.tool.type === 'select') {
      this.setCursor(this.pickHandle(e.point) ? 'grab' : this.pick(e.point) ? 'pointer' : '')
      return
    }
    if (s.tool.type === 'draw' || s.tool.type === 'measure') {
      this.hover = this.resolve(e, new Set(), this.pts)
      this.setCursor('crosshair')
      this.preview()
    } else if (s.tool.type === 'calibrate') {
      this.setCursor('crosshair')
    }
  }

  private onUp() {
    if (this.drag) {
      this.st().endGesture()
      this.drag = null
      this.map.dragPan.enable()
      this.renderSnap(true)
      return
    }
    if (this.downAt && this.st().tool.type === 'select') {
      // plain click on empty ground clears the selection (a pan would have moved the pointer)
      this.downAt = null
    }
  }

  private onClick(e: maplibregl.MapMouseEvent) {
    const s = this.st()
    const t = s.tool
    if (t.type === 'select') {
      if (!this.pick(e.point) && !(e.originalEvent as MouseEvent).shiftKey && s.selection.length) s.setSelection([])
      return
    }
    if (t.type === 'calibrate') return this.calibrateClick(e)
    if (e.originalEvent && (e.originalEvent as MouseEvent).button > 0) return
    const pos = this.resolve(e, new Set(), this.pts)
    if (t.type === 'draw') this.drawClick(pos, e.point)
    else this.measureClick(pos, e.point)
  }

  private onDblClick(e: maplibregl.MapMouseEvent) {
    const s = this.st()
    if (s.tool.type === 'draw' || s.tool.type === 'measure') {
      e.preventDefault()
      this.finish()
    } else if (s.tool.type === 'select' && s.selection.length === 1) {
      const h = this.pickHandle(e.point)
      if (h?.role === 'vertex') {
        e.preventDefault()
        this.deleteVertex(s.selection[0], h.index)
      }
    }
  }

  private onContext(e: maplibregl.MapMouseEvent) {
    const s = this.st()
    if (s.tool.type === 'draw' || s.tool.type === 'measure') {
      e.preventDefault()
      if (this.pts.length || this.anchor) this.resetDrawing()
      else s.setTool({ type: 'select' })
      return
    }
    if (s.tool.type === 'select' && s.selection.length === 1) {
      const h = this.pickHandle(e.point)
      if (h?.role === 'vertex') {
        e.preventDefault()
        this.deleteVertex(s.selection[0], h.index)
      }
    }
  }

  private deleteVertex(id: string, index: number) {
    const s = this.st()
    const o = s.doc.objects[id]
    const g = o && removeVertex(o.geometry, index)
    if (!g) {
      s.notify(o?.geometry.type === 'Polygon' ? 'A polygon needs at least 3 corners.' : 'A line needs at least 2 points.')
      return
    }
    s.setGeometries({ [id]: g })
  }

  // ------------------------------------------------------------------ drawing
  private shapeFor(): 'point' | 'line' | 'polygon' | 'rectangle' | 'circle' {
    const t = this.st().tool
    if (t.type === 'measure') return t.mode === 'area' ? 'polygon' : 'line'
    if (t.type !== 'draw') return 'line'
    const g = kindDef(t.kind).geom
    if (g === 'Point') return 'point'
    if (g === 'LineString') return 'line'
    return this.st().shape
  }

  private candidate(): Candidate | null {
    const shape = this.shapeFor()
    const h = this.hover
    if (shape === 'rectangle' || shape === 'circle') {
      if (!this.anchor || !h) return null
      if (shape === 'circle') {
        const r = distance(this.anchor, h)
        if (r < 0.05) return null
        const g = circlePolygon(this.anchor, r) as Extract<Geom, { type: 'Polygon' }>
        return { shape: 'polygon', coords: g.coordinates[0].slice(0, -1), closed: true }
      }
      const a = this.px(this.anchor)
      const b = this.px(h)
      const corner = (x: number, y: number): Pos => {
        const l = this.map.unproject([x, y])
        return [l.lng, l.lat]
      }
      return { shape: 'polygon', coords: [corner(a.x, a.y), corner(b.x, a.y), corner(b.x, b.y), corner(a.x, b.y)], closed: true }
    }
    if (shape === 'point' || (!this.pts.length && !h)) return null
    const coords = h ? [...this.pts, h] : [...this.pts]
    return { shape: shape === 'polygon' ? 'polygon' : 'line', coords, closed: shape === 'polygon' }
  }

  private color(): string {
    const t = this.st().tool
    return t.type === 'measure' ? '#22d3ee' : t.type === 'draw' ? kindDef(t.kind).color : '#22d3ee'
  }

  private drawClick(pos: Pos, pt: Pt) {
    const s = this.st()
    if (s.tool.type !== 'draw') return
    const kind = s.tool.kind
    const shape = this.shapeFor()
    if (shape === 'point') {
      const obj = createObject(s.doc.layers, kind, { type: 'Point', coordinates: pos }, s.tool.presetId, s.tool.extra)
      s.addObjects([obj])
      return
    }
    if (shape === 'rectangle' || shape === 'circle') {
      if (!this.anchor) {
        this.anchor = pos
        this.hover = pos
        return
      }
      this.hover = pos
      const c = this.candidate()
      if (c) {
        const a = this.px(this.anchor)
        const b = this.px(pos)
        const tooSmall = shape === 'rectangle' && (Math.abs(a.x - b.x) < 6 || Math.abs(a.y - b.y) < 6)
        if (!tooSmall) this.commitShape(kind, s.tool.presetId, polygonFrom(c.coords))
      }
      this.resetDrawing()
      return
    }
    this.addVertex(pos, pt, shape === 'polygon', (coords) => this.commitShape(kind, s.tool.type === 'draw' ? s.tool.presetId : undefined, shape === 'polygon' ? polygonFrom(coords) : { type: 'LineString', coordinates: coords }))
  }

  private addVertex(pos: Pos, pt: Pt, polygon: boolean, finish: (coords: Pos[]) => void) {
    const last = this.pts[this.pts.length - 1]
    if (last) {
      const q = this.px(last)
      if (Math.hypot(q.x - pt.x, q.y - pt.y) < 4) return
    }
    if (polygon && this.pts.length >= 3) {
      const f = this.px(this.pts[0])
      if (Math.hypot(f.x - pt.x, f.y - pt.y) < CLOSE_PX) {
        finish([...this.pts])
        this.resetDrawing()
        return
      }
    }
    this.pts.push(pos)
    this.preview()
  }

  private commitShape(kind: string, presetId: string | undefined, geometry: Geom) {
    const s = this.st()
    const obj = createObject(s.doc.layers, kind, geometry, presetId, s.tool.type === 'draw' ? s.tool.extra : undefined)
    s.addObjects([obj])
  }

  private measureClick(pos: Pos, pt: Pt) {
    if (this.finalMeasure) {
      this.finalMeasure = null
      this.pts = []
    }
    this.addVertex(pos, pt, false, () => undefined)
  }

  private calibrateClick(e: maplibregl.MapMouseEvent) {
    const s = this.st()
    const c = s.calibration
    if (!c || c.phase !== 'pick-map' || c.geoPts.length >= 2) return
    s.setCalibration({ ...c, geoPts: [...c.geoPts, [e.lngLat.lng, e.lngLat.lat]] })
    this.preview()
  }

  /** Enter / double-click: finish the current line or polygon. */
  finish() {
    const s = this.st()
    const shape = this.shapeFor()
    if (s.tool.type === 'measure') {
      const pts = this.pts.slice(0, shape === 'polygon' ? undefined : undefined)
      // double-click adds the final point twice; the 4px guard in addVertex already dropped the duplicate
      if (pts.length >= (shape === 'polygon' ? 3 : 2)) {
        this.finalMeasure = { shape: shape === 'polygon' ? 'polygon' : 'line', coords: pts, closed: shape === 'polygon' }
        this.pts = []
        this.hover = null
        this.preview()
      }
      return
    }
    if (s.tool.type !== 'draw') return
    const min = shape === 'polygon' ? 3 : 2
    if ((shape === 'line' || shape === 'polygon') && this.pts.length >= min) {
      const geometry: Geom = shape === 'polygon' ? polygonFrom(this.pts) : { type: 'LineString', coordinates: [...this.pts] }
      this.commitShape(s.tool.kind, s.tool.presetId, geometry)
      this.resetDrawing()
    }
  }

  resetDrawing() {
    this.pts = []
    this.anchor = null
    this.hover = null
    this.snapMark = null
    this.finalMeasure = null
    this.preview()
  }

  // ------------------------------------------------------------------ rendering of previews & labels
  private renderSnap(clear = false) {
    if (clear) this.snapMark = null
    this.preview()
  }

  preview() {
    const s = this.st()
    const src = this.drawSource()
    const features: Feature[] = []
    const labels: LabelItem[] = []
    const color = this.color()
    const cand = this.finalMeasure ?? (s.tool.type === 'draw' || s.tool.type === 'measure' ? this.candidate() : null)
    const placed = this.finalMeasure ? this.finalMeasure.coords : this.pts
    if (cand && cand.coords.length) {
      const c = cand.coords
      if (cand.shape === 'polygon' && c.length >= 3) {
        features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...c, c[0]]] }, properties: { color } })
      } else if (c.length >= 2) {
        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: c }, properties: { color } })
      }
      const segs = cand.closed ? c.length : c.length - 1
      for (let i = 0; i < segs; i++) {
        const a = c[i]
        const b = c[(i + 1) % c.length]
        const d = distance(a, b)
        if (d > 0.05) labels.push({ id: `dm${i}`, at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], text: fmtLength(d), cls: 'measure' })
      }
      if (cand.shape === 'polygon' && c.length >= 3) {
        const ring = [...c, c[0]]
        labels.push({ id: 'dm-area', at: centroid({ type: 'Polygon', coordinates: [ring] }), text: `${fmtArea(polygonArea([ring]))}  ·  ⌀ ${fmtLength(lineLength(ring))}`, cls: 'total' })
      } else if (c.length >= 3) {
        labels.push({ id: 'dm-total', at: c[c.length - 1], text: `Σ ${fmtLength(lineLength(c))}`, cls: 'total' })
      }
    }
    placed.forEach((p) => features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { role: 'vertex', color } }))
    if (this.pts.length >= 3 && this.shapeFor() === 'polygon' && !this.finalMeasure)
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: this.pts[0] }, properties: { role: 'first', color } })
    if (this.anchor) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: this.anchor }, properties: { role: 'vertex', color } })
    const cal = s.calibration
    if (s.tool.type === 'calibrate' && cal) cal.geoPts.forEach((p) => features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { role: 'vertex', color: '#facc15' } }))
    if (this.snapMark) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: this.snapMark }, properties: { role: 'snap' } })
    src?.setData({ type: 'FeatureCollection', features } as FeatureCollection)
    this.onLabels?.(labels)
    this.updateHint()
  }

  onLabels?: (l: LabelItem[]) => void

  private updateHint() {
    const t = this.st().tool
    let hint = ''
    if (t.type === 'draw') {
      const g = kindDef(t.kind).geom
      const shape = this.shapeFor()
      hint = g === 'Point' ? 'Click to place · Esc to stop'
        : shape === 'rectangle' ? (this.anchor ? 'Click the opposite corner' : 'Click the first corner')
        : shape === 'circle' ? (this.anchor ? 'Click to set the radius' : 'Click the centre')
        : this.pts.length ? `Click to add points · double-click or Enter to finish${g === 'Polygon' ? ' · click first point to close' : ''} · Backspace undoes a point`
        : 'Click to start drawing · hold Alt to disable snapping'
    } else if (t.type === 'measure') {
      hint = this.finalMeasure ? 'Click to measure again · Esc to clear' : this.pts.length ? 'Double-click or Enter to finish · Esc to cancel' : t.mode === 'area' ? 'Click to outline an area' : 'Click to measure a distance'
    } else if (t.type === 'calibrate') {
      hint = 'Click the matching spot on the map'
    }
    if (useStatus.getState().hint !== hint) useStatus.setState({ hint })
  }

  // ------------------------------------------------------------------ keyboard
  private onKey(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
    const s = this.st()
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) s.redo()
      else s.undo()
    } else if (ctrl && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      s.redo()
    } else if (ctrl && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void flush()
    } else if (ctrl && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      if (s.selection.length) s.duplicateObjects(s.selection)
    } else if (e.key === 'Escape') {
      if (this.drag) {
        s.cancelGesture()
        this.drag = null
        this.map.dragPan.enable()
      } else if (this.pts.length || this.anchor || this.finalMeasure) this.resetDrawing()
      else if (s.tool.type !== 'select') s.setTool({ type: 'select' })
      else if (s.selection.length) s.setSelection([])
    } else if (e.key === 'Enter') {
      this.finish()
    } else if (e.key === 'Backspace' && (s.tool.type === 'draw' || s.tool.type === 'measure') && (this.pts.length || this.anchor)) {
      e.preventDefault()
      if (this.anchor) this.anchor = null
      else this.pts.pop()
      this.preview()
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.tool.type === 'select' && s.selection.length) {
      e.preventDefault()
      const unlocked = s.selection.filter((id) => s.doc.objects[id] && !this.isLocked(s.doc.objects[id]))
      if (unlocked.length) s.deleteObjects(unlocked)
    }
  }
}

function bboxAsPolygon(g: Geom): Geom {
  const [w, so, ea, no] = bbox(g)
  return { type: 'Polygon', coordinates: [[[w, so], [ea, so], [ea, no], [w, no], [w, so]]] }
}

