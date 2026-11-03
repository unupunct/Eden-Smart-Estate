import type { HistoryEntry, Task, WeatherData } from './types'

/** Today's calendar day on this computer's clock, as YYYY-MM-DD (not UTC). */
export function todayISO(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

export function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return todayISO(new Date(y, m - 1, d + n))
}

export type Urgency = 'overdue' | 'today' | 'soon' | 'later' | 'undated' | 'done'

export function urgency(t: Task, today = todayISO()): Urgency {
  if (t.status === 'done') return 'done'
  if (!t.due) return 'undated'
  if (t.due < today) return 'overdue'
  if (t.due === today) return 'today'
  return t.due <= addDaysISO(today, 7) ? 'soon' : 'later'
}

export function daysFrom(iso: string, today = todayISO()): number {
  const a = iso.split('-').map(Number)
  const b = today.split('-').map(Number)
  return Math.round((Date.UTC(a[0], a[1] - 1, a[2]) - Date.UTC(b[0], b[1] - 1, b[2])) / 86400000)
}

export function dueLabel(t: Task, today = todayISO()): string {
  if (!t.due) return 'no date'
  const d = daysFrom(t.due, today)
  if (d < -1) return `${-d} days overdue`
  if (d === -1) return 'yesterday (overdue)'
  if (d === 0) return 'today'
  if (d === 1) return 'tomorrow'
  if (d < 14) return `in ${d} days`
  return t.due
}

export function repeatLabel(t: Pick<Task, 'repeatEvery' | 'repeatUnit' | 'repeatFrom'>): string {
  if (!t.repeatEvery || !t.repeatUnit) return ''
  const unit = t.repeatEvery === 1 ? t.repeatUnit : `${t.repeatUnit}s`
  return `every ${t.repeatEvery === 1 ? '' : t.repeatEvery + ' '}${unit}${t.repeatFrom === 'completion' ? ' after completion' : ''}`
}

export function summariseTasks(tasks: Task[], today = todayISO()) {
  const c = { overdue: 0, today: 0, soon: 0, later: 0, undated: 0, done: 0 }
  for (const t of tasks) c[urgency(t, today)]++
  return c
}

/** Last time an object was maintained, from the completed-task history. */
export function lastDone(history: HistoryEntry[], objectId: string): string | null {
  return history.filter((h) => h.objectId === objectId).map((h) => h.completedOn).sort().pop() ?? null
}

// ------------------------------------------------------------------ weather
const WMO: Record<number, [string, string]> = {
  0: ['Clear sky', '☀️'], 1: ['Mainly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'], 45: ['Fog', '🌫️'], 48: ['Rime fog', '🌫️'],
  51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'], 56: ['Freezing drizzle', '🌧️'], 57: ['Heavy freezing drizzle', '🌧️'],
  61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'], 66: ['Freezing rain', '🌧️'], 67: ['Heavy freezing rain', '🌧️'],
  71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'], 77: ['Snow grains', '🌨️'],
  80: ['Light showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Violent showers', '⛈️'], 85: ['Snow showers', '🌨️'], 86: ['Heavy snow showers', '❄️'],
  95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm with hail', '⛈️'], 99: ['Thunderstorm with heavy hail', '⛈️'],
}

export function weatherText(code: number): { text: string; icon: string } {
  const w = WMO[code]
  return w ? { text: w[0], icon: w[1] } : { text: `Weather code ${code}`, icon: '❔' }
}

export interface GardenNote {
  level: 'warn' | 'info'
  text: string
  frostDay?: string
}

/** Plain facts derived from the forecast numbers (no advice that is not in the data). */
export function gardenNotes(d: WeatherData): GardenNote[] {
  const notes: GardenNote[] = []
  const days = d.daily.time
  const frost = days.map((t, i) => ({ t, min: d.daily.temperature_2m_min[i] })).filter((x) => x.min <= 0)
  const near = days.map((t, i) => ({ t, min: d.daily.temperature_2m_min[i] })).filter((x) => x.min > 0 && x.min <= 2)
  for (const f of frost) notes.push({ level: 'warn', text: `Forecast minimum ${f.min.toFixed(1)} °C on ${f.t}: frost is likely.`, frostDay: f.t })
  if (near.length) notes.push({ level: 'info', text: `Minimum 0–2 °C on ${near.map((n) => n.t).join(', ')}: ground frost is possible.` })
  const rain = d.daily.precipitation_sum.reduce((s, x) => s + (x || 0), 0)
  notes.push({ level: 'info', text: rain < 0.5 ? 'No significant rain is forecast in the next 7 days.' : `${rain.toFixed(1)} mm of rain forecast over the next 7 days.` })
  const wind = Math.max(...(d.daily.wind_speed_10m_max ?? [0]))
  if (wind >= 40) notes.push({ level: 'warn', text: `Winds up to ${Math.round(wind)} km/h forecast.` })
  const hot = days.filter((_, i) => d.daily.temperature_2m_max[i] >= 30)
  if (hot.length) notes.push({ level: 'info', text: `Highs of 30 °C or more on ${hot.join(', ')}.` })
  return notes
}

/** The hourly soil-surface temperature for the hour matching `current.time`, if the service provided it. */
export function soilNow(d: WeatherData): number | null {
  const s = d.hourly.soil_temperature_0cm
  if (!s?.length) return null
  const i = d.hourly.time.findIndex((t) => t.slice(0, 13) >= d.current.time.slice(0, 13))
  const v = s[i < 0 ? 0 : i]
  return typeof v === 'number' ? v : null
}
