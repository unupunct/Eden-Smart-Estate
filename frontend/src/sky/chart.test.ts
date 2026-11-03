import { describe, expect, it } from 'vitest'
import { figureSegments, moonlessDark, project, skyAt, skyColors } from './chart'
import { FIGURES, STAR_LIST } from './stars'

const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi)

describe('star list', () => {
  it('has unique ids, valid coordinates and brightness ordering sanity', () => {
    const ids = STAR_LIST.map((s) => s[0])
    expect(new Set(ids).size).toBe(ids.length)
    for (const [, , ra, dec, mag] of STAR_LIST) {
      expect(ra).toBeGreaterThanOrEqual(0)
      expect(ra).toBeLessThan(360)
      expect(Math.abs(dec)).toBeLessThanOrEqual(90)
      expect(mag).toBeLessThan(4.1)
    }
    expect(STAR_LIST.length).toBeGreaterThan(90)
    expect(STAR_LIST.find((s) => s[0] === 'sirius')![4]).toBeLessThan(-1.4)
  })
  it('every constellation figure points at stars that exist', () => {
    const have = new Set(STAR_LIST.map((s) => s[0]))
    for (const f of FIGURES) for (const chain of f.lines) for (const id of chain) expect(have.has(id), `${f.name}: ${id}`).toBe(true)
    expect(figureSegments().every((f) => f.segs.length > 0)).toBe(true)
  })
})

describe('sky positions', () => {
  const lat = 46.05
  const lng = 24.05
  it('Polaris stays within ~1 degree of the latitude in altitude and due north', () => {
    for (const h of [0, 5, 11, 17, 23]) {
      const p = skyAt(utc(2024, 11, 3, h), lat, lng).stars.find((s) => s.id === 'polaris')!
      expect(Math.abs(p.alt - lat)).toBeLessThan(1.2)
      expect(Math.min(p.az, 360 - p.az)).toBeLessThan(2)
    }
  })
  it('Sirius culminates at 90 - lat + dec = ~27 degrees', () => {
    let max = -90
    for (let m = 0; m < 1440; m += 5) max = Math.max(max, skyAt(utc(2024, 1, 15) + m * 60000, lat, lng).stars.find((s) => s.id === 'sirius')!.alt)
    expect(max).toBeGreaterThan(26.5)
    expect(max).toBeLessThan(28.3)
  })
  it('the Southern Cross never rises at this latitude, and Vega is circumpolar-ish high in summer', () => {
    let acruxMax = -90
    for (let m = 0; m < 1440; m += 20) acruxMax = Math.max(acruxMax, skyAt(utc(2024, 5, 1) + m * 60000, lat, lng).stars.find((s) => s.id === 'acrux')!.alt)
    expect(acruxMax).toBeLessThan(0)
    const vega = skyAt(utc(2024, 7, 15, 22), lat, lng).stars.find((s) => s.id === 'vega')!
    expect(vega.alt).toBeGreaterThan(60)
  })
  it('sidereal day: a star returns 4 minutes earlier each solar day', () => {
    const a = skyAt(utc(2024, 3, 1, 20), lat, lng).stars.find((s) => s.id === 'capella')!
    const b = skyAt(utc(2024, 3, 2, 19, 56), lat, lng).stars.find((s) => s.id === 'capella')!
    expect(Math.abs(a.alt - b.alt)).toBeLessThan(0.6)
    expect(Math.abs(a.az - b.az)).toBeLessThan(0.8)
  })
  it('lists five planets, the moon and the sun', () => {
    const s = skyAt(utc(2024, 11, 3, 20), lat, lng)
    expect(s.planets.map((p) => p.id)).toEqual(['mercury', 'venus', 'mars', 'jupiter', 'saturn'])
    expect(s.moon.illumination).toBeGreaterThanOrEqual(0)
    expect(s.sun.alt).toBeLessThan(0)
  })
})

describe('projection and colours', () => {
  it('puts the zenith in the centre, north up and east on the left', () => {
    expect(project(0, 90, 100, 100, 80)).toEqual([100, 100])
    const n = project(0, 0, 100, 100, 80)
    expect(n[0]).toBeCloseTo(100, 6)
    expect(n[1]).toBeCloseTo(20, 6)
    const e = project(90, 0, 100, 100, 80)
    expect(e[0]).toBeCloseTo(20, 6)
    expect(e[1]).toBeCloseTo(100, 6)
  })
  it('classifies twilight phases and fades stars in', () => {
    expect(skyColors(30).label).toBe('Daylight')
    expect(skyColors(-3).label).toBe('Civil twilight')
    expect(skyColors(-9).label).toBe('Nautical twilight')
    expect(skyColors(-15).label).toBe('Astronomical twilight')
    expect(skyColors(-30).label).toBe('Night')
    expect(skyColors(10).starVisibility).toBe(0)
    expect(skyColors(-30).starVisibility).toBe(1)
  })
})

describe('moonless darkness', () => {
  it('returns the stretch where the moon is down, or null when it is up all night', () => {
    const dusk = utc(2024, 11, 3, 18)
    const dawn = utc(2024, 11, 4, 5)
    const w = moonlessDark(dusk, dawn, (t) => (t < utc(2024, 11, 3, 23) ? 20 : -20))!
    expect(w.from).toBe(utc(2024, 11, 3, 23))
    expect(w.to).toBe(dawn)
    expect(moonlessDark(dusk, dawn, () => 30)).toBeNull()
    expect(moonlessDark(null, dawn, () => -30)).toBeNull()
  })
})
