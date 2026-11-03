import { describe, expect, it } from 'vitest'
import { destination, fromMerc, parseWorldFile, similarityCorners, toMerc, worldFileCorners } from './calibrate'
import { bearing, distance, fmtArea, fmtLength, lineLength, lineMidpoint, measureGeom, polygonArea } from './measure'
import { circlePolygon, insertVertex, lineQuads, midpoints, moveVertex, openRing, removeVertex, rotate, scale, translate, vertices } from './transform'
import type { Geom, Pos } from '../model/types'

const sq: Geom = { type: 'Polygon', coordinates: [[[24, 45], [24.001, 45], [24.001, 45.001], [24, 45.001], [24, 45]]] }

describe('measurements', () => {
  it('matches known distances', () => {
    expect(distance([0, 0], [1, 0])).toBeCloseTo(111195, -2) // 1 degree of longitude at the equator
    expect(distance([24, 45], [24, 45.001])).toBeCloseTo(111.2, 0)
  })
  it('computes area of a 0.001° square at 45°N (~8.76e3 m²)', () => {
    const a = measureGeom(sq).area
    expect(a).toBeGreaterThan(8700)
    expect(a).toBeLessThan(8800)
  })
  it('area is orientation independent and subtracts holes', () => {
    const outer = (sq as Extract<Geom, { type: 'Polygon' }>).coordinates[0]
    const rev = [...outer].reverse()
    expect(polygonArea([rev])).toBeCloseTo(polygonArea([outer]), 6)
    const hole: Pos[] = [[24.0002, 45.0002], [24.0004, 45.0002], [24.0004, 45.0004], [24.0002, 45.0004], [24.0002, 45.0002]]
    expect(polygonArea([outer, hole])).toBeLessThan(polygonArea([outer]))
  })
  it('perimeter, line length, bearing, midpoint', () => {
    expect(measureGeom(sq).perimeter).toBeCloseTo(2 * (78.7 + 111.2), -1)
    const line: Pos[] = [[24, 45], [24, 45.001], [24.001, 45.001]]
    expect(lineLength(line)).toBeCloseTo(111.2 + 78.7, -1)
    expect(bearing([24, 45], [24, 45.01])).toBeCloseTo(0, 3)
    expect(bearing([24, 45], [24.01, 45])).toBeCloseTo(90, 0)
    const mid = lineMidpoint([[24, 45], [24.002, 45]])
    expect(mid[0]).toBeCloseTo(24.001, 6)
  })
  it('formats with sensible units', () => {
    expect(fmtLength(5.234)).toBe('5.23 m')
    expect(fmtLength(1500)).toBe('1.50 km')
    expect(fmtArea(250)).toBe('250 m²')
    expect(fmtArea(25000)).toBe('2.50 ha')
  })
})

describe('transforms', () => {
  it('rotate keeps area and distances, and 360° is identity', () => {
    const r = rotate(sq, 37)
    expect(measureGeom(r).area).toBeCloseTo(measureGeom(sq).area, 0)
    expect(measureGeom(r).perimeter).toBeCloseTo(measureGeom(sq).perimeter, 1)
    const full = rotate(sq, 360)
    ;(full as Extract<Geom, { type: 'Polygon' }>).coordinates[0].forEach((p, i) => {
      expect(p[0]).toBeCloseTo((sq as Extract<Geom, { type: 'Polygon' }>).coordinates[0][i][0], 8)
    })
  })
  it('rotation is clockwise: a point east of the pivot moves south at 90°', () => {
    const g: Geom = { type: 'LineString', coordinates: [[24, 45], [24.001, 45]] }
    const r = rotate(g, 90, [24, 45]) as Extract<Geom, { type: 'LineString' }>
    expect(r.coordinates[1][1]).toBeLessThan(45)
    expect(r.coordinates[1][0]).toBeCloseTo(24, 6)
  })
  it('scale multiplies area by factor²', () => {
    expect(measureGeom(scale(sq, 2)).area / measureGeom(sq).area).toBeCloseTo(4, 2)
  })
  it('translate moves without distorting', () => {
    expect(measureGeom(translate(sq, 0.01, 0.01)).area).toBeCloseTo(measureGeom(sq).area, -1)
  })
  it('circle has the requested radius and area', () => {
    const c = circlePolygon([24, 45], 10, 64)
    expect(measureGeom(c).area).toBeCloseTo(Math.PI * 100, -1)
  })
})

describe('vertex editing', () => {
  it('insert, move and remove vertices on polygons', () => {
    const ins = insertVertex(sq, 0, [24.0005, 44.9999])
    expect(vertices(ins)).toHaveLength(5)
    expect(vertices(ins)[1]).toEqual([24.0005, 44.9999])
    const moved = moveVertex(sq, 2, [24.002, 45.002])
    expect(vertices(moved)[2]).toEqual([24.002, 45.002])
    // ring stays closed
    const ring = (moved as Extract<Geom, { type: 'Polygon' }>).coordinates[0]
    expect(ring[0]).toEqual(ring[ring.length - 1])
    expect(removeVertex(ins, 1)).not.toBeNull()
    expect(removeVertex(sq, 0)).not.toBeNull() // 4 -> 3 is fine
    expect(removeVertex(removeVertex(sq, 0)!, 0)).toBeNull() // a triangle cannot lose a corner
  })
  it('lines keep at least two points', () => {
    const l: Geom = { type: 'LineString', coordinates: [[0, 0], [1, 1]] }
    expect(removeVertex(l, 0)).toBeNull()
    expect(removeVertex(insertVertex(l, 0, [0.5, 0.5]), 1)).not.toBeNull()
  })
  it('midpoints cover every edge of a polygon and n-1 of a line', () => {
    expect(midpoints(sq)).toHaveLength(4)
    expect(midpoints({ type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 2]] })).toHaveLength(2)
    expect(openRing(sq as Extract<Geom, { type: 'Polygon' }>)).toHaveLength(4)
  })
  it('lineQuads makes one thin quad per segment with the requested width', () => {
    const q = lineQuads([[24, 45], [24.001, 45], [24.001, 45.001]], 0.5)
    expect(q).toHaveLength(2)
    const w = distance(q[0][0], q[0][3])
    expect(w).toBeCloseTo(0.5, 2)
  })
})

describe('image calibration', () => {
  it('two-point similarity maps the picked points exactly and keeps the aspect ratio', () => {
    const img: [number, number][] = [[100, 100], [500, 100]]
    const geo: Pos[] = [[24.0, 45.0], [24.002, 45.0]]
    const c = similarityCorners(img, geo, 600, 400)
    // 400 px span 0.002° so 600 px width spans 0.003°
    expect(c[0][0]).toBeCloseTo(24.0 - 0.0005, 6)
    expect(c[1][0]).toBeCloseTo(24.0 + 0.0025, 6)
    // image y grows downwards -> bottom corners are south of the top ones
    expect(c[3][1]).toBeLessThan(c[0][1])
    // aspect ratio preserved (in mercator metres)
    const tl = toMerc(c[0]), tr = toMerc(c[1]), bl = toMerc(c[3])
    expect(Math.hypot(bl[0] - tl[0], bl[1] - tl[1]) / Math.hypot(tr[0] - tl[0], tr[1] - tl[1])).toBeCloseTo(400 / 600, 6)
  })
  it('handles rotated images', () => {
    const c = similarityCorners([[0, 0], [100, 0]], [[24, 45], [24, 45.001]], 100, 100) // picture x-axis points north
    expect(c[1][1]).toBeGreaterThan(c[0][1])
    expect(c[1][0]).toBeCloseTo(c[0][0], 7)
  })
  it('rejects degenerate input', () => {
    expect(() => similarityCorners([[0, 0], [0, 0]], [[24, 45], [24.1, 45]], 10, 10)).toThrow()
    expect(() => similarityCorners([[0, 0], [5, 5]], [[24, 45], [24, 45]], 10, 10)).toThrow()
  })
  it('destination point is the requested distance away on the requested bearing', () => {
    const d = destination([24, 45], 90, 100)
    expect(distance([24, 45], d)).toBeCloseTo(100, 1)
    expect(bearing([24, 45], d)).toBeCloseTo(90, 1)
  })
  it('mercator round-trips', () => {
    const p: Pos = [24.2330, 45.7050]
    const r = fromMerc(toMerc(p))
    expect(r[0]).toBeCloseTo(p[0], 9)
    expect(r[1]).toBeCloseTo(p[1], 9)
  })
  it('world files: degrees and web mercator', () => {
    const wf = '0.00001\n0\n0\n-0.00001\n24.0\n45.001\n'
    expect(parseWorldFile(wf).a).toBe(0.00001)
    const c = worldFileCorners(wf, 100, 100, 'EPSG:4326')
    expect(c[0][0]).toBeCloseTo(24.0 - 0.000005, 7)
    expect(c[2][0]).toBeGreaterThan(c[0][0])
    expect(c[2][1]).toBeLessThan(c[0][1])
    const m = toMerc([24, 45])
    const wm = `1\n0\n0\n-1\n${m[0]}\n${m[1]}`
    const cm = worldFileCorners(wm, 10, 10, 'EPSG:3857')
    expect(cm[0][0]).toBeCloseTo(24, 4)
    expect(() => worldFileCorners('1\n0\n0\n-1\n500000\n5000000', 10, 10, 'EPSG:4326')).toThrow()
    expect(() => parseWorldFile('nope')).toThrow()
  })
})
