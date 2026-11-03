import type { Geom, Pos } from '../model/types'

// Mirrors backend/app/geo.py (same constants and formulas, so exports match what the editor shows).
const R_LEN = 6371008.8
const R_AREA = 6371007.2 // authalic radius: area-true on the sphere
const rad = (d: number) => (d * Math.PI) / 180

export function distance(a: Pos, b: Pos): number {
  const la1 = rad(a[1])
  const la2 = rad(b[1])
  const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(rad(b[0] - a[0]) / 2) ** 2
  return 2 * R_LEN * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function lineLength(c: Pos[]): number {
  let s = 0
  for (let i = 0; i < c.length - 1; i++) s += distance(c[i], c[i + 1])
  return s
}

export function ringArea(ring: Pos[]): number {
  let t = 0
  for (let i = 0; i < ring.length - 1; i++) {
    t += rad(ring[i + 1][0] - ring[i][0]) * (2 + Math.sin(rad(ring[i][1])) + Math.sin(rad(ring[i + 1][1])))
  }
  return (Math.abs(t) * R_AREA * R_AREA) / 2
}

export function polygonArea(rings: Pos[][]): number {
  if (!rings.length) return 0
  let a = ringArea(rings[0])
  for (let i = 1; i < rings.length; i++) a -= ringArea(rings[i])
  return Math.max(0, a)
}

/** Initial compass bearing a -> b in degrees [0, 360). */
export function bearing(a: Pos, b: Pos): number {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]))
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

export interface Measures {
  area: number // m²
  perimeter: number // m (polygon outline or line length)
  vertices: number
}

export function measureGeom(g: Geom): Measures {
  if (g.type === 'Polygon') return { area: polygonArea(g.coordinates), perimeter: lineLength(g.coordinates[0]), vertices: g.coordinates[0].length - 1 }
  if (g.type === 'LineString') return { area: 0, perimeter: lineLength(g.coordinates), vertices: g.coordinates.length }
  return { area: 0, perimeter: 0, vertices: 1 }
}

export function centroid(g: Geom): Pos {
  const pts = g.type === 'Point' ? [g.coordinates] : g.type === 'LineString' ? g.coordinates : g.coordinates[0].slice(0, -1)
  let x = 0
  let y = 0
  for (const p of pts) {
    x += p[0]
    y += p[1]
  }
  return [x / pts.length, y / pts.length]
}

/** Midpoint of the polyline by length: a good spot for a label. */
export function lineMidpoint(c: Pos[]): Pos {
  const half = lineLength(c) / 2
  let acc = 0
  for (let i = 0; i < c.length - 1; i++) {
    const d = distance(c[i], c[i + 1])
    if (acc + d >= half && d > 0) {
      const t = (half - acc) / d
      return [c[i][0] + (c[i + 1][0] - c[i][0]) * t, c[i][1] + (c[i + 1][1] - c[i][1]) * t]
    }
    acc += d
  }
  return c[0]
}

export function fmtLength(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`
  if (m >= 100) return `${m.toFixed(0)} m`
  return `${m.toFixed(m >= 10 ? 1 : 2)} m`
}

export function fmtArea(m2: number): string {
  if (m2 >= 10000) return `${(m2 / 10000).toFixed(2)} ha`
  return `${m2 >= 100 ? m2.toFixed(0) : m2.toFixed(1)} m²`
}

export function fmtAreaBoth(m2: number): string {
  return `${Math.round(m2).toLocaleString('en-US')} m² · ${(m2 / 10000).toFixed(3)} ha`
}
