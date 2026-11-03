import { useEffect, useState } from 'react'
import { CloudSun, RefreshCw } from 'lucide-react'
import { manageApi } from '../api/client'
import { gardenNotes, soilNow, weatherText } from '../manage/logic'
import { useManage } from '../manage/store'
import type { WeatherData } from '../manage/types'
import { useEditor } from '../model/store'
import { useManageLoad } from './Tasks'

const dayName = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

export function WeatherPage() {
  const pid = useManageLoad()
  const property = useEditor((s) => s.property)
  const { weatherEnabled, weather, weatherError, loaded } = useManage()
  const load = useManage((s) => s.load)
  const loadWeather = useManage((s) => s.loadWeather)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [lng, lat] = property?.center ?? [0, 0]

  useEffect(() => {
    if (!property || !weatherEnabled) return
    void loadWeather(lat, lng)
    const h = setInterval(() => void loadWeather(lat, lng), 10 * 60 * 1000)
    return () => clearInterval(h)
  }, [property?.id, weatherEnabled, lat, lng, loadWeather]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!property || !pid) return <div className="emptystate"><h2>No property open</h2><p>Open or create a property first: the forecast is for its location.</p></div>

  const toggle = async (on: boolean) => {
    setBusy(true)
    try {
      await manageApi.setWeatherEnabled(on)
      await load(pid)
    } finally {
      setBusy(false)
    }
  }
  const remind = async (day: string) => {
    await manageApi.addTask({ propertyId: pid, title: 'Protect tender plants from frost', due: day, category: 'garden', priority: 'high', notes: 'Created from the weather forecast.' })
    await load(pid)
    setMsg(`Reminder added for ${day} (see Tasks).`)
  }

  return (
    <div className="page">
      <div className="pagehead">
        <div><h1>Weather</h1><p>Forecast for {property.name} ({lat.toFixed(3)}°, {lng.toFixed(3)}°) from Open-Meteo. Always shown with the time it was fetched; if the service cannot be reached EDEN shows the last real forecast marked as old, never a guess.</p></div>
        <span className="badge">Phase 6</span>
      </div>
      {!weatherEnabled ? (
        <div className="formcard glass">
          <h3>Weather is switched off</h3>
          <p>To show a forecast, EDEN asks the free <b>Open-Meteo</b> service (open-meteo.com, no account or key needed). That sends <b>this property's approximate coordinates</b> (rounded to 4 decimals) and your computer's IP address to Open-Meteo, like any web request. Nothing else leaves your computer. Open-Meteo's data is licensed CC BY 4.0 and free for non-commercial use.</p>
          <div className="btnrow"><button className="primary" disabled={busy || !loaded} onClick={() => void toggle(true)}>Enable weather for this installation</button></div>
          <small className="muted">You can switch it off again at any time. The demo estate is placed at a real location, so its forecast is real too.</small>
        </div>
      ) : (
        <>
          {weatherError && !weather && <div className="notice err">{weatherError}</div>}
          {weather && <Forecast w={weather.data} fetchedAt={weather.fetchedAt} stale={weather.stale} error={weather.error} onRefresh={() => void loadWeather(lat, lng)} onRemind={remind} msg={msg} />}
          {!weather && !weatherError && <p className="muted">Loading forecast…</p>}
          <div className="btnrow"><button onClick={() => void toggle(false)} disabled={busy}>Switch weather off</button></div>
          <small className="muted">Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a> (CC BY 4.0). Forecasts are model output for a grid cell, not a measurement at your garden; frost pockets and microclimates are not captured.</small>
        </>
      )}
    </div>
  )
}

function Forecast({ w, fetchedAt, stale, error, onRefresh, onRemind, msg }: { w: WeatherData; fetchedAt: string; stale: boolean; error?: string; onRefresh: () => void; onRemind: (d: string) => void; msg: string }) {
  const cur = w.current
  const cw = weatherText(cur.weather_code)
  const soil = soilNow(w)
  const notes = gardenNotes(w)
  return (
    <>
      {stale && <div className="notice err">This is the <b>last real forecast</b>, fetched {new Date(fetchedAt).toLocaleString()}. {error}</div>}
      <div className="stats">
        <div className="stat glass"><small>Now · {cw.text}</small><strong>{cw.icon} {cur.temperature_2m.toFixed(1)} °C</strong><em>{cur.apparent_temperature !== undefined ? `feels like ${cur.apparent_temperature.toFixed(0)} °C` : ''}</em></div>
        <div className="stat glass"><small>Wind</small><strong>{cur.wind_speed_10m !== undefined ? `${cur.wind_speed_10m.toFixed(0)} km/h` : '—'}</strong><em>{cur.wind_gusts_10m !== undefined ? `gusts ${cur.wind_gusts_10m.toFixed(0)} km/h` : ''}</em></div>
        <div className="stat glass"><small>Humidity</small><strong>{cur.relative_humidity_2m !== undefined ? `${cur.relative_humidity_2m} %` : '—'}</strong><em>{cur.surface_pressure !== undefined ? `${cur.surface_pressure.toFixed(0)} hPa` : ''}</em></div>
        <div className="stat glass"><small>Soil surface (model)</small><strong>{soil !== null ? `${soil.toFixed(1)} °C` : '—'}</strong><em>modelled, not measured</em></div>
      </div>
      <p className="muted"><small>Fetched {new Date(fetchedAt).toLocaleString()} · time zone {w.timezone} <button className="linklike" onClick={onRefresh}><RefreshCw size={11} /> refresh</button></small></p>
      {msg && <div className="notice ok">{msg}</div>}
      <h2 className="sect">What the forecast says for the garden</h2>
      <ul className="notes glass">
        {notes.map((n, i) => (
          <li key={i} className={n.level}>{n.text}{n.frostDay && <button className="chip" onClick={() => onRemind(n.frostDay!)}>Add a reminder</button>}</li>
        ))}
      </ul>
      <h2 className="sect">Next 48 hours</h2>
      <HourChart w={w} />
      <h2 className="sect">7 days</h2>
      <div className="glass tablewrap">
        <table>
          <thead><tr><th>Day</th><th>Sky</th><th>Low</th><th>High</th><th>Rain</th><th>Wind max</th><th>Sunrise · sunset</th></tr></thead>
          <tbody>
            {w.daily.time.map((d, i) => {
              const c = weatherText(w.daily.weather_code[i])
              const lo = w.daily.temperature_2m_min[i]
              return (
                <tr key={d}>
                  <td>{dayName(d)}</td><td>{c.icon} {c.text}</td>
                  <td className={lo <= 0 ? 'frost' : ''}><b>{lo.toFixed(0)} °C</b></td><td>{w.daily.temperature_2m_max[i].toFixed(0)} °C</td>
                  <td>{w.daily.precipitation_sum[i].toFixed(1)} mm{w.daily.precipitation_probability_max ? <small className="muted"> ({w.daily.precipitation_probability_max[i]} %)</small> : ''}</td>
                  <td>{w.daily.wind_speed_10m_max ? `${w.daily.wind_speed_10m_max[i].toFixed(0)} km/h` : '—'}</td>
                  <td className="mono">{w.daily.sunrise ? `${w.daily.sunrise[i].slice(11)} · ${w.daily.sunset?.[i].slice(11)}` : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

function HourChart({ w }: { w: WeatherData }) {
  const t = w.hourly.temperature_2m
  const rain = w.hourly.precipitation ?? []
  if (!t.length) return <p className="empty">No hourly data.</p>
  const W = 720, H = 150, padL = 34, padB = 22
  const lo = Math.min(...t, 0), hi = Math.max(...t) + 1
  const x = (i: number) => padL + (i / (t.length - 1)) * (W - padL - 6)
  const y = (v: number) => 8 + (1 - (v - lo) / (hi - lo)) * (H - padB - 10)
  const maxR = Math.max(1, ...rain)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart wide" role="img" aria-label="Hourly temperature and rain">
      {lo < 0 && <line x1={padL} x2={W - 6} y1={y(0)} y2={y(0)} stroke="#38bdf8" strokeDasharray="4 3" opacity=".7" />}
      {rain.map((r, i) => r > 0 && <rect key={i} x={x(i) - 3} width={6} y={H - padB - (r / maxR) * 40} height={(r / maxR) * 40} fill="#38bdf8" opacity=".5" />)}
      <polyline fill="none" stroke="#fbbf24" strokeWidth="2" points={t.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} />
      {[0, 12, 24, 36, 47].filter((i) => i < t.length).map((i) => <text key={i} x={x(i)} y={H - 6} fill="#8b9ba3" fontSize="10" textAnchor="middle">{w.hourly.time[i].slice(5, 10)} {w.hourly.time[i].slice(11)}</text>)}
      <text x="2" y={y(hi - 1) + 4} fill="#8b9ba3" fontSize="10">{(hi - 1).toFixed(0)}°</text>
      <text x="2" y={y(lo) + 4} fill="#8b9ba3" fontSize="10">{lo.toFixed(0)}°</text>
    </svg>
  )
}

export function WeatherIcon() {
  return <CloudSun size={18} />
}
