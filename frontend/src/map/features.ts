import type { Feature, FeatureCollection } from 'geojson'
import { kindDef, num } from '../model/kinds'
import { displayColor, sortedLayers } from '../model/ops'
import type { Doc, EdenObject, Geom, Pos } from '../model/types'
import { circlePolygon, lineQuads, midpoints, offsetFrom, pivotOf, vertices } from '../geo/transform'
import { centroid, measureGeom } from '../geo/measure'

const M_PER_PX_Z0 = 78271.517 // MapLibre uses 512px tiles

/** Metres -> pixel size at zoom 0 for a given latitude. Exponential(2) zoom interpolation then scales it exactly. */
export function px0(metres: number, lat: number): number {
  return metres / (M_PER_PX_Z0 * Math.cos((lat * Math.PI) / 180))
}

export interface BuildOptions {
  selected: ReadonlySet<string>
  view3d: boolean
}

type FProps = Record<string, string | number | boolean>

function feat(geometry: Geom, properties: FProps): Feature {
  return { type: 'Feature', geometry: geometry as Feature['geometry'], properties }
}

/** Turn the document into the single GeoJSON collection the map renders. Hidden layers are omitted entirely. */
export function buildObjectCollection(doc: Doc, opts: BuildOptions): FeatureCollection {
  const layers = sortedLayers(doc.layers)
  const layerIndex = new Map(layers.map((l, i) => [l.id, i]))
  const byId = new Map(layers.map((l) => [l.id, l]))
  const features: Feature[] = []
  let seq = 0
  for (const o of Object.values(doc.objects)) {
    const layer = byId.get(o.layerId)
    if (!layer || !layer.visible) continue
    const def = kindDef(o.kind)
    const color = displayColor(o, layer)
    const lat = centroid(o.geometry)[1]
    const li = layerIndex.get(o.layerId) ?? 0
    const base: FProps = {
      id: o.id, kind: o.kind, color, locked: layer.locked, selected: opts.selected.has(o.id),
      sort: li * 100000 + seq++, // later layers draw on top, then creation order
      fh: def.hitFill === false ? 0 : 1,
    }
    if (o.geometry.type === 'Polygon') {
      const area = measureGeom(o.geometry).area
      features.push(feat(o.geometry, {
        ...base, fillOpacity: def.fillOpacity ?? 0.3, lineWidth: def.lineWidth ?? 2, dashed: !!def.dashed, area,
      }))
    } else if (o.geometry.type === 'LineString') {
      const widthM = def.widthProp ? num(o.props[def.widthProp], 2) : 0
      features.push(feat(o.geometry, {
        ...base, lineWidth: def.lineWidth ?? 2, dashed: !!def.dashed, wpx: widthM ? px0(widthM, lat) : 0, widthM,
      }))
    } else {
      const radius = def.radiusProp ? num(o.props[def.radiusProp], 0) / 2 : 0
      features.push(feat(o.geometry, {
        ...base, icon: `ic-${o.kind}`, rpx: radius > 0 ? px0(radius, lat) : 0, radiusM: radius,
        rotation: o.kind === 'camera' ? num(o.props.direction, 0) : 0,
      }))
    }
  }
  return { type: 'FeatureCollection', features }
}

/** 3D-only geometry: extruded polygons for buildings, tree crowns, fences, hedges. Same objects, no second dataset. */
export function buildExtrusions(doc: Doc): FeatureCollection {
  const byId = new Map(doc.layers.map((l) => [l.id, l]))
  const features: Feature[] = []
  for (const o of Object.values(doc.objects)) {
    const layer = byId.get(o.layerId)
    if (!layer?.visible) continue
    const def = kindDef(o.kind)
    const color = displayColor(o, layer)
    if (def.extrude && o.geometry.type === 'Polygon') {
      const h = num(o.props[def.extrude.heightProp], def.extrude.fallback)
      features.push(feat(o.geometry, { id: o.id, color: def.extrude.color ?? color, h, base: def.extrude.base ?? 0 }))
    } else if (def.extrude && o.geometry.type === 'Point' && def.radiusProp) {
      const h = num(o.props[def.extrude.heightProp], def.extrude.fallback)
      const r = Math.max(0.3, num(o.props[def.radiusProp], 2) / 2)
      const trunkH = h * 0.4
      features.push(feat(circlePolygon(o.geometry.coordinates, Math.min(0.25, r * 0.15) + 0.1, 8), { id: o.id, color: '#7a5a3a', h: trunkH, base: 0 }))
      features.push(feat(circlePolygon(o.geometry.coordinates, r, 20), { id: o.id, color, h, base: trunkH }))
    } else if (def.lineExtrude && o.geometry.type === 'LineString') {
      const h = num(o.props[def.lineExtrude.heightProp], def.lineExtrude.fallback)
      for (const ring of lineQuads(o.geometry.coordinates, def.lineExtrude.widthM)) {
        features.push(feat({ type: 'Polygon', coordinates: [ring] }, { id: o.id, color, h, base: 0 }))
      }
    }
  }
  return { type: 'FeatureCollection', features }
}

/** Selection handles for a single selected object: vertices, edge midpoints and a rotation grip. */
export function buildHandles(o: EdenObject | undefined, metresPerPixel: number): FeatureCollection {
  const features: Feature[] = []
  if (!o || o.geometry.type === 'Point') return { type: 'FeatureCollection', features }
  const g = o.geometry
  vertices(g).forEach((p, i) => features.push(feat({ type: 'Point', coordinates: p }, { role: 'vertex', index: i })))
  midpoints(g).forEach((m) => features.push(feat({ type: 'Point', coordinates: m.at }, { role: 'mid', index: m.after })))
  const c = pivotOf(g)
  const top = Math.max(...vertices(g).map((p) => p[1]))
  const grip = offsetFrom([c[0], top], 0, 34 * metresPerPixel)
  features.push(feat({ type: 'LineString', coordinates: [[c[0], top], grip] }, { role: 'stem' }))
  features.push(feat({ type: 'Point', coordinates: grip }, { role: 'rotate' }))
  return { type: 'FeatureCollection', features }
}

export interface LabelItem {
  id: string
  at: Pos
  text: string
  cls: 'name' | 'edge' | 'area' | 'total' | 'measure'
}

/** Camera field-of-view wedge, drawn on the map for selected or all cameras. */
export function cameraWedge(o: EdenObject): Geom | null {
  if (o.kind !== 'camera' || o.geometry.type !== 'Point') return null
  const dir = num(o.props.direction, 0)
  const fov = Math.max(5, Math.min(360, num(o.props.fov, 90)))
  const range = Math.max(1, num(o.props.range, 30))
  const c = o.geometry.coordinates
  const ring: Pos[] = [c]
  const steps = Math.max(2, Math.round(fov / 8))
  for (let i = 0; i <= steps; i++) {
    const a = ((dir - fov / 2 + (fov * i) / steps) * Math.PI) / 180
    ring.push(offsetFrom(c, Math.sin(a) * range, Math.cos(a) * range))
  }
  ring.push(c)
  return { type: 'Polygon', coordinates: [ring] }
}

export function buildCameraWedges(doc: Doc): FeatureCollection {
  const byId = new Map(doc.layers.map((l) => [l.id, l]))
  const features: Feature[] = []
  for (const o of Object.values(doc.objects)) {
    if (!byId.get(o.layerId)?.visible) continue
    const w = cameraWedge(o)
    if (w) features.push(feat(w, { id: o.id }))
  }
  return { type: 'FeatureCollection', features }
}
