import { equatorialToHorizontal, moonPosition, PLANET_IDS, planetPosition, precess, sunPosition, type MoonInfo, type PlanetId } from '../sun/astro'
import { FIGURES, STAR_LIST } from './stars'

export interface SkyStar {
  id: string
  name: string
  az: number
  alt: number
  mag: number
}

export interface SkyPlanet {
  id: PlanetId
  az: number
  alt: number
  elongation: number
}

export interface SkyState {
  stars: SkyStar[]
  planets: SkyPlanet[]
  moon: MoonInfo
  sun: { az: number; alt: number }
}

export function skyAt(ms: number, lat: number, lng: number): SkyState {
  const stars = STAR_LIST.map(([id, name, ra, dec, mag]) => {
    const p = precess(ra, dec, ms)
    const h = equatorialToHorizontal(p.ra, p.dec, ms, lat, lng)
    return { id, name, az: h.az, alt: h.alt, mag }
  })
  const planets = PLANET_IDS.map((id) => {
    const p = planetPosition(id, ms, lat, lng)
    return { id, az: p.az, alt: p.alt, elongation: p.elongation }
  })
  const s = sunPosition(ms, lat, lng)
  return { stars, planets, moon: moonPosition(ms, lat, lng), sun: { az: s.az, alt: s.alt } }
}

/** Figure segments as pairs of star ids that both exist in the list. */
export function figureSegments(): { name: string; segs: [string, string][] }[] {
  const have = new Set(STAR_LIST.map((s) => s[0]))
  return FIGURES.map((f) => ({
    name: f.name,
    segs: f.lines.flatMap((chain) => chain.slice(1).map((id, i) => [chain[i], id] as [string, string])).filter(([a, b]) => have.has(a) && have.has(b)),
  }))
}

/** Azimuthal equidistant projection of the dome: zenith in the centre, north up, east to the LEFT (as when looking up). */
export function project(az: number, alt: number, cx: number, cy: number, radius: number): [number, number] {
  const r = ((90 - alt) / 90) * radius
  const a = (az * Math.PI) / 180
  return [cx - r * Math.sin(a), cy - r * Math.cos(a)]
}

/** Sky background from the sun's altitude: day, civil, nautical, astronomical twilight, night. */
export function skyColors(sunAlt: number): { top: string; bottom: string; starVisibility: number; label: string } {
  const lerp = (a: number[], b: number[], t: number) => a.map((x, i) => Math.round(x + (b[i] - x) * t))
  const stops: [number, number[], number[]][] = [
    [0, [95, 150, 215], [160, 195, 230]], // day
    [-6, [45, 70, 130], [150, 110, 120]], // civil twilight edge
    [-12, [14, 24, 60], [40, 40, 80]], // nautical
    [-18, [4, 7, 20], [8, 12, 30]], // astronomical dark
  ]
  let top = stops[0][1], bottom = stops[0][2]
  if (sunAlt >= 0) {
    top = stops[0][1]; bottom = stops[0][2]
  } else if (sunAlt <= -18) {
    top = stops[3][1]; bottom = stops[3][2]
  } else {
    for (let i = 0; i < 3; i++) {
      if (sunAlt <= stops[i][0] && sunAlt >= stops[i + 1][0]) {
        const t = (stops[i][0] - sunAlt) / (stops[i][0] - stops[i + 1][0])
        top = lerp(stops[i][1], stops[i + 1][1], t)
        bottom = lerp(stops[i][2], stops[i + 1][2], t)
      }
    }
  }
  const starVisibility = Math.max(0, Math.min(1, (-sunAlt - 2) / 10)) // stars fade in through civil twilight
  const label = sunAlt >= -0.833 ? 'Daylight' : sunAlt >= -6 ? 'Civil twilight' : sunAlt >= -12 ? 'Nautical twilight' : sunAlt >= -18 ? 'Astronomical twilight' : 'Night'
  const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`
  return { top: rgb(top), bottom: rgb(bottom), starVisibility, label }
}

/** Radius in px for a star of a given magnitude. */
export const starRadius = (mag: number) => Math.max(0.8, 3.6 - 0.75 * mag)

export interface DarkWindow {
  from: number
  to: number
}

/**
 * Longest stretch between astronomical dusk and dawn with the moon below the horizon (null when there is none).
 * `dusk` and `dawn` are instants; `moonAlt` returns the moon's altitude at an instant.
 */
export function moonlessDark(dusk: number | null, dawn: number | null, moonAlt: (t: number) => number): DarkWindow | null {
  if (dusk === null || dawn === null || dawn <= dusk) return null
  let best: DarkWindow | null = null
  let start: number | null = null
  const step = 5 * 60000
  for (let t = dusk; t <= dawn; t += step) {
    const dark = moonAlt(t) < -0.3
    if (dark && start === null) start = t
    if ((!dark || t + step > dawn) && start !== null) {
      const end = dark ? Math.min(t + step, dawn) : t
      if (!best || end - start > best.to - best.from) best = { from: start, to: end }
      start = null
    }
  }
  return best && best.to - best.from >= 10 * 60000 ? best : null
}
