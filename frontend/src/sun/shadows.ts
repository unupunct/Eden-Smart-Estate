// Geometric shadow model on flat ground. Everything runs in a local metric frame (x east, y north, metres) around an origin.
//
// Model (deliberately simple and stated in the docs):
//  * ground is flat; roofs are flat boxes at the object's height; tree crowns are cylinders from 30 % of the height to the top
//  * a point at height z casts its shadow z / tan(elevation) away from the sun
//  * every caster has a density (0..1): the share of sunlight it blocks. Buildings 1, fences 1, greenhouse glazing 0.4,
//    foliage depends on the season (leaves on / off) and on evergreen vs deciduous species
import polygonClipping from 'polygon-clipping'
import { centroid } from '../geo/measure'
import { fromLocal, toLocal, lineQuads } from '../geo/transform'
import { kindDef, num } from '../model/kinds'
import type { Doc, Pos } from '../model/types'
import type { LibraryIndex } from '../library/logic'
import { sunPosition } from './astro'
import { addDays, fromWall, toWall } from './tz'

export type XY = [number, number]

export type Shape =
  | { type: 'poly'; ring: XY[] } // convex or concave footprint, open ring
  | { type: 'disk'; c: XY; r: number }
  | { type: 'hull3'; pts: [number, number, number][] } // convex volume given by its corner points (pitched roofs)

export interface Caster {
  id: string
  kind: string
  density: number
  shape: Shape
  zb: number // bottom of the shading volume, metres
  zt: number // top
  bbox: [number, number, number, number] // footprint bbox
}

export const GLAZING_DENSITY = 0.4

/** 0 = bare, 1 = full leaf, for a date and latitude (northern hemisphere: leaves May-Sep, half in Apr and Oct). */
export function leafFactor(month: number, lat: number): number {
  const m = lat >= 0 ? month : ((month + 5) % 12) + 1 // flip the seasons in the southern hemisphere
  if (m >= 5 && m <= 9) return 1
  if (m === 4 || m === 10) return 0.5
  return 0
}

export type LeafMode = 'auto' | 'on' | 'off'

export const LEAF_ON_DENSITY = 0.75
export const LEAF_OFF_DENSITY = 0.2
export const EVERGREEN_DENSITY = 0.85

export function foliageDensity(evergreen: boolean, leaf: number): number {
  if (evergreen) return EVERGREEN_DENSITY
  return LEAF_OFF_DENSITY + (LEAF_ON_DENSITY - LEAF_OFF_DENSITY) * leaf
}

function bboxOf(pts: XY[]): Caster['bbox'] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
  for (const p of pts) {
    if (p[0] < a) a = p[0]
    if (p[0] > c) c = p[0]
    if (p[1] < b) b = p[1]
    if (p[1] > d) d = p[1]
  }
  return [a, b, c, d]
}

const toFinite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Direction of the longest side of the footprint's smallest enclosing rectangle, as a compass bearing in [0, 180). */
export function longAxisBearing(ring: XY[]): number {
  let best = { area: Infinity, bearing: 0 }
  for (let deg = 0; deg < 180; deg += 1) {
    const a = (deg * Math.PI) / 180
    const c = Math.cos(a), s = Math.sin(a)
    const us = ring.map(([x, y]) => x * c + y * s), vs = ring.map(([x, y]) => -x * s + y * c)
    const w = Math.max(...us) - Math.min(...us), h = Math.max(...vs) - Math.min(...vs)
    if (w * h < best.area - 1e-9) {
      const ang = w >= h ? deg : deg + 90
      best = { area: w * h, bearing: (((90 - ang) % 180) + 180) % 180 }
    }
  }
  return best.bearing
}

/**
 * A pitched roof as a convex volume. \`height\` is the overall height (to the ridge). The wall (eave) height is
 * \`eaveHeight\` if given, otherwise the roof rise is assumed: 25 % of the building's width for gable/hip, 30 % for mansard.
 * The ridge runs along \`roofOrientation\` (a compass bearing) or the long side. A shed roof is only modelled when its direction
 * is given (otherwise the building stays a box, which is the safe overestimate). Returns null for flat or unknown roofs.
 */
export function pitchedRoof(ring: XY[], height: number, props: Record<string, unknown>): { eave: number; pts: [number, number, number][] } | null {
  const type = typeof props.roofType === 'string' ? props.roofType : 'flat'
  if (!['gable', 'hip', 'mansard', 'shed'].includes(type) || height < 1.5 || ring.length < 3) return null
  const bearingProp = toFinite(props.roofOrientation)
  if (type === 'shed' && bearingProp === null) return null
  const b = (((bearingProp ?? longAxisBearing(ring)) % 360) * Math.PI) / 180
  const ux = Math.sin(b), uy = Math.cos(b) // ridge direction (x east, y north)
  const vx = Math.cos(b), vy = -Math.sin(b) // across the ridge
  const us = ring.map(([x, y]) => x * ux + y * uy), vs = ring.map(([x, y]) => x * vx + y * vy)
  const umin = Math.min(...us), umax = Math.max(...us), vmin = Math.min(...vs), vmax = Math.max(...vs)
  const span = vmax - vmin
  if (span < 1) return null
  const eaveGiven = toFinite(props.eaveHeight)
  const factor = type === 'shed' ? 0.15 : type === 'mansard' ? 0.3 : 0.25
  let rise = eaveGiven !== null ? height - Math.min(Math.max(eaveGiven, 0.3), height) : span * factor
  rise = Math.max(0, Math.min(rise, height * 0.6))
  if (rise < 0.2) return null
  const eave = height - rise
  const at = (u: number, v: number): XY => [u * ux + v * vx, u * uy + v * vy]
  const pts: [number, number, number][] = []
  if (type === 'shed') {
    ring.forEach(([x, y], i) => pts.push([x, y, eave + (rise * (vs[i] - vmin)) / span]))
  } else {
    ring.forEach(([x, y]) => pts.push([x, y, eave]))
    const inset = type === 'gable' ? 0 : Math.min(span / 2, (umax - umin) / 2)
    const vm = (vmin + vmax) / 2
    for (const u of [umin + inset, umax - inset]) {
      const [x, y] = at(u, vm)
      pts.push([x, y, height])
    }
  }
  return { eave, pts }
}

export interface CasterOptions {
  leaf: number // 0..1 foliage state for the date being analysed
  ix: LibraryIndex | null
}

/** Shading volumes for every visible object that has height. */
export function buildCasters(doc: Doc, origin: Pos, opts: CasterOptions): Caster[] {
  const layerVisible = new Map(doc.layers.map((l) => [l.id, l.visible]))
  const out: Caster[] = []
  const local = (p: Pos): XY => toLocal(p, origin)
  for (const o of Object.values(doc.objects)) {
    if (!layerVisible.get(o.layerId)) continue
    const def = kindDef(o.kind)
    const g = o.geometry
    if (def.extrude && g.type === 'Polygon') {
      const zt = num(o.props[def.extrude.heightProp], def.extrude.fallback)
      if (zt <= 0.05) continue
      const ring = g.coordinates[0].slice(0, -1).map(local)
      if (ring.length < 3) continue
      const density = o.kind === 'greenhouse' ? GLAZING_DENSITY : 1
      const roof = o.kind === 'building' ? pitchedRoof(ring, zt, o.props) : null
      if (roof) {
        out.push({ id: o.id, kind: o.kind, density, shape: { type: 'poly', ring }, zb: 0, zt: roof.eave, bbox: bboxOf(ring) })
        out.push({ id: o.id, kind: o.kind, density, shape: { type: 'hull3', pts: roof.pts }, zb: roof.eave, zt, bbox: bboxOf(ring) })
      } else {
        out.push({ id: o.id, kind: o.kind, density, shape: { type: 'poly', ring }, zb: def.extrude.base ?? 0, zt, bbox: bboxOf(ring) })
      }
    } else if (def.extrude && g.type === 'Point' && def.radiusProp) {
      const zt = num(o.props[def.extrude.heightProp], def.extrude.fallback)
      const r = Math.max(0.3, num(o.props[def.radiusProp], 2) / 2)
      const sp = opts.ix && typeof o.props.speciesId === 'string' ? opts.ix.plants.get(o.props.speciesId) : undefined
      const density = foliageDensity(sp?.leaf === 'evergreen', opts.leaf)
      const c = local(g.coordinates)
      out.push({ id: o.id, kind: o.kind, density, shape: { type: 'disk', c, r }, zb: zt * 0.3, zt, bbox: [c[0] - r, c[1] - r, c[0] + r, c[1] + r] })
    } else if (def.lineExtrude && g.type === 'LineString') {
      const zt = num(o.props[def.lineExtrude.heightProp], def.lineExtrude.fallback)
      if (zt <= 0.05) continue
      const density = o.kind === 'hedge' ? 0.8 : 1
      for (const ring of lineQuads(g.coordinates, Math.max(0.05, def.lineExtrude.widthM))) {
        const r = ring.slice(0, -1).map(local)
        out.push({ id: o.id, kind: o.kind, density, shape: { type: 'poly', ring: r }, zb: 0, zt, bbox: bboxOf(r) })
      }
    }
  }
  return out
}

// ------------------------------------------------------------------ sun vector

export interface SunVector {
  fx: number // ground displacement per metre of height (east)
  fy: number // north
  alt: number
  az: number
}

const MAX_FACTOR = 20 // ~2.9 deg elevation: lower than this the shadows are meaninglessly long

export function sunVector(az: number, alt: number): SunVector | null {
  if (alt <= 0.5) return null
  const f = Math.min(MAX_FACTOR, 1 / Math.tan((alt * Math.PI) / 180))
  const dir = ((az + 180) * Math.PI) / 180
  return { fx: f * Math.sin(dir), fy: f * Math.cos(dir), alt, az }
}

// ------------------------------------------------------------------ point test

function inPoly(p: XY, ring: XY[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function segCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const o = (p: XY, q: XY, r: XY) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b)
  return d1 * d2 < 0 && d3 * d4 < 0
}

function segDist(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1])
}

/** A caster's shadow swept between the ground displacement of its bottom (a) and top (b). */
export interface Swept {
  c: Caster
  ax: number
  ay: number
  bx: number
  by: number
  box: [number, number, number, number] // bbox of the whole swept shadow
  hull?: XY[] // projected outline of a convex 3D shape (pitched roofs)
}

function sweep(c: Caster, v: SunVector): Swept {
  if (c.shape.type === 'hull3') {
    const proj = hull(c.shape.pts.map(([x, y, z]) => [x + z * v.fx, y + z * v.fy] as XY))
    return { c, ax: 0, ay: 0, bx: 0, by: 0, box: bboxOf(proj), hull: proj }
  }
  const ax = c.zb * v.fx, ay = c.zb * v.fy, bx = c.zt * v.fx, by = c.zt * v.fy
  const [x0, y0, x1, y1] = c.bbox
  return { c, ax, ay, bx, by, box: [Math.min(x0 + ax, x0 + bx), Math.min(y0 + ay, y0 + by), Math.max(x1 + ax, x1 + bx), Math.max(y1 + ay, y1 + by)] }
}

function pointShadedBy(p: XY, s: Swept): boolean {
  if (s.hull) return inPoly(p, s.hull)
  const q0: XY = [p[0] - s.ax, p[1] - s.ay]
  const q1: XY = [p[0] - s.bx, p[1] - s.by]
  const sh = s.c.shape
  if (sh.type === 'hull3') return false
  if (sh.type === 'disk') return segDist(sh.c, q0, q1) <= sh.r
  if (inPoly(q0, sh.ring) || inPoly(q1, sh.ring)) return true
  const r = sh.ring
  for (let i = 0; i < r.length; i++) if (segCross(q0, q1, r[i], r[(i + 1) % r.length])) return true
  return false
}

/** Share of direct sunlight reaching a ground point (1 = full sun, 0 = fully shaded). Overlapping shade multiplies. */
export function lightAt(swept: Swept[], p: XY): number {
  let t = 1
  for (const s of swept) {
    if (p[0] < s.box[0] || p[0] > s.box[2] || p[1] < s.box[1] || p[1] > s.box[3]) continue
    if (pointShadedBy(p, s)) {
      t *= 1 - s.c.density
      if (t < 0.001) return 0
    }
  }
  return t
}

export const sweepAll = (casters: Caster[], v: SunVector): Swept[] => casters.map((c) => sweep(c, v))

// ------------------------------------------------------------------ shadow polygons for the map

function hull(points: XY[]): XY[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: XY[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: XY[] = []
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

function isConvex(r: XY[]): boolean {
  let sign = 0
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], c = r[(i + 2) % r.length]
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
    if (Math.abs(z) < 1e-9) continue
    const s = Math.sign(z)
    if (sign && s !== sign) return false
    sign = s
  }
  return true
}

const circlePts = (c: XY, r: number, n = 20): XY[] =>
  Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)] as XY)

/** Polygons (open rings) whose union is the swept shadow of a caster. */
function pieces(s: Swept): XY[][] {
  if (s.hull) return [s.hull]
  const sh = s.c.shape
  const moved = (ring: XY[], dx: number, dy: number) => ring.map((p) => [p[0] + dx, p[1] + dy] as XY)
  if (sh.type === 'hull3') return []
  if (sh.type === 'disk') return [hull([...moved(circlePts(sh.c, sh.r), s.ax, s.ay), ...moved(circlePts(sh.c, sh.r), s.bx, s.by)])]
  const ring = sh.ring
  if (isConvex(ring)) return [hull([...moved(ring, s.ax, s.ay), ...moved(ring, s.bx, s.by)])]
  const out: XY[][] = [moved(ring, s.ax, s.ay), moved(ring, s.bx, s.by)]
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length]
    out.push([[p[0] + s.ax, p[1] + s.ay], [q[0] + s.ax, q[1] + s.ay], [q[0] + s.bx, q[1] + s.by], [p[0] + s.bx, p[1] + s.by]])
  }
  return out
}

export interface ShadowGeoJSON {
  dense: GeoJSON.Feature[]
  light: GeoJSON.Feature[]
}

type MP = [number, number][][][]

function unionToFeatures(polys: XY[][], origin: Pos, cls: string): GeoJSON.Feature[] {
  if (!polys.length) return []
  const input = polys.map((r) => [[...r, r[0]]]) as unknown as polygonClipping.Geom[]
  let merged: MP
  try {
    merged = polygonClipping.union(input[0], ...input.slice(1)) as MP
  } catch {
    merged = input as unknown as MP // degenerate input: fall back to overlapping polygons rather than losing the shadow
  }
  return merged.map((poly) => ({
    type: 'Feature' as const,
    properties: { cls },
    geometry: { type: 'Polygon' as const, coordinates: poly.map((ring) => ring.map((p) => fromLocal([p[0], p[1]], origin))) },
  }))
}

/** Merged ground shadow, split into dense (solid objects, evergreens, summer crowns) and light (glazing, bare branches). */
export function shadowFeatures(casters: Caster[], v: SunVector | null, origin: Pos): ShadowGeoJSON {
  if (!v) return { dense: [], light: [] }
  const dense: XY[][] = []
  const light: XY[][] = []
  for (const s of sweepAll(casters, v)) (s.c.density >= 0.6 ? dense : light).push(...pieces(s))
  return { dense: unionToFeatures(dense, origin, 'dense'), light: unionToFeatures(light, origin, 'light') }
}

// ------------------------------------------------------------------ sun hours

export interface SunHourOptions {
  stepMin?: number
  minAlt?: number // sun below this elevation is not counted as useful light
  horizon?: (azimuthDeg: number) => number // skyline of the surrounding land: sun below it is hidden (terrain)
}

export const DEFAULT_MIN_ALT = 3

/**
 * Hours of direct sun reaching each sample point between dayStart and dayEnd (instants). Foliage counts by the share of
 * light it lets through, so a point under a summer tree gets a fraction of an hour per hour rather than zero.
 */
export function sunHours(casters: Caster[], points: XY[], dayStart: number, dayEnd: number, origin: Pos, opts: SunHourOptions = {}): number[] {
  const step = (opts.stepMin ?? 10) * 60000
  const minAlt = opts.minAlt ?? DEFAULT_MIN_ALT
  const acc = new Array<number>(points.length).fill(0)
  for (let t = dayStart + step / 2; t < dayEnd; t += step) {
    const s = sunPosition(t, origin[1], origin[0])
    if (s.alt < minAlt || (opts.horizon && s.alt < opts.horizon(s.az))) continue
    const v = sunVector(s.az, s.alt)
    if (!v) continue
    const swept = sweepAll(casters, v)
    const w = step / 3600000
    for (let i = 0; i < points.length; i++) acc[i] += lightAt(swept, points[i]) * w
  }
  return acc
}

/** The sun's own possible hours above the threshold (a flat, unobstructed horizon unless opts.horizon is given), for comparison. */
export function possibleHours(dayStart: number, dayEnd: number, origin: Pos, opts: SunHourOptions = {}): number {
  const step = (opts.stepMin ?? 10) * 60000
  const minAlt = opts.minAlt ?? DEFAULT_MIN_ALT
  let h = 0
  for (let t = dayStart + step / 2; t < dayEnd; t += step) {
    const s = sunPosition(t, origin[1], origin[0])
    if (s.alt >= minAlt && !(opts.horizon && s.alt < opts.horizon(s.az))) h += step / 3600000
  }
  return h
}

/** Evenly spaced sample points inside a polygon (local metres). Always returns at least one point. */
export function samplePolygon(ring: XY[], target = 60): XY[] {
  const box = bboxOf(ring)
  const area = Math.abs(ring.reduce((s, p, i) => {
    const q = ring[(i + 1) % ring.length]
    return s + (p[0] * q[1] - q[0] * p[1])
  }, 0)) / 2
  const step = Math.max(0.3, Math.min(4, Math.sqrt(area / target)))
  const pts: XY[] = []
  for (let x = box[0] + step / 2; x < box[2]; x += step) for (let y = box[1] + step / 2; y < box[3]; y += step) if (inPoly([x, y], ring)) pts.push([x, y])
  if (!pts.length) {
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length
    const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length
    pts.push([cx, cy])
  }
  return pts
}

export type LightClass = 'full' | 'part-sun' | 'part-shade' | 'shade'

/** Common horticultural rule of thumb: 6+ h full sun, 4-6 part sun, 2-4 part shade, under 2 shade. */
export function lightClass(hours: number): LightClass {
  if (hours >= 6) return 'full'
  if (hours >= 4) return 'part-sun'
  if (hours >= 2) return 'part-shade'
  return 'shade'
}

export const LIGHT_LABEL: Record<LightClass, string> = { full: 'Full sun', 'part-sun': 'Part sun', 'part-shade': 'Part shade', shade: 'Shade' }
export const LIGHT_COLOR: Record<LightClass, string> = { full: '#fbbf24', 'part-sun': '#a3e635', 'part-shade': '#38bdf8', shade: '#6366f1' }

/** Minimum direct-sun hours a library `sun` need asks for. */
export const SUN_NEED_HOURS: Record<'full' | 'full-part' | 'part' | 'shade', number> = { full: 6, 'full-part': 4, part: 3, shade: 0 }

// ------------------------------------------------------------------ seasons

export interface SeasonDay {
  key: 'mar' | 'jun' | 'sep' | 'dec'
  label: string
  month: number
  day: number
}

export const SEASON_DAYS: SeasonDay[] = [
  { key: 'mar', label: 'March equinox', month: 3, day: 20 },
  { key: 'jun', label: 'June solstice', month: 6, day: 21 },
  { key: 'sep', label: 'September equinox', month: 9, day: 22 },
  { key: 'dec', label: 'December solstice', month: 12, day: 21 },
]

/** The solstice nearest winter is not part of the growing season for the hemisphere. */
export function growingSeasonKeys(lat: number): SeasonDay['key'][] {
  return lat >= 0 ? ['mar', 'jun', 'sep'] : ['mar', 'sep', 'dec']
}

export function seasonDayStart(year: number, s: SeasonDay, tz: string): { start: number; end: number } {
  const start = fromWall({ y: year, mo: s.month, d: s.day, h: 0, mi: 0 }, tz)
  return { start, end: addDays(start, 1, tz) }
}

export const monthOf = (ms: number, tz: string) => toWall(ms, tz).mo

// ------------------------------------------------------------------ area analysis

export interface AreaSun {
  id: string
  mean: number
  min: number
  max: number
  fullShare: number // share of sample points with 6+ h
  samples: number
}

export function analyseAreas(
  doc: Doc, ids: string[], casters: Caster[], dayStart: number, dayEnd: number, origin: Pos, opts?: SunHourOptions,
): AreaSun[] {
  const out: AreaSun[] = []
  for (const id of ids) {
    const o = doc.objects[id]
    if (!o) continue
    let pts: XY[]
    if (o.geometry.type === 'Polygon') {
      const ring = o.geometry.coordinates[0].slice(0, -1).map((p) => toLocal(p, origin))
      pts = samplePolygon(ring)
    } else if (o.geometry.type === 'Point') pts = [toLocal(o.geometry.coordinates, origin)]
    else pts = [toLocal(centroid(o.geometry), origin)]
    const h = sunHours(casters, pts, dayStart, dayEnd, origin, opts)
    const mean = h.reduce((s, x) => s + x, 0) / h.length
    out.push({ id, mean, min: Math.min(...h), max: Math.max(...h), fullShare: h.filter((x) => x >= 6).length / h.length, samples: h.length })
  }
  return out
}

/** Whole-property grid of sun hours for the heat map. Cells are squares of `cell` metres inside the given ring (or the bbox). */
export interface HeatCell {
  ring: Pos[]
  hours: number
}

export function heatGrid(casters: Caster[], bounds: XY[], origin: Pos, dayStart: number, dayEnd: number, maxCells = 3500, opts?: SunHourOptions): { cells: HeatCell[]; cell: number } {
  const box = bboxOf(bounds)
  const w = box[2] - box[0], h = box[3] - box[1]
  const cell = Math.max(1, Math.ceil(Math.sqrt((w * h) / maxCells) * 2) / 2)
  const pts: XY[] = []
  const rings: Pos[][] = []
  for (let x = box[0]; x < box[2]; x += cell) {
    for (let y = box[1]; y < box[3]; y += cell) {
      const c: XY = [x + cell / 2, y + cell / 2]
      if (bounds.length >= 3 && !inPoly(c, bounds)) continue
      pts.push(c)
      const corners: XY[] = [[x, y], [x + cell, y], [x + cell, y + cell], [x, y + cell]]
      const g = corners.map((p) => fromLocal(p, origin))
      rings.push([...g, g[0]])
    }
  }
  const hours = sunHours(casters, pts, dayStart, dayEnd, origin, opts)
  return { cells: rings.map((ring, i) => ({ ring, hours: hours[i] })), cell }
}
