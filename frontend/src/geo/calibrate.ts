import type { Pos } from '../model/types'
import { fromLocal } from './transform'

// Web Mercator helpers - calibration is done in mercator metres so straight lines on the image stay straight on the map.
const R = 6378137
export const toMerc = (p: Pos): [number, number] => [(R * p[0] * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (p[1] * Math.PI) / 360))]
export const fromMerc = (m: [number, number]): Pos => [(m[0] / R) * (180 / Math.PI), (2 * Math.atan(Math.exp(m[1] / R)) - Math.PI / 2) * (180 / Math.PI)]

/**
 * Two known points -> image corners (TL, TR, BR, BL) as a similarity transform
 * (uniform scale + rotation + shift; the image is not stretched).
 * imgPts are pixel coordinates (y down); geoPts are the matching ground positions.
 */
export function similarityCorners(imgPts: [number, number][], geoPts: Pos[], width: number, height: number): Pos[] {
  if (imgPts.length < 2 || geoPts.length < 2) throw new Error('Two matching points are needed')
  const z1 = { x: imgPts[0][0], y: -imgPts[0][1] }
  const z2 = { x: imgPts[1][0], y: -imgPts[1][1] }
  const dz = { x: z2.x - z1.x, y: z2.y - z1.y }
  const dzLen = dz.x * dz.x + dz.y * dz.y
  if (dzLen < 1) throw new Error('The two image points are too close together')
  const w1 = toMerc(geoPts[0])
  const w2 = toMerc(geoPts[1])
  const dw = { x: w2[0] - w1[0], y: w2[1] - w1[1] }
  if (dw.x * dw.x + dw.y * dw.y < 1e-6) throw new Error('The two map points are the same')
  // a = dw / dz (complex division)
  const a = { x: (dw.x * dz.x + dw.y * dz.y) / dzLen, y: (dw.y * dz.x - dw.x * dz.y) / dzLen }
  const map = (px: number, py: number): Pos => {
    const z = { x: px, y: -py }
    const rel = { x: z.x - z1.x, y: z.y - z1.y }
    return fromMerc([w1[0] + a.x * rel.x - a.y * rel.y, w1[1] + a.x * rel.y + a.y * rel.x])
  }
  return [map(0, 0), map(width, 0), map(width, height), map(0, height)]
}

/** Destination point from a start, compass bearing (deg) and ground distance (m). */
export function destination(p: Pos, bearingDeg: number, metres: number): Pos {
  const b = (bearingDeg * Math.PI) / 180
  return fromLocal([Math.sin(b) * metres, Math.cos(b) * metres], p)
}

/** Parse an ESRI world file (6 lines: A D B E C F). */
export function parseWorldFile(text: string): { a: number; d: number; b: number; e: number; c: number; f: number } {
  const v = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 6).map(Number)
  if (v.length < 6 || v.some((n) => !Number.isFinite(n))) throw new Error('Not a valid world file (needs 6 numbers)')
  const [a, d, b, e, c, f] = v
  if (a === 0 || e === 0) throw new Error('World file has a zero pixel size')
  return { a, d, b, e, c, f }
}

export function worldFileCorners(text: string, width: number, height: number, crs: 'EPSG:4326' | 'EPSG:3857'): Pos[] {
  const w = parseWorldFile(text)
  const pos = (px: number, py: number): Pos => {
    // world file refers to the centre of the top-left pixel
    const x = w.a * (px - 0.5) + w.b * (py - 0.5) + w.c
    const y = w.d * (px - 0.5) + w.e * (py - 0.5) + w.f
    return crs === 'EPSG:3857' ? fromMerc([x, y]) : [x, y]
  }
  const corners = [pos(0, 0), pos(width, 0), pos(width, height), pos(0, height)]
  if (corners.some((p) => Math.abs(p[0]) > 180 || Math.abs(p[1]) > 85)) throw new Error('Coordinates are outside the valid range - check the coordinate system')
  return corners
}
