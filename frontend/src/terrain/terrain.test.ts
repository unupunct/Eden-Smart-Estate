import { describe, expect, it } from 'vitest'
import { possibleHours, sunHours } from '../sun/shadows'
import { elevationCells, horizonAt, horizonFn, type Terrain } from './terrain'

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
