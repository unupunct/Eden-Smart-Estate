import type { Geom, Pos } from '../model/types'

// Geometry editing in a local metric frame, so rotate/scale/circles are true to ground distances.
// The frame is an equirectangular projection around a pivot: accurate to well under 1 cm over a property.
const M_PER_DEG = 111195.0797 // pi/180 * 6371008.8: same sphere as distance()

export function toLocal(p: Pos, o: Pos): [number, number] {
  return [(p[0] - o[0]) * M_PER_DEG * Math.cos((o[1] * Math.PI) / 180), (p[1] - o[1]) * M_PER_DEG]
}
export function fromLocal(xy: [number, number], o: Pos): Pos {
  return [o[0] + xy[0] / (M_PER_DEG * Math.cos((o[1] * Math.PI) / 180)), o[1] + xy[1] / M_PER_DEG]
}

export function mapCoords(g: Geom, f: (p: Pos) => Pos): Geom {
  if (g.type === 'Point') return { type: 'Point', coordinates: f(g.coordinates) }
  if (g.type === 'LineString') return { type: 'LineString', coordinates: g.coordinates.map(f) }
  return { type: 'Polygon', coordinates: g.coordinates.map((r) => r.map(f)) }
}

/** Pivot = bounding-box centre, which stays put under rotation of simple shapes. */
export function pivotOf(g: Geom): Pos {
  const b = bbox(g)
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
}

export function bbox(g: Geom): [number, number, number, number] {
  const pts = g.type === 'Point' ? [g.coordinates] : g.type === 'LineString' ? g.coordinates : g.coordinates.flat()
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const p of pts) {
    if (p[0] < w) w = p[0]
    if (p[0] > e) e = p[0]
    if (p[1] < s) s = p[1]
    if (p[1] > n) n = p[1]
  }
  return [w, s, e, n]
}

export function translate(g: Geom, dLng: number, dLat: number): Geom {
  return mapCoords(g, (p) => [p[0] + dLng, p[1] + dLat])
}

/** Rotate clockwise by `deg` (compass sense) around the pivot. */
export function rotate(g: Geom, deg: number, pivot: Pos = pivotOf(g)): Geom {
  const a = (deg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return mapCoords(g, (p) => {
    const [x, y] = toLocal(p, pivot)
    // clockwise on a north-up map: x' = x cos + y sin, y' = -x sin + y cos
    return fromLocal([x * c + y * s, -x * s + y * c], pivot)
  })
}

export function scale(g: Geom, factor: number, pivot: Pos = pivotOf(g)): Geom {
  return mapCoords(g, (p) => {
    const [x, y] = toLocal(p, pivot)
    return fromLocal([x * factor, y * factor], pivot)
  })
}

export function circlePolygon(center: Pos, radiusM: number, steps = 48): Geom {
  const ring: Pos[] = []
  for (let i = 0; i < steps; i++) {
    const t = (2 * Math.PI * i) / steps
    ring.push(fromLocal([radiusM * Math.cos(t), radiusM * Math.sin(t)], center))
  }
  ring.push(ring[0])
  return { type: 'Polygon', coordinates: [ring] }
}

export function rectPolygon(a: Pos, b: Pos): Geom {
  const ring: Pos[] = [a, [b[0], a[1]], b, [a[0], b[1]], a]
  return { type: 'Polygon', coordinates: [ring] }
}

/** Closed outer ring without the repeated last point. */
export function openRing(g: Extract<Geom, { type: 'Polygon' }>): Pos[] {
  return g.coordinates[0].slice(0, -1)
}

export function polygonFrom(open: Pos[]): Geom {
  return { type: 'Polygon', coordinates: [[...open, open[0]]] }
}

/** The editable vertices of a geometry (outer ring only for polygons). */
export function vertices(g: Geom): Pos[] {
  if (g.type === 'Point') return [g.coordinates]
  if (g.type === 'LineString') return g.coordinates
  return openRing(g)
}

export function minVertices(g: Geom): number {
  return g.type === 'Polygon' ? 3 : g.type === 'LineString' ? 2 : 1
}

export function moveVertex(g: Geom, index: number, to: Pos): Geom {
  if (g.type === 'Point') return { type: 'Point', coordinates: to }
  if (g.type === 'LineString') return { type: 'LineString', coordinates: g.coordinates.map((p, i) => (i === index ? to : p)) }
  const open = openRing(g).map((p, i) => (i === index ? to : p))
  return { type: 'Polygon', coordinates: [[...open, open[0]], ...g.coordinates.slice(1)] }
}

/** Insert a vertex after `index` (between index and index+1; wraps for polygons). */
export function insertVertex(g: Geom, afterIndex: number, at: Pos): Geom {
  if (g.type === 'LineString') {
    const c = [...g.coordinates]
    c.splice(afterIndex + 1, 0, at)
    return { type: 'LineString', coordinates: c }
  }
  if (g.type === 'Polygon') {
    const open = openRing(g)
    open.splice(afterIndex + 1, 0, at)
    return { type: 'Polygon', coordinates: [[...open, open[0]], ...g.coordinates.slice(1)] }
  }
  return g
}

/** Returns the geometry without that vertex, or null if it would drop below the minimum. */
export function removeVertex(g: Geom, index: number): Geom | null {
  if (g.type === 'Point' || vertices(g).length <= minVertices(g)) return null
  if (g.type === 'LineString') return { type: 'LineString', coordinates: g.coordinates.filter((_, i) => i !== index) }
  const open = openRing(g).filter((_, i) => i !== index)
  return { type: 'Polygon', coordinates: [[...open, open[0]], ...g.coordinates.slice(1)] }
}

/** Edge midpoints used for the "drag to add a vertex" handles. */
export function midpoints(g: Geom): { at: Pos; after: number }[] {
  if (g.type === 'Point') return []
  const v = vertices(g)
  const n = g.type === 'Polygon' ? v.length : v.length - 1
  const out = []
  for (let i = 0; i < n; i++) {
    const a = v[i]
    const b = v[(i + 1) % v.length]
    out.push({ at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Pos, after: i })
  }
  return out
}

/** Offset a polyline into thin quads (one per segment), used for extruded fences and hedges in 3D. */
export function lineQuads(c: Pos[], widthM: number): Pos[][] {
  const quads: Pos[][] = []
  const o = c[0]
  for (let i = 0; i < c.length - 1; i++) {
    const [x1, y1] = toLocal(c[i], o)
    const [x2, y2] = toLocal(c[i + 1], o)
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) continue
    const nx = (-dy / len) * (widthM / 2)
    const ny = (dx / len) * (widthM / 2)
    const q: [number, number][] = [[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]]
    const ring = q.map((p) => fromLocal(p, o))
    quads.push([...ring, ring[0]])
  }
  return quads
}

/** Rotate a vector given in metres (x east, y north) - handy for the rotation handle. */
export function offsetFrom(origin: Pos, dxM: number, dyM: number): Pos {
  return fromLocal([dxM, dyM], origin)
}

export function angleBetween(center: Pos, p: Pos): number {
  const [x, y] = toLocal(p, center)
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360 // compass bearing
}

export function nearestOnSegment(p: [number, number], a: [number, number], b: [number, number]): { pt: [number, number]; t: number } {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
  return { pt: [a[0] + t * dx, a[1] + t * dy], t }
}
