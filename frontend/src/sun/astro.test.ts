import { describe, expect, it } from 'vitest'
import { compass, moonEvents, moonPosition, nextMoonPhase, planetPosition, precess, shadowVector, sunEvents, sunPosition } from './astro'
import { addDays, dayStart, fmtClock, fromWall, offsetMinutes, toWall } from './tz'

const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi)
const minutesOfDay = (ms: number) => ((ms % 86400000) / 60000)

describe('sun position', () => {
  it('declination is ~0 at the March equinox 2024 (20 Mar 03:06 UTC)', () => {
    const s = sunPosition(utc(2024, 3, 20, 3, 6), 0, 0)
    expect(Math.abs(s.dec)).toBeLessThan(0.05)
  })
  it('declination is about +23.44 at the June solstice and -23.44 in December', () => {
    expect(sunPosition(utc(2024, 6, 20, 21, 0), 0, 0).dec).toBeCloseTo(23.436, 1)
    expect(sunPosition(utc(2024, 12, 21, 9, 20), 0, 0).dec).toBeCloseTo(-23.436, 1)
  })
  it('noon altitude follows 90 - lat + dec', () => {
    const lat = 46.05
    const lng = 24.05
    const ev = sunEvents(utc(2024, 12, 20, 22, 0), lat, lng) // arbitrary 24 h window containing the noon of 21 Dec
    expect(ev.noonAlt).toBeCloseTo(90 - lat - 23.44, 1)
    const june = sunEvents(utc(2024, 6, 20, 21, 0), lat, lng)
    expect(june.noonAlt).toBeCloseTo(90 - lat + 23.44, 1)
  })
  it('sun is due south at solar noon in the northern mid-latitudes', () => {
    const lat = 46.05
    const lng = 24.05
    const ev = sunEvents(utc(2024, 4, 9, 21, 0), lat, lng)
    const s = sunPosition(ev.solarNoon, lat, lng)
    expect(Math.abs(s.az - 180)).toBeLessThan(0.3)
  })
  it('rises in the east and sets in the west near the equinox', () => {
    const lat = 46.05
    const lng = 24.05
    const ev = sunEvents(utc(2024, 3, 19, 22, 0), lat, lng)
    expect(Math.abs(sunPosition(ev.sunrise!, lat, lng).az - 90)).toBeLessThan(2.5)
    expect(Math.abs(sunPosition(ev.sunset!, lat, lng).az - 270)).toBeLessThan(2.5)
  })
})

describe('sunrise and sunset', () => {
  it('Greenwich, 21 June 2024: about 03:43 and 20:21 UTC', () => {
    const ev = sunEvents(utc(2024, 6, 21), 51.4779, 0)
    expect(Math.abs(minutesOfDay(ev.sunrise!) - (3 * 60 + 43))).toBeLessThan(3)
    expect(Math.abs(minutesOfDay(ev.sunset!) - (20 * 60 + 21))).toBeLessThan(3)
    expect(ev.dayLengthH).toBeCloseTo(16.63, 1)
  })
  it('Greenwich, 21 December 2024: about 08:04 and 15:53 UTC', () => {
    const ev = sunEvents(utc(2024, 12, 21), 51.4779, 0)
    expect(Math.abs(minutesOfDay(ev.sunrise!) - (8 * 60 + 4))).toBeLessThan(3)
    expect(Math.abs(minutesOfDay(ev.sunset!) - (15 * 60 + 53))).toBeLessThan(3)
  })
  it('day length is ~12 h at the equator all year', () => {
    expect(sunEvents(utc(2024, 3, 20), 0, 10).dayLengthH).toBeGreaterThan(11.9)
    expect(sunEvents(utc(2024, 3, 20), 0, 10).dayLengthH).toBeLessThan(12.25)
  })
  it('polar night and midnight sun are reported, not invented', () => {
    const tromsoWinter = sunEvents(utc(2024, 12, 21), 69.65, 18.96)
    expect(tromsoWinter.polar).toBe('night')
    expect(tromsoWinter.sunrise).toBeNull()
    expect(tromsoWinter.dayLengthH).toBe(0)
    const tromsoSummer = sunEvents(utc(2024, 6, 21), 69.65, 18.96)
    expect(tromsoSummer.polar).toBe('day')
    expect(tromsoSummer.dayLengthH).toBe(24)
  })
  it('twilights are ordered astronomical < nautical < civil < sunrise', () => {
    const ev = sunEvents(utc(2024, 9, 22, 21, 0), 46.05, 24.05)
    expect(ev.astroDawn!).toBeLessThan(ev.nauticalDawn!)
    expect(ev.nauticalDawn!).toBeLessThan(ev.civilDawn!)
    expect(ev.civilDawn!).toBeLessThan(ev.sunrise!)
  })
})

describe('shadow vector', () => {
  it('points away from the sun with length height / tan(elevation)', () => {
    const v = shadowVector(135, 45)!
    expect(v.dirDeg).toBeCloseTo(315, 6)
    expect(v.factor).toBeCloseTo(1, 6)
    expect(shadowVector(90, 30)!.factor).toBeCloseTo(1.7321, 3)
    expect(shadowVector(90, -1)).toBeNull()
  })
})

describe('time zones', () => {
  it('Bucharest is UTC+2 in winter and UTC+3 in summer', () => {
    expect(offsetMinutes('Europe/Bucharest', utc(2024, 1, 15, 12))).toBe(120)
    expect(offsetMinutes('Europe/Bucharest', utc(2024, 7, 15, 12))).toBe(180)
  })
  it('wall time converts both ways', () => {
    const t = fromWall({ y: 2024, mo: 7, d: 15, h: 14, mi: 30 }, 'Europe/Bucharest')
    expect(t).toBe(utc(2024, 7, 15, 11, 30))
    expect(toWall(t, 'Europe/Bucharest')).toEqual({ y: 2024, mo: 7, d: 15, h: 14, mi: 30 })
    expect(fmtClock(t, 'Europe/Bucharest')).toBe('14:30')
  })
  it('a local day has 23 h on the spring-forward date and addDays crosses it', () => {
    const d0 = dayStart(utc(2024, 3, 30, 12), 'Europe/Bucharest')
    const d1 = addDays(d0, 1, 'Europe/Bucharest')
    const d2 = addDays(d1, 1, 'Europe/Bucharest')
    expect((d2 - d1) / 3600000).toBe(23)
    expect((d1 - d0) / 3600000).toBe(24)
  })
  it('Bucharest sunrise on 21 June 2024 is ~05:27 local (UTC+3)', () => {
    const d = dayStart(utc(2024, 6, 21, 12), 'Europe/Bucharest')
    const ev = sunEvents(d, 44.4268, 26.1025)
    const mins = (ev.sunrise! - d) / 60000
    expect(Math.abs(mins - (5 * 60 + 27))).toBeLessThan(6)
  })
})

describe('moon', () => {
  it('is close to the sun at the 2024-04-08 eclipse (new moon)', () => {
    const t = utc(2024, 4, 8, 18, 20)
    const m = moonPosition(t, 30, -90)
    expect(m.illumination).toBeLessThan(0.01)
    const sep = Math.abs(((m.lon - sunPosition(t, 30, -90).lon + 540) % 360) - 180)
    expect(sep).toBeLessThan(1.5) // conjunction: moon and sun at (almost) the same longitude
  })
  it('is nearly full at the 2024-04-23 full moon', () => {
    const m = moonPosition(utc(2024, 4, 23, 23, 49), 46, 24)
    expect(m.illumination).toBeGreaterThan(0.99)
    expect(m.phaseName).toBe('Full moon')
  })
  it('is about half lit at first quarter (2024-04-15 19:13 UTC)', () => {
    const m = moonPosition(utc(2024, 4, 15, 19, 13), 46, 24)
    expect(m.illumination).toBeGreaterThan(0.45)
    expect(m.illumination).toBeLessThan(0.56)
    expect(m.waxing).toBe(true)
  })
  it('finds the next full and new moon within a few hours of the almanac', () => {
    const full = nextMoonPhase(utc(2024, 4, 10), 180)
    expect(Math.abs(full - utc(2024, 4, 23, 23, 49)) / 3600000).toBeLessThan(4)
    const nu = nextMoonPhase(utc(2024, 4, 9), 0)
    expect(Math.abs(nu - utc(2024, 5, 8, 3, 22)) / 3600000).toBeLessThan(4)
  })
  it('moon distance stays between perigee and apogee', () => {
    for (let i = 0; i < 40; i++) {
      const d = moonPosition(utc(2024, 1, 1) + i * 86400000 * 3, 46, 24).distKm
      expect(d).toBeGreaterThan(356000)
      expect(d).toBeLessThan(407000)
    }
  })
  it('rises and sets once a day at mid-latitudes', () => {
    const ev = moonEvents(utc(2024, 4, 24, 0), 46.05, 24.05)
    expect(ev.rise !== null || ev.set !== null).toBe(true)
  })
})

describe('planets', () => {
  const sep = (ra1: number, d1: number, ra2: number, d2: number) => {
    const r = Math.PI / 180
    const c = Math.sin(d1 * r) * Math.sin(d2 * r) + Math.cos(d1 * r) * Math.cos(d2 * r) * Math.cos((ra1 - ra2) * r)
    return Math.acos(Math.max(-1, Math.min(1, c))) / r
  }
  it('Jupiter and Saturn were in conjunction on 21 Dec 2020 (~0.1 deg apart)', () => {
    const t = utc(2020, 12, 21, 18)
    const j = planetPosition('jupiter', t, 46, 24)
    const s = planetPosition('saturn', t, 46, 24)
    expect(sep(j.ra, j.dec, s.ra, s.dec)).toBeLessThan(0.6)
  })
  it('Mars was at opposition on 13 Oct 2020 (elongation ~180)', () => {
    expect(planetPosition('mars', utc(2020, 10, 13, 23), 46, 24).elongation).toBeGreaterThan(178)
  })
  it('Venus reached greatest eastern elongation ~46 deg on 24 Mar 2020', () => {
    const e = planetPosition('venus', utc(2020, 3, 24), 46, 24).elongation
    expect(e).toBeGreaterThan(45)
    expect(e).toBeLessThan(47.5)
  })
  it('Mercury never strays more than 28 deg from the sun', () => {
    let max = 0
    for (let i = 0; i < 200; i++) max = Math.max(max, planetPosition('mercury', utc(2024, 1, 1) + i * 86400000, 46, 24).elongation)
    expect(max).toBeLessThan(28.5)
    expect(max).toBeGreaterThan(17)
  })
})

describe('misc', () => {
  it('precession moves RA by about 0.3-0.4 deg over 26 years', () => {
    const p = precess(0, 0, utc(2026, 1, 1))
    expect(p.ra).toBeGreaterThan(0.3)
    expect(p.ra).toBeLessThan(0.45)
  })
  it('compass names', () => {
    expect(compass(0)).toBe('N')
    expect(compass(92)).toBe('E')
    expect(compass(181)).toBe('S')
    expect(compass(359)).toBe('N')
  })
})
