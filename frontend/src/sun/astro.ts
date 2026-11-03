// Low-precision astronomy for a garden: sun, moon and bright planets.
// Sun: NOAA / Meeus ch. 25 (about 0.01 deg). Moon: Meeus ch. 47 main terms (about 0.2 deg). Planets: JPL "approximate
// positions" Keplerian elements (about 0.5 deg, valid 1800-2050). Good for shade planning and a star chart, not for navigation.
// Times are Unix milliseconds (UTC); no ΔT correction (about a minute, far below the accuracy here).

const RAD = Math.PI / 180
const DEG = 180 / Math.PI
const norm360 = (x: number) => ((x % 360) + 360) % 360

export const jdFromMs = (ms: number) => ms / 86400000 + 2440587.5
const centuries = (ms: number) => (jdFromMs(ms) - 2451545.0) / 36525

export interface Horizontal {
  az: number // degrees clockwise from north
  alt: number // degrees above the horizon (geometric, no refraction)
}

/** Obliquity of the ecliptic, degrees. */
function obliquity(T: number): number {
  return 23.43929111 - 0.0130042 * T - 1.64e-7 * T * T
}

function gmstDeg(ms: number): number {
  const d = jdFromMs(ms) - 2451545.0
  const T = d / 36525
  return norm360(280.46061837 + 360.98564736629 * d + 0.000387933 * T * T)
}

/** Equatorial -> horizontal for an observer. RA/Dec in degrees, lat/lng in degrees (east positive). */
export function equatorialToHorizontal(ra: number, dec: number, ms: number, lat: number, lng: number): Horizontal {
  const H = (gmstDeg(ms) + lng - ra) * RAD
  const phi = lat * RAD
  const d = dec * RAD
  const sinAlt = Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H)
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)))
  const az = Math.atan2(-Math.sin(H) * Math.cos(d), Math.sin(d) * Math.cos(phi) - Math.cos(d) * Math.sin(phi) * Math.cos(H))
  return { az: norm360(az * DEG), alt: alt * DEG }
}

/** Ecliptic longitude/latitude (degrees) -> equatorial (degrees). */
function eclToEq(lon: number, lat: number, eps: number): { ra: number; dec: number } {
  const l = lon * RAD
  const b = lat * RAD
  const e = eps * RAD
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l))
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l))
  return { ra: norm360(ra * DEG), dec: dec * DEG }
}

// ------------------------------------------------------------------ sun

export interface SunInfo extends Horizontal {
  ra: number
  dec: number
  lon: number // apparent ecliptic longitude
  distAu: number
}

export function sunEquatorial(ms: number): { ra: number; dec: number; lon: number; distAu: number } {
  const T = centuries(ms)
  const L0 = norm360(280.46646 + 36000.76983 * T + 0.0003032 * T * T)
  const M = norm360(357.52911 + 35999.05029 * T - 0.0001537 * T * T)
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T
  const Mr = M * RAD
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mr) + (0.019993 - 0.000101 * T) * Math.sin(2 * Mr) + 0.000289 * Math.sin(3 * Mr)
  const trueLon = L0 + C
  const nu = Mr + C * RAD
  const distAu = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(nu))
  const omega = 125.04 - 1934.136 * T
  const lon = trueLon - 0.00569 - 0.00478 * Math.sin(omega * RAD)
  const eps = obliquity(T) + 0.00256 * Math.cos(omega * RAD)
  const { ra, dec } = eclToEq(lon, 0, eps)
  return { ra, dec, lon: norm360(lon), distAu }
}

export function sunPosition(ms: number, lat: number, lng: number): SunInfo {
  const s = sunEquatorial(ms)
  return { ...s, ...equatorialToHorizontal(s.ra, s.dec, ms, lat, lng) }
}

/** Standard altitude of the sun's centre at sunrise/sunset: -0.833 deg (refraction + semi-diameter). */
export const SUN_RISE_ALT = -0.833

export interface DayEvents {
  sunrise: number | null
  sunset: number | null
  solarNoon: number
  noonAlt: number
  dayLengthH: number // 0 for polar night, 24 for midnight sun
  civilDawn: number | null
  civilDusk: number | null
  nauticalDawn: number | null
  nauticalDusk: number | null
  astroDawn: number | null
  astroDusk: number | null
  polar: 'day' | 'night' | null
}

/** Find the time in [a, b] where f crosses zero (bisection); assumes a sign change. */
function bisect(f: (t: number) => number, a: number, b: number): number {
  let fa = f(a)
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2
    const fm = f(m)
    if (fm === 0 || b - a < 500) return m
    if (Math.sign(fm) === Math.sign(fa)) {
      a = m
      fa = fm
    } else b = m
  }
  return (a + b) / 2
}

/** Crossings of `f` through zero between t0 and t1 sampled every `stepMs`. */
export function crossings(f: (t: number) => number, t0: number, t1: number, stepMs = 600000): { t: number; rising: boolean }[] {
  const out: { t: number; rising: boolean }[] = []
  let prevT = t0
  let prev = f(t0)
  for (let t = t0 + stepMs; t <= t1 + stepMs; t += stepMs) {
    const tt = Math.min(t, t1)
    const v = f(tt)
    if ((prev < 0 && v >= 0) || (prev >= 0 && v < 0)) out.push({ t: bisect(f, prevT, tt), rising: v >= 0 })
    prevT = tt
    prev = v
    if (tt >= t1) break
  }
  return out
}

/**
 * Sun events for the 24 h starting at `dayStartMs` (the caller supplies local midnight as a UTC instant, so the
 * "day" follows the property's time zone). Events are searched inside that window only.
 */
export function sunEvents(dayStartMs: number, lat: number, lng: number): DayEvents {
  const end = dayStartMs + 86400000
  const alt = (t: number) => sunPosition(t, lat, lng).alt
  const cross = (level: number) => crossings((t) => alt(t) - level, dayStartMs, end)
  const pick = (level: number) => {
    const c = cross(level)
    return { up: c.find((x) => x.rising)?.t ?? null, down: c.find((x) => !x.rising)?.t ?? null }
  }
  const main = pick(SUN_RISE_ALT)
  const civil = pick(-6)
  const naut = pick(-12)
  const astro = pick(-18)
  // solar noon: maximum of altitude, by golden-section over the window
  let a = dayStartMs
  let b = end
  const g = (Math.sqrt(5) - 1) / 2
  let c = b - g * (b - a)
  let d = a + g * (b - a)
  for (let i = 0; i < 60; i++) {
    if (alt(c) > alt(d)) b = d
    else a = c
    c = b - g * (b - a)
    d = a + g * (b - a)
  }
  const noon = (a + b) / 2
  const noonAlt = alt(noon)
  // a midnight-sun day has no crossings and a high noon altitude
  const minAlt = Math.min(alt(dayStartMs), alt(dayStartMs + 43200000), alt(end - 1))
  let polar: DayEvents['polar'] = null
  if (main.up === null && main.down === null) polar = noonAlt > SUN_RISE_ALT && minAlt > SUN_RISE_ALT ? 'day' : 'night'
  let dayLengthH: number
  if (polar === 'day') dayLengthH = 24
  else if (polar === 'night') dayLengthH = 0
  else if (main.up !== null && main.down !== null) dayLengthH = (main.down > main.up ? main.down - main.up : main.down + 86400000 - main.up) / 3600000
  else dayLengthH = main.up !== null ? (end - main.up) / 3600000 : (main.down! - dayStartMs) / 3600000
  return {
    sunrise: main.up, sunset: main.down, solarNoon: noon, noonAlt, dayLengthH,
    civilDawn: civil.up, civilDusk: civil.down, nauticalDawn: naut.up, nauticalDusk: naut.down, astroDawn: astro.up, astroDusk: astro.down,
    polar,
  }
}

/** Shadow of a vertical pole: length factor (shadow length / height) and the compass direction the shadow points to. */
export function shadowVector(sunAz: number, sunAlt: number): { dirDeg: number; factor: number } | null {
  if (sunAlt <= 0) return null
  return { dirDeg: norm360(sunAz + 180), factor: 1 / Math.tan(sunAlt * RAD) }
}

// ------------------------------------------------------------------ moon

export interface MoonInfo extends Horizontal {
  ra: number
  dec: number
  lon: number
  lat: number
  distKm: number
  illumination: number // 0..1
  elongation: number // degrees east of the sun, 0..360 (0 new, 180 full)
  phaseName: string
  waxing: boolean
}

const MOON_LON: [number, number, number, number, number][] = [
  // coefficient (deg), D, M, M', F multiples
  [6.288774, 0, 0, 1, 0], [1.274027, 2, 0, -1, 0], [0.658314, 2, 0, 0, 0], [0.213618, 0, 0, 2, 0], [-0.185116, 0, 1, 0, 0],
  [-0.114332, 0, 0, 0, 2], [0.058793, 2, 0, -2, 0], [0.057066, 2, -1, -1, 0], [0.053322, 2, 0, 1, 0], [0.045758, 2, -1, 0, 0],
  [-0.040923, 0, 1, -1, 0], [-0.034720, 1, 0, 0, 0], [-0.030383, 0, 1, 1, 0], [0.015327, 2, 0, 0, -2], [-0.012528, 0, 0, 1, 2],
  [0.010980, 0, 0, 1, -2],
]
const MOON_LAT: [number, number, number, number, number][] = [
  [5.128122, 0, 0, 0, 1], [0.280602, 0, 0, 1, 1], [0.277693, 0, 0, 1, -1], [0.173237, 2, 0, 0, -1], [0.055413, 2, 0, -1, 1],
  [0.046271, 2, 0, -1, -1], [0.032573, 2, 0, 0, 1], [0.017198, 0, 0, 2, 1], [0.009266, 2, 0, 1, -1], [0.008823, 0, 0, 2, -1],
  [0.008247, 2, -1, 0, -1],
]
const MOON_DIST: [number, number, number, number, number][] = [
  [-20905.355, 0, 0, 1, 0], [-3699.111, 2, 0, -1, 0], [-2955.968, 2, 0, 0, 0], [-569.925, 0, 0, 2, 0], [48.888, 0, 1, 0, 0],
  [-3.149, 0, 0, 0, 2], [246.158, 2, 0, -2, 0], [-152.138, 2, -1, -1, 0], [-170.733, 2, 0, 1, 0], [-204.586, 2, -1, 0, 0],
  [-129.620, 0, 1, -1, 0], [108.743, 1, 0, 0, 0], [104.755, 0, 1, 1, 0],
]

/** Geocentric ecliptic position of the moon. */
export function moonEcliptic(ms: number): { lon: number; lat: number; distKm: number } {
  const T = centuries(ms)
  const Lp = norm360(218.3164477 + 481267.88123421 * T)
  const D = norm360(297.8501921 + 445267.1114034 * T) * RAD
  const M = norm360(357.5291092 + 35999.0502909 * T) * RAD
  const Mp = norm360(134.9633964 + 477198.8675055 * T) * RAD
  const F = norm360(93.272095 + 483202.0175233 * T) * RAD
  const E = 1 - 0.002516 * T - 0.0000074 * T * T // eccentricity correction for terms containing M
  const term = (c: number, d: number, m: number, mp: number, f: number, fn: (x: number) => number) =>
    c * fn(d * D + m * M + mp * Mp + f * F) * (Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1)
  let lon = Lp
  for (const [c, d, m, mp, f] of MOON_LON) lon += term(c, d, m, mp, f, Math.sin)
  let lat = 0
  for (const [c, d, m, mp, f] of MOON_LAT) lat += term(c, d, m, mp, f, Math.sin)
  let dist = 385000.56
  for (const [c, d, m, mp, f] of MOON_DIST) dist += term(c, d, m, mp, f, Math.cos)
  // nutation in longitude, small: keep the dominant term
  const omega = (125.04452 - 1934.136261 * T) * RAD
  lon += -0.00478 * Math.sin(omega)
  return { lon: norm360(lon), lat, distKm: dist }
}

export function moonPhaseName(elong: number): string {
  const e = norm360(elong)
  if (e < 22.5 || e >= 337.5) return 'New moon'
  if (e < 67.5) return 'Waxing crescent'
  if (e < 112.5) return 'First quarter'
  if (e < 157.5) return 'Waxing gibbous'
  if (e < 202.5) return 'Full moon'
  if (e < 247.5) return 'Waning gibbous'
  if (e < 292.5) return 'Last quarter'
  return 'Waning crescent'
}

const EARTH_RADIUS_KM = 6378.137

export function moonPosition(ms: number, lat: number, lng: number): MoonInfo {
  const T = centuries(ms)
  const m = moonEcliptic(ms)
  const { ra, dec } = eclToEq(m.lon, m.lat, obliquity(T))
  const geo = equatorialToHorizontal(ra, dec, ms, lat, lng)
  // topocentric altitude: parallax lowers the moon by up to about 1 degree
  const par = Math.asin(EARTH_RADIUS_KM / m.distKm) * DEG
  const alt = geo.alt - par * Math.cos(geo.alt * RAD)
  const s = sunEquatorial(ms)
  const elong = norm360(m.lon - s.lon)
  const cosPsi = Math.cos(m.lat * RAD) * Math.cos((m.lon - s.lon) * RAD)
  const psi = Math.acos(Math.max(-1, Math.min(1, cosPsi)))
  const sunKm = s.distAu * 149597870.7
  const phaseAngle = Math.atan2(sunKm * Math.sin(psi), m.distKm - sunKm * cosPsi)
  const illumination = (1 + Math.cos(phaseAngle)) / 2
  return { az: geo.az, alt, ra, dec, lon: m.lon, lat: m.lat, distKm: m.distKm, illumination, elongation: elong, phaseName: moonPhaseName(elong), waxing: elong < 180 }
}

export interface RiseSet {
  rise: number | null
  set: number | null
}

/** Moon rise/set inside the 24 h window (standard altitude +0.125 deg for the topocentric, parallax-corrected centre). */
export function moonEvents(dayStartMs: number, lat: number, lng: number): RiseSet {
  const c = crossings((t) => moonPosition(t, lat, lng).alt - 0.125, dayStartMs, dayStartMs + 86400000, 900000)
  return { rise: c.find((x) => x.rising)?.t ?? null, set: c.find((x) => !x.rising)?.t ?? null }
}

/** Next instant (after `from`) when the sun-moon elongation passes `target` degrees (0 new, 90 first quarter, 180 full, 270 last quarter). */
export function nextMoonPhase(from: number, target: number): number {
  const f = (t: number) => {
    const d = norm360(moonEcliptic(t).lon - sunEquatorial(t).lon - target + 180) - 180 // wraps to -180..180, zero at target
    return d
  }
  let t = from
  let prev = f(t)
  for (let i = 0; i < 40 * 24; i++) {
    const n = t + 3600000
    const v = f(n)
    if (prev < 0 && v >= 0 && Math.abs(v - prev) < 90) return bisect(f, t, n)
    t = n
    prev = v
  }
  return from
}

// ------------------------------------------------------------------ planets

interface Elements {
  a: [number, number]
  e: [number, number]
  I: [number, number]
  L: [number, number]
  w: [number, number] // longitude of perihelion
  node: [number, number]
}

// JPL "Keplerian elements for approximate positions of the major planets", 1800-2050 AD (value at J2000, rate per century).
const ELEMENTS: Record<string, Elements> = {
  mercury: { a: [0.38709927, 0.00000037], e: [0.20563593, 0.00001906], I: [7.00497902, -0.00594749], L: [252.2503235, 149472.67411175], w: [77.45779628, 0.16047689], node: [48.33076593, -0.12534081] },
  venus: { a: [0.72333566, 0.0000039], e: [0.00677672, -0.00004107], I: [3.39467605, -0.0007889], L: [181.9790995, 58517.81538729], w: [131.60246718, 0.00268329], node: [76.67984255, -0.27769418] },
  earth: { a: [1.00000261, 0.00000562], e: [0.01671123, -0.00004392], I: [-0.00001531, -0.01294668], L: [100.46457166, 35999.37244981], w: [102.93768193, 0.32327364], node: [0, 0] },
  mars: { a: [1.52371034, 0.00001847], e: [0.0933941, 0.00007882], I: [1.84969142, -0.00813131], L: [-4.55343205, 19140.30268499], w: [-23.94362959, 0.44441088], node: [49.55953891, -0.29257343] },
  jupiter: { a: [5.202887, -0.00011607], e: [0.04838624, -0.00013253], I: [1.30439695, -0.00183714], L: [34.39644051, 3034.74612775], w: [14.72847983, 0.21252668], node: [100.47390909, 0.20469106] },
  saturn: { a: [9.53667594, -0.0012506], e: [0.05386179, -0.00050991], I: [2.48599187, 0.00193609], L: [49.95424423, 1222.49362201], w: [92.59887831, -0.41897216], node: [113.66242448, -0.28867794] },
}

export const PLANET_IDS = ['mercury', 'venus', 'mars', 'jupiter', 'saturn'] as const
export type PlanetId = (typeof PLANET_IDS)[number]

/** Heliocentric ecliptic rectangular coordinates (AU, J2000 ecliptic). */
function helio(el: Elements, T: number): [number, number, number] {
  const at = (p: [number, number]) => p[0] + p[1] * T
  const a = at(el.a)
  const e = at(el.e)
  const I = at(el.I) * RAD
  const L = at(el.L)
  const w = at(el.w)
  const node = at(el.node) * RAD
  const argPeri = (w - at(el.node)) * RAD
  const M = norm360(L - w) * RAD
  let E = M + e * Math.sin(M)
  for (let i = 0; i < 12; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E))
  const xv = a * (Math.cos(E) - e)
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E)
  const cw = Math.cos(argPeri)
  const sw = Math.sin(argPeri)
  const cn = Math.cos(node)
  const sn = Math.sin(node)
  const ci = Math.cos(I)
  const si = Math.sin(I)
  const x = (cw * cn - sw * sn * ci) * xv + (-sw * cn - cw * sn * ci) * yv
  const y = (cw * sn + sw * cn * ci) * xv + (-sw * sn + cw * cn * ci) * yv
  const z = sw * si * xv + cw * si * yv
  return [x, y, z]
}

export interface PlanetInfo extends Horizontal {
  id: PlanetId
  ra: number
  dec: number
  lon: number // geocentric ecliptic longitude (J2000 ecliptic)
  elongation: number // degrees from the sun
  distAu: number
}

/** Geocentric position of a planet. Coordinates are J2000; the small precession to the date is applied to RA/Dec. */
export function planetPosition(id: PlanetId, ms: number, lat: number, lng: number): PlanetInfo {
  const T = centuries(ms)
  const p = helio(ELEMENTS[id], T)
  const e = helio(ELEMENTS.earth, T)
  const gx = p[0] - e[0]
  const gy = p[1] - e[1]
  const gz = p[2] - e[2]
  // J2000 ecliptic -> J2000 equatorial
  const eps = 23.43929111 * RAD
  const xe = gx
  const ye = gy * Math.cos(eps) - gz * Math.sin(eps)
  const ze = gy * Math.sin(eps) + gz * Math.cos(eps)
  const ra0 = norm360(Math.atan2(ye, xe) * DEG)
  const dec0 = Math.atan2(ze, Math.hypot(xe, ye)) * DEG
  const { ra, dec } = precess(ra0, dec0, ms)
  const lon = norm360(Math.atan2(gy, gx) * DEG)
  const sunLon = norm360(Math.atan2(-e[1], -e[0]) * DEG) // sun as seen from earth
  const elong = Math.abs(((lon - sunLon + 540) % 360) - 180)
  return { id, ra, dec, lon, elongation: elong, distAu: Math.hypot(gx, gy, gz), ...equatorialToHorizontal(ra, dec, ms, lat, lng) }
}

/** Approximate precession of J2000 coordinates to the date (error well under 0.01 deg within decades). */
export function precess(ra: number, dec: number, ms: number): { ra: number; dec: number } {
  const T = centuries(ms)
  const m = (3.07496 + 0.00186 * T) * 15 / 3600 // deg per year (3.075 s)
  const n = (1.33621 - 0.00057 * T) * 15 / 3600 // deg per year (20.04")
  const years = T * 100
  const a = ra * RAD
  const d = dec * RAD
  const dRa = (m + n * Math.sin(a) * Math.tan(d)) * years
  const dDec = n * Math.cos(a) * years
  return { ra: norm360(ra + dRa), dec: dec + dDec }
}

/** Compass point for an azimuth. */
export function compass(az: number): string {
  const pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return pts[Math.round(norm360(az) / 22.5) % 16]
}
