// Time-zone helpers built on Intl (no tz database shipped). All instants are UTC milliseconds.

export const browserZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function allZones(): string[] {
  try {
    const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf
    const z = f ? f('timeZone') : []
    if (z.length) return z.includes('UTC') ? z : ['UTC', ...z]
  } catch {
    /* fall through */
  }
  return ['UTC', browserZone()]
}

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function parts(ms: number, tz: string): Record<string, number> {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    fmtCache.set(tz, f)
  }
  const out: Record<string, number> = {}
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') out[p.type] = Number(p.value)
  return out
}

/** Offset of the zone from UTC at an instant, in minutes (east positive). */
export function offsetMinutes(tz: string, ms: number): number {
  const p = parts(ms, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second)
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000)
}

export interface Wall {
  y: number
  mo: number // 1..12
  d: number
  h: number
  mi: number
}

export function toWall(ms: number, tz: string): Wall {
  const p = parts(ms, tz)
  return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute }
}

/** Wall-clock time in a zone -> UTC instant (resolves DST gaps/overlaps to a sensible instant). */
export function fromWall(w: Wall, tz: string): number {
  const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi)
  const o1 = offsetMinutes(tz, guess - offsetMinutes(tz, guess) * 60000)
  return guess - o1 * 60000
}

/** UTC instant of local midnight at the start of the calendar day containing `ms` (or of the given y/m/d). */
export function dayStart(ms: number, tz: string): number {
  const w = toWall(ms, tz)
  return fromWall({ ...w, h: 0, mi: 0 }, tz)
}

export function addDays(dayStartMs: number, n: number, tz: string): number {
  const w = toWall(dayStartMs + 3 * 3600000, tz) // +3 h keeps us safely inside the day across DST changes
  return fromWall({ y: w.y, mo: w.mo, d: w.d + n, h: 0, mi: 0 }, tz)
}

const two = (n: number) => String(n).padStart(2, '0')

export function fmtClock(ms: number | null, tz: string): string {
  if (ms === null) return '—'
  const w = toWall(ms, tz)
  return `${two(w.h)}:${two(w.mi)}`
}

export function fmtDate(ms: number, tz: string): string {
  const w = toWall(ms, tz)
  return `${w.y}-${two(w.mo)}-${two(w.d)}`
}

export function zoneLabel(tz: string, ms: number): string {
  const o = offsetMinutes(tz, ms)
  const sign = o < 0 ? '-' : '+'
  const a = Math.abs(o)
  return `${tz} (UTC${sign}${two(Math.floor(a / 60))}:${two(a % 60)})`
}

export function fmtDuration(hours: number): string {
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return m === 60 ? `${h + 1} h 00 min` : `${h} h ${two(m)} min`
}
