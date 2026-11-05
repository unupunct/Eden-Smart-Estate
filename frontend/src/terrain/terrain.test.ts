import { describe, expect, it } from 'vitest'
import { incidence, possibleHours, sunHours, tiltGain } from '../sun/shadows'
import { elevationCells, groundAt, horizonAt, horizonFn, surfaceFn, type Terrain } from './terrain'

const profile = (f: (az: number) => number) => Array.from({ length: 36 }, (_, i) => ({ az: i * 10, alt: f(i * 10) }))

describe('horizonAt', () => {
  const h = profile((az) => (az === 90 ? 10 : 0))
  it('returns the stored value on the grid and interpolates between', () => {
    expect(horizonAt(h, 90)).toBe(10)
    expect(horizonAt(h, 85)).toBeCloseTo(5, 5)
    expect(horizonAt(h, 95)).toBeCloseTo(5, 5)
    expect(horizonAt(h, 200)).toBe(0)
  })
  it('wraps around north and accepts any angle', () => {
    const w = profile((az) => (az === 0 ? 8 : az === 350 ? 4 : 0))
    expect(horizonAt(w, 355)).toBeCloseTo(6, 5)
    expect(horizonAt(w, -5)).toBeCloseTo(6, 5)
    expect(horizonAt(w, 365)).toBeCloseTo(4, 5)
    expect(horizonAt([], 10)).toBe(0)
  })
  it('horizonFn is undefined without terrain data', () => {
    expect(horizonFn(null)).toBeUndefined()
    expect(horizonFn(undefined)).toBeUndefined()
  })
})

describe('terrain in the sun hours', () => {
  const origin: [number, number] = [24, 45]
  const day = Date.UTC(2025, 5, 21, 0, 0) - 2 * 3600000 // midsummer day in a UTC+2 zone, roughly local midnight
  const end = day + 86400000

  it('a wall of hills to the east takes the morning sun away', () => {
    const open = sunHours([], [[0, 0]], day, end, origin, { stepMin: 10 })[0]
    const hills = sunHours([], [[0, 0]], day, end, origin, { stepMin: 10, horizon: (az) => (az > 45 && az < 135 ? 25 : 0) })[0]
    expect(open).toBeGreaterThan(14)
    expect(hills).toBeLessThan(open - 1)
    expect(hills).toBeGreaterThan(open - 6)
  })
  it('a flat horizon changes nothing, and the possible hours follow the same rule', () => {
    const a = sunHours([], [[0, 0]], day, end, origin, { stepMin: 10 })[0]
    const b = sunHours([], [[0, 0]], day, end, origin, { stepMin: 10, horizon: () => 0 })[0]
    expect(b).toBeCloseTo(a, 6)
    const hide = { stepMin: 10, horizon: () => 90 }
    expect(possibleHours(day, end, origin, hide)).toBe(0)
    expect(sunHours([], [[0, 0]], day, end, origin, hide)[0]).toBe(0)
  })
})

describe('elevationCells', () => {
  const grid = (n: number, step: number, f: (r: number, c: number) => number) => ({ n, stepM: step, z: Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => f(r, c))) })
  const t = { center: [24, 45], local: grid(5, 90, (r) => 100 + r), region: grid(15, 300, (r) => 90 + r * 2) } as unknown as Terrain
  const fc = elevationCells(t)
  it('makes one square per grid point, local cells after (on top of) regional ones', () => {
    expect(fc.features.length).toBe(15 * 15 + 5 * 5)
    expect(fc.features[0].properties?.level).toBe('region')
    expect(fc.features[fc.features.length - 1].properties?.level).toBe('local')
  })
  it('colours by height relative to the whole area and keeps north up', () => {
    const rels = fc.features.map((f) => f.properties?.rel as number)
    expect(Math.min(...rels)).toBe(0)
    expect(Math.max(...rels)).toBe(1)
    const ring = (fc.features[0].geometry as GeoJSON.Polygon).coordinates[0]
    expect(ring[0]).toEqual(ring[4])
    const lat = ring.map((p) => p[1])
    expect(Math.max(...lat) - Math.min(...lat)).toBeCloseTo(300 / 110574, 6)
    expect(fc.features[0].properties?.z).toBe(90) // row 0 = north
  })
})

describe('ground tilt from the elevation grid', () => {
  const grid = (n: number, step: number, f: (east: number, north: number) => number) => {
    const half = (n - 1) / 2
    return { n, stepM: step, z: Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => f((c - half) * step, (half - r) * step))) }
  }
  const terr = (f: (e: number, n: number) => number, step = 30, n = 9) => ({ center: [24, 45], local: grid(n, step, f), region: grid(15, 300, f) }) as unknown as Terrain

  it('a slope rising to the north faces south, with the right angle', () => {
    const g = groundAt(terr((_e, n) => 100 + 0.1 * n), 0, 0)!
    expect(g.slopeDeg).toBeCloseTo((Math.atan(0.1) * 180) / Math.PI, 3)
    expect(g.aspectDeg).toBeCloseTo(180, 3)
  })
  it.each([[(e: number) => 100 + 0.08 * e, 270], [(e: number) => 100 - 0.08 * e, 90], [(_e: number, n: number) => 100 - 0.08 * n, 0]])('faces the way the ground falls (%#)', (f, deg) => {
    expect(groundAt(terr(f), 0, 0)!.aspectDeg).toBeCloseTo(deg, 3)
  })
  it('level ground and points outside the grid have no tilt', () => {
    expect(groundAt(terr(() => 100), 0, 0)).toBeNull()
    expect(groundAt(terr((_e, n) => n * 0.1), 5000, 0)).toBeNull()
  })
  it('a finer grid separates two slopes that a coarse one would blur', () => {
    const f = (e: number) => (e < 0 ? 100 + 0.15 * e : 100 - 0.15 * e) // a ridge line along north-south at x = 0: west side faces west, east side faces east
    const fine = terr(f, 30, 9)
    expect(groundAt(fine, -90, 0)!.aspectDeg).toBeCloseTo(270, 0)
    expect(groundAt(fine, 90, 0)!.aspectDeg).toBeCloseTo(90, 0)
  })
  it('surfaceFn shifts from the property origin to the rounded grid centre', () => {
    const t = terr((e) => 100 + 0.1 * e) // faces west everywhere: the shift must not break that
    const at = surfaceFn(t, [24.0004, 45.0003])!
    expect(at([0, 0])!.aspectDeg).toBeCloseTo(270, 3)
    expect(surfaceFn(null, [24, 45])).toBeUndefined()
  })
})

describe('sun on tilted ground', () => {
  const origin: [number, number] = [24, 45]
  const day = Date.UTC(2025, 2, 20, 0, 0) - 2 * 3600000 // equinox, roughly local midnight in UTC+2
  const end = day + 86400000
  const south = { slopeDeg: 15, aspectDeg: 180 }
  const north = { slopeDeg: 15, aspectDeg: 0 }

  it('the incidence of level ground is sin(elevation); a slope facing the sun gets more, one facing away less', () => {
    expect(incidence(undefined, 123, 30)).toBeCloseTo(0.5, 6)
    expect(incidence({ slopeDeg: 0, aspectDeg: 90 }, 123, 30)).toBeCloseTo(0.5, 6)
    expect(incidence(south, 180, 30)).toBeGreaterThan(0.5) // noon sun in the south on a south-facing slope
    expect(incidence(north, 180, 30)).toBeLessThan(0.5)
    expect(incidence(south, 180, 30)).toBeCloseTo(Math.sin(((30 + 15) * Math.PI) / 180), 6) // 15 deg tilt towards the sun adds 15 deg to the angle
  })
  it('at the equinox a south-facing slope gathers more direct light than level ground, a north-facing one less', () => {
    expect(tiltGain(day, end, origin, south)).toBeGreaterThan(1.1)
    expect(tiltGain(day, end, origin, north)).toBeLessThan(0.8)
    expect(tiltGain(day, end, origin, { slopeDeg: 0, aspectDeg: 0 })).toBeCloseTo(1, 6)
  })
  it('a steep slope facing away is in its own shade in the morning, and so has fewer sun hours', () => {
    const flat = sunHours([], [[0, 0]], day, end, origin, { stepMin: 10 })[0]
    const steepWest = sunHours([], [[0, 0]], day, end, origin, { stepMin: 10, surfaceAt: () => ({ slopeDeg: 50, aspectDeg: 270 }) })[0]
    expect(steepWest).toBeLessThan(flat - 3) // the morning sun is behind the slope
    expect(steepWest).toBeGreaterThan(2)
    expect(sunHours([], [[0, 0]], day, end, origin, { stepMin: 10, surfaceAt: () => undefined })[0]).toBeCloseTo(flat, 6)
  })
  it('the terrain skyline still hides the sun first', () => {
    expect(tiltGain(day, end, origin, south, { horizon: () => 90 })).toBe(1)
  })
})
