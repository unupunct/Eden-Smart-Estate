import * as maplibregl from 'maplibre-gl'
import { bbox, vertices } from '../geo/transform'
import { centroid, fmtArea, fmtLength, lineMidpoint, measureGeom, distance } from '../geo/measure'
import { noteView } from '../model/autosave'
import { kindDef } from '../model/kinds'
import { useEditor } from '../model/store'
import type { EdenObject, Pos, PropertyMeta } from '../model/types'
import { buildCameraWedges, buildExtrusions, buildHandles, buildObjectCollection, type LabelItem } from './features'
import { Interaction } from './interaction'
import { EMPTY, FIRST_EDEN_LAYER, installEdenLayers } from './layers'
import { applyBaseMap, installIcons, LabelLayer, syncOverlays, useStatus } from './support'

const metresPerPixel = (map: maplibregl.Map) => (78271.517 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / 2 ** map.getZoom()

export class EdenMap {
  readonly map: maplibregl.Map
  private objLabels: LabelLayer
  private drawLabels: LabelLayer
  private interaction!: Interaction
  private ready = false
  private unsub: () => void
  private raf = 0
  private last: Partial<ReturnType<typeof useEditor.getState>> = {}

  constructor(container: HTMLElement, p: PropertyMeta) {
    this.map = new maplibregl.Map({
      container,
      style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0c1114' } }] },
      center: p.center, zoom: p.zoom, bearing: p.bearing, pitch: p.pitch,
      maxZoom: 22, minZoom: 2, maxPitch: 75, attributionControl: false, dragRotate: false, pitchWithRotate: true, touchPitch: false,
      canvasContextAttributes: { antialias: true },
    })
    this.map.touchZoomRotate.disableRotation()
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 140 }), 'bottom-left')
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    this.objLabels = new LabelLayer(this.map)
    this.drawLabels = new LabelLayer(this.map)

    this.map.on('load', () => {
      installIcons(this.map)
      installEdenLayers(this.map)
      this.interaction = new Interaction(this.map, () => this.map.getSource('draw') as maplibregl.GeoJSONSource)
      this.interaction.onLabels = (l) => this.drawLabels.set(l)
      this.ready = true
      this.last = {}
      this.sync()
      this.onMoveEnd()
    })
    this.map.on('zoom', () => this.schedule())
    this.map.on('moveend', () => this.onMoveEnd())
    this.map.on('mousemove', (e) => useStatus.setState({ cursor: [e.lngLat.lng, e.lngLat.lat] }))
    this.unsub = useEditor.subscribe(() => this.schedule())
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    this.unsub()
    this.interaction?.destroy()
    this.map.remove()
  }

  private schedule() {
    if (!this.ready) return
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(() => this.sync())
  }

  private onMoveEnd() {
    const c = this.map.getCenter()
    useStatus.setState({ zoom: this.map.getZoom(), bearing: this.map.getBearing(), pitch: this.map.getPitch() })
    noteView({ center: [c.lng, c.lat], zoom: this.map.getZoom(), bearing: this.map.getBearing(), pitch: this.map.getPitch() })
  }

  private setData(id: string, data: GeoJSON.FeatureCollection) {
    ;(this.map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(data)
  }

  /** Reconcile the map with the store. Cheap checks first; only touch what changed. */
  private sync() {
    if (!this.ready) return
    const s = useEditor.getState()
    const l = this.last
    const docChanged = s.doc !== l.doc
    const selChanged = s.selection !== l.selection
    if (s.catalog && (s.catalog !== l.catalog || s.baseMap !== l.baseMap)) {
      applyBaseMap(this.map, s.catalog, s.baseMap, FIRST_EDEN_LAYER)
      syncOverlays(this.map, s.overlays, FIRST_EDEN_LAYER)
    } else if (s.overlays !== l.overlays) syncOverlays(this.map, s.overlays, FIRST_EDEN_LAYER)

    if (docChanged || selChanged || s.view3d !== l.view3d) {
      this.setData('eden', buildObjectCollection(s.doc, { selected: new Set(s.selection), view3d: s.view3d }))
    }
    if (docChanged || s.view3d !== l.view3d) {
      this.setData('ext', s.view3d ? buildExtrusions(s.doc) : EMPTY)
      this.setData('wedges', buildCameraWedges(s.doc))
    }
    if (s.view3d !== l.view3d) this.apply3d(s.view3d)
    this.updateHandles()
    if (docChanged || selChanged || s.tool !== l.tool || s.shape !== l.shape || s.calibration !== l.calibration) {
      if (s.tool !== l.tool || s.shape !== l.shape || s.calibration !== l.calibration) this.interaction.preview()
    }
    if (docChanged || selChanged) this.updateLabels()
    else if (Math.abs(this.map.getZoom() - (this.labelZoom ?? -1)) > 0.05) this.updateLabels()
    if (s.focusRequest && s.focusRequest !== l.focusRequest) this.focusObject(s.focusRequest.id)
    this.last = { ...s }
  }

  private apply3d(on: boolean) {
    this.map.setLayoutProperty('eden-extrusion', 'visibility', on ? 'visible' : 'none')
    if (on) {
      this.map.dragRotate.enable()
      this.map.touchPitch.enable()
      this.map.touchZoomRotate.enableRotation()
      this.map.easeTo({ pitch: 62, duration: 700 })
    } else {
      this.map.dragRotate.disable()
      this.map.touchPitch.disable()
      this.map.touchZoomRotate.disableRotation()
      this.map.easeTo({ pitch: 0, bearing: 0, duration: 600 })
    }
  }

  private updateHandles() {
    const s = useEditor.getState()
    const o = s.tool.type === 'select' && s.selection.length === 1 ? s.doc.objects[s.selection[0]] : undefined
    const layer = o && s.doc.layers.find((x) => x.id === o.layerId)
    this.setData('handles', layer?.locked ? EMPTY : buildHandles(o, metresPerPixel(this.map)))
  }

  private labelZoom: number | undefined

  private updateLabels() {
    const s = useEditor.getState()
    const z = this.map.getZoom()
    this.labelZoom = z
    const layers = new Map(s.doc.layers.map((l) => [l.id, l]))
    const sel = new Set(s.selection)
    const items: LabelItem[] = []
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = []
    const canvas = this.map.getCanvas()
    const rectOf = (at: Pos, text: string) => {
      const p = this.map.project(at)
      const lines = text.split('\n')
      const w = Math.max(...lines.map((l) => l.length)) * 6.3 + 12
      const h = lines.length * 14 + 6
      return { x0: p.x - w / 2, y0: p.y - h / 2, x1: p.x + w / 2, y1: p.y + h / 2, w, h }
    }
    const overlaps = (r: { x0: number; y0: number; x1: number; y1: number }) => placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)

    // 1. dimensions of the selection always show and reserve their space
    const forced: LabelItem[] = []
    if (s.selection.length === 1) forced.push(...this.selectionLabels(s.doc.objects[s.selection[0]]))
    else if (s.selection.length > 1) {
      let area = 0
      let len = 0
      for (const id of s.selection) {
        const o = s.doc.objects[id]
        if (!o) continue
        const m = measureGeom(o.geometry)
        area += m.area
        if (o.geometry.type === 'LineString') len += m.perimeter
      }
      const first = s.doc.objects[s.selection[0]]
      if (first) forced.push({ id: 'multi', at: centroid(first.geometry), text: `${s.selection.length} selected${area ? ` · ${fmtArea(area)}` : ''}${len ? ` · ${fmtLength(len)}` : ''}`, cls: 'total' })
    }
    for (const f of forced) {
      const r = rectOf(f.at, f.text)
      placed.push(r)
      items.push(f)
    }

    // 2. object names, most important first; skip what would collide or is too small to hold its label
    const PRIO: Record<string, number> = { building: 1, greenhouse: 1, pond: 1, zone: 2, orchard_area: 2, forest: 2, utility_area: 2, garden_bed: 3, pond_zone: 3, solar: 3 }
    interface Cand { id: string; at: Pos; text: string; prio: number; size: number; minW: number; minH: number }
    const cands: Cand[] = []
    for (const o of Object.values(s.doc.objects)) {
      if (!layers.get(o.layerId)?.visible || sel.has(o.id) || !o.name || o.kind === 'boundary') continue
      const g = o.geometry
      if (g.type === 'Point') {
        if (z < 18.6) continue
        cands.push({ id: `n${o.id}`, at: g.coordinates, text: o.name, prio: 6, size: 0, minW: 0, minH: 0 })
      } else if (g.type === 'Polygon') {
        if (z < 16.8) continue
        const m = measureGeom(g)
        const text = z >= 17.8 ? `${o.name} · ${fmtArea(m.area)}` : o.name
        const [w, so, e, n] = bbox(g)
        const a = this.map.project([w, n])
        const b = this.map.project([e, so])
        cands.push({ id: `n${o.id}`, at: centroid(g), text, prio: PRIO[o.kind] ?? 4, size: m.area, minW: Math.abs(b.x - a.x), minH: Math.abs(b.y - a.y) })
      } else {
        if (z < 18.4) continue
        cands.push({ id: `n${o.id}`, at: lineMidpoint(g.coordinates), text: o.name, prio: 5, size: 0, minW: 0, minH: 0 })
      }
    }
    cands.sort((x, y) => x.prio - y.prio || y.size - x.size)
    let budget = 220
    for (const c of cands) {
      if (budget <= 0) break
      const r = rectOf(c.at, c.text)
      if (r.x1 < -40 || r.y1 < -40 || r.x0 > canvas.clientWidth + 40 || r.y0 > canvas.clientHeight + 40) continue
      if (c.prio <= 4 && (c.minW < r.w * 0.55 || c.minH < 12)) continue
      if (overlaps(r)) continue
      placed.push(r)
      items.push({ id: c.id, at: c.at, text: c.text, cls: 'name' })
      budget--
    }
    // 3. edge lengths of the selected shape (drawn last: they are small and sit on the outline)
    this.objLabels.set(items)
  }

  private selectionLabels(o: EdenObject | undefined): LabelItem[] {
    if (!o) return []
    const out: LabelItem[] = []
    const g = o.geometry
    if (g.type === 'Point') {
      const c = g.coordinates
      out.push({ id: 'sel-name', at: c, text: o.name || kindDef(o.kind).label, cls: 'area' })
      return out
    }
    const v = vertices(g)
    const n = g.type === 'Polygon' ? v.length : v.length - 1
    if (n <= 60) {
      for (let i = 0; i < n; i++) {
        const a = v[i]
        const b = v[(i + 1) % v.length]
        const d = distance(a, b)
        if (d >= 0.3) out.push({ id: `e${i}`, at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], text: fmtLength(d), cls: 'edge' })
      }
    }
    const m = measureGeom(g)
    if (g.type === 'Polygon') out.push({ id: 'sel-area', at: centroid(g), text: `${o.name || kindDef(o.kind).label}\n${fmtArea(m.area)} · perimeter ${fmtLength(m.perimeter)}`, cls: 'area' })
    else out.push({ id: 'sel-area', at: lineMidpoint(g.coordinates), text: `${o.name || kindDef(o.kind).label} · ${fmtLength(m.perimeter)}`, cls: 'area' })
    return out
  }

  // ------------------------------------------------------------------ navigation api
  flyTo(center: Pos, zoom = 18) {
    this.map.flyTo({ center, zoom, duration: 1200 })
  }

  fitObjects(ids?: string[]) {
    const s = useEditor.getState()
    const objs = (ids ?? Object.keys(s.doc.objects)).map((id) => s.doc.objects[id]).filter(Boolean)
    if (!objs.length) return
    let w = Infinity, so = Infinity, e = -Infinity, n = -Infinity
    for (const o of objs) {
      const b = bbox(o.geometry)
      w = Math.min(w, b[0]); so = Math.min(so, b[1]); e = Math.max(e, b[2]); n = Math.max(n, b[3])
    }
    if (w === e && so === n) this.flyTo([w, so], 19.5)
    else this.map.fitBounds([[w, so], [e, n]], { padding: { top: 90, bottom: 90, left: 90, right: 90 }, maxZoom: 20, duration: 900 })
  }

  private focusObject(id: string) {
    this.fitObjects([id])
  }

  resize() {
    this.map.resize()
  }
}

export const mapRef: { current: EdenMap | null } = { current: null }
