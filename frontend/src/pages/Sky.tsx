import { useEffect, useMemo, useRef, useState } from 'react'
import { Moon, Pause, Play } from 'lucide-react'
import { useEditor } from '../model/store'
import type { PropertyMeta } from '../model/types'
import { compass, moonEvents, moonPosition, nextMoonPhase, sunEvents } from '../sun/astro'
import { figureSegments, moonlessDark, project, skyAt, skyColors, starRadius } from '../sky/chart'
import { loadZone, saveZone, useSun } from '../sun/store'
import { addDays, allZones, fmtClock, fmtDate, fmtDuration, fromWall, toWall, zoneLabel } from '../sun/tz'

const PLANET_STYLE: Record<string, { name: string; color: string }> = {
  mercury: { name: 'Mercury', color: '#c9c9c9' }, venus: { name: 'Venus', color: '#fff3c4' }, mars: { name: 'Mars', color: '#ff8a5c' },
  jupiter: { name: 'Jupiter', color: '#f3d6ad' }, saturn: { name: 'Saturn', color: '#e8d79c' },
}
const SEGMENTS = figureSegments()

export function SkyPage() {
  const property = useEditor((s) => s.property)
  if (!property) {
    return (
      <div className="emptystate">
        <h2>No property open</h2>
        <p>Open or create a property first: the sky is drawn for its location.</p>
      </div>
    )
  }
  return <SkyInner key={property.id} property={property} />
}

function SkyInner({ property }: { property: PropertyMeta }) {
  const sun = useSun()
  const [lines, setLines] = useState(true)
  const [names, setNames] = useState(true)
  const [daylight, setDaylight] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(600) // simulated seconds per real second
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    useSun.getState().set({ tz: loadZone(property.id) })
  }, [property.id])

  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    const h = setInterval(() => {
      const now = performance.now()
      useSun.getState().set({ instant: useSun.getState().instant + (now - last) * speed })
      last = now
    }, 100)
    return () => clearInterval(h)
  }, [playing, speed])

  const [lng, lat] = property.center
  const tz = sun.tz
  const wall = toWall(sun.instant, tz)
  const dayStart = fromWall({ ...wall, h: 0, mi: 0 }, tz)
  const sky = useMemo(() => skyAt(sun.instant, lat, lng), [sun.instant, lat, lng])
  const colors = skyColors(sky.sun.alt)

  const setMinutes = (m: number) => sun.set({ instant: fromWall({ ...wall, h: Math.floor(m / 60), mi: m % 60 }, tz) })
  const setDate = (iso: string) => {
    const [y, mo, d] = iso.split('-').map(Number)
    if (y && mo && d) sun.set({ instant: fromWall({ y, mo, d, h: wall.h, mi: wall.mi }, tz) })
  }
  const setZone = (z: string) => {
    sun.set({ tz: z, instant: fromWall(toWall(sun.instant, tz), z) })
    saveZone(property.id, z)
  }

  const info = useDayInfo(dayStart, lat, lng, tz, sun.instant)

  return (
    <div className="skypage">
      <div className="skywrap glass">
        <SkyCanvas sky={sky} colors={colors} lines={lines} names={names} daylight={daylight} southern={lat < 0} onHover={setHover} />
        <div className="skyhud">
          <span className="badge">{colors.label}</span>
          {hover && <span className="skytip">{hover}</span>}
        </div>
        <p className="skyfoot">Looking up from the property at {lat.toFixed(3)}°, {lng.toFixed(3)}°. Zenith in the centre, north at the top, east on the <b>left</b>. Stars are drawn to magnitude ≈ 3.5 and are not a full catalogue.</p>
      </div>

      <aside className="sidepanel glass">
        <div className="objhead"><Moon size={18} /><h3>Night Sky</h3></div>
        {property.isDemo && <div className="demo-note">The demo estate sits at a real location, so the sky is real; only the buildings and trees are fictional.</div>}
        <div className="two">
          <label>Date<input type="date" value={fmtDate(sun.instant, tz)} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Time <b className="mono">{fmtClock(sun.instant, tz)}</b>
            <button className="chip" style={{ float: 'right' }} onClick={() => setPlaying((p) => !p)} title="Animate">{playing ? <Pause size={13} /> : <Play size={13} />}</button>
          </label>
        </div>
        <input type="range" className="daytrack" min={0} max={1439} value={wall.h * 60 + wall.mi} style={{ background: 'linear-gradient(90deg,#0b1020,#25306b 25%,#6aa0e0 50%,#25306b 75%,#0b1020)' }} aria-label="Time of day" onChange={(e) => setMinutes(Number(e.target.value))} />
        <div className="btnrow">
          <button className="chip" onClick={() => sun.set({ instant: Date.now() })}>Now</button>
          <button className="chip" onClick={() => setMinutes(22 * 60)}>22:00</button>
          <button className="chip" onClick={() => setMinutes(0)}>Midnight</button>
          <select className="chip" style={{ width: 'auto' }} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Animation speed">
            <option value={60}>1 min/s</option><option value={600}>10 min/s</option><option value={3600}>1 h/s</option><option value={21600}>6 h/s</option>
          </select>
        </div>
        <label>Time zone
          <select value={tz} onChange={(e) => setZone(e.target.value)}>
            {allZones().includes(tz) ? null : <option value={tz}>{tz}</option>}
            {allZones().map((z) => <option key={z} value={z}>{z === tz ? zoneLabel(z, sun.instant) : z}</option>)}
          </select>
        </label>
        <div className="checks">
          <label className="check"><input type="checkbox" checked={lines} onChange={(e) => setLines(e.target.checked)} /> Constellation figures</label>
          <label className="check"><input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> Star names</label>
          <label className="check"><input type="checkbox" checked={daylight} onChange={(e) => setDaylight(e.target.checked)} /> Show stars in daylight</label>
        </div>

        <h4>Sun and twilight · {fmtDate(dayStart, tz)}</h4>
        <dl className="kv">
          <div className="kvrow"><dt>Sunset</dt><dd>{info.sun.polar ? (info.sun.polar === 'day' ? 'sun stays up' : 'sun stays down') : fmtClock(info.sun.sunset, tz)}</dd></div>
          <div className="kvrow"><dt>Civil dusk (−6°)</dt><dd>{fmtClock(info.sun.civilDusk, tz)}</dd></div>
          <div className="kvrow"><dt>Nautical dusk (−12°)</dt><dd>{fmtClock(info.sun.nauticalDusk, tz)}</dd></div>
          <div className="kvrow"><dt>Astronomical dusk (−18°)</dt><dd>{fmtClock(info.sun.astroDusk, tz)}</dd></div>
          <div className="kvrow"><dt>Astronomical dawn (next day)</dt><dd>{fmtClock(info.nextDawn, tz)}</dd></div>
        </dl>
        <div className="infobox">
          <b>Dark window with no moon</b>
          <p>{info.dark ? `${fmtClock(info.dark.from, tz)} – ${fmtClock(info.dark.to, tz)} (${fmtDuration((info.dark.to - info.dark.from) / 3600000)})` : info.sun.astroDusk === null ? 'No astronomical darkness at this date and latitude.' : 'The moon is up for the whole of the astronomical night.'}</p>
          <small>Between astronomical dusk and dawn, with the moon below the horizon. Clouds and local light pollution are not known to EDEN.</small>
        </div>

        <h4>Moon</h4>
        <dl className="kv">
          <div className="kvrow"><dt>Phase</dt><dd>{sky.moon.phaseName} · {Math.round(sky.moon.illumination * 100)}% lit</dd></div>
          <div className="kvrow"><dt>Position</dt><dd>{sky.moon.alt.toFixed(0)}° up, {compass(sky.moon.az)} ({sky.moon.az.toFixed(0)}°)</dd></div>
          <div className="kvrow"><dt>Moonrise · moonset</dt><dd>{fmtClock(info.moon.rise, tz)} · {fmtClock(info.moon.set, tz)}</dd></div>
          <div className="kvrow"><dt>Distance</dt><dd>{Math.round(sky.moon.distKm).toLocaleString('en-US')} km</dd></div>
          <div className="kvrow"><dt>Next full moon</dt><dd>{fmtDate(info.nextFull, tz)} {fmtClock(info.nextFull, tz)}</dd></div>
          <div className="kvrow"><dt>Next new moon</dt><dd>{fmtDate(info.nextNew, tz)} {fmtClock(info.nextNew, tz)}</dd></div>
        </dl>

        <h4>Planets (approximate, ±1°)</h4>
        <table className="mini">
          <tbody>
            {sky.planets.map((p) => {
              const st = PLANET_STYLE[p.id]
              const state = p.alt <= 0 ? 'below horizon' : sky.sun.alt > -6 ? 'in twilight / daylight' : p.alt < 8 ? 'low' : 'visible'
              return (
                <tr key={p.id}>
                  <td><span className="swatch" style={{ background: st.color }} /> {st.name}</td>
                  <td>{p.alt > 0 ? `${p.alt.toFixed(0)}° up, ${compass(p.az)}` : '—'}</td>
                  <td className="muted">{state}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="note">Uranus, Neptune, comets, satellites and deep-sky objects are not drawn. For planning an observing night, check the weather forecast: EDEN does not know the cloud cover.</p>
      </aside>
    </div>
  )
}

function useDayInfo(dayStart: number, lat: number, lng: number, tz: string, instant: number) {
  return useMemo(() => {
    const sun = sunEvents(dayStart, lat, lng)
    const nextStart = addDays(dayStart, 1, tz)
    const next = sunEvents(nextStart, lat, lng)
    const dark = moonlessDark(sun.astroDusk, next.astroDawn, (t) => moonPosition(t, lat, lng).alt)
    return {
      sun, nextDawn: next.astroDawn, dark, moon: moonEvents(dayStart, lat, lng),
      nextFull: nextMoonPhase(instant, 180), nextNew: nextMoonPhase(instant, 0),
    }
  }, [dayStart, lat, lng, tz, instant])
}

// ---------------------------------------------------------------------------------------------- canvas
interface CanvasProps {
  sky: ReturnType<typeof skyAt>
  colors: ReturnType<typeof skyColors>
  lines: boolean
  names: boolean
  daylight: boolean
  southern: boolean
  onHover: (s: string | null) => void
}

interface Hit {
  x: number
  y: number
  label: string
}

function SkyCanvas({ sky, colors, lines, names, daylight, southern, onHover }: CanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const hits = useRef<Hit[]>([])
  const [size, setSize] = useState({ w: 600, h: 600 })

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const r = box.current!.getBoundingClientRect()
      setSize({ w: Math.max(200, Math.floor(r.width)), h: Math.max(200, Math.floor(r.height)) })
    })
    ro.observe(box.current!)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const cv = ref.current!
    const dpr = window.devicePixelRatio || 1
    cv.width = size.w * dpr
    cv.height = size.h * dpr
    const ctx = cv.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const cx = size.w / 2
    const cy = size.h / 2
    const R = Math.min(size.w, size.h) / 2 - 26
    ctx.clearRect(0, 0, size.w, size.h)
    // sky disc
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R)
    g.addColorStop(0, colors.top)
    g.addColorStop(1, colors.bottom)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.fill()
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.clip()
    const vis = daylight ? 1 : colors.starVisibility
    const at = new Map<string, [number, number]>()
    const hitList: Hit[] = []
    for (const s of sky.stars) {
      if (s.alt <= 0) continue
      const [x, y] = project(s.az, s.alt, cx, cy, R)
      at.set(s.id, [x, y])
    }
    if (lines && vis > 0.05) {
      ctx.strokeStyle = `rgba(140,180,255,${0.32 * vis})`
      ctx.lineWidth = 1
      ctx.beginPath()
      for (const f of SEGMENTS) {
        for (const [a, b] of f.segs) {
          const p = at.get(a)
          const q = at.get(b)
          if (p && q) {
            ctx.moveTo(p[0], p[1])
            ctx.lineTo(q[0], q[1])
          }
        }
      }
      ctx.stroke()
    }
    if (vis > 0.02) {
      for (const s of sky.stars) {
        const p = at.get(s.id)
        if (!p) continue
        const r = starRadius(s.mag)
        const fade = Math.min(1, (s.alt + 2) / 8) // dim near the horizon (extinction)
        ctx.fillStyle = `rgba(255,255,255,${(0.35 + 0.65 * Math.min(1, (3.8 - s.mag) / 3)) * vis * fade})`
        ctx.beginPath()
        ctx.arc(p[0], p[1], r, 0, Math.PI * 2)
        ctx.fill()
        hitList.push({ x: p[0], y: p[1], label: `${s.name} · mag ${s.mag.toFixed(1)} · ${s.alt.toFixed(0)}° up` })
        if (names && s.mag < 1.7 && vis > 0.3) {
          ctx.fillStyle = `rgba(210,225,255,${0.8 * vis})`
          ctx.font = '11px Segoe UI, sans-serif'
          ctx.fillText(s.name, p[0] + r + 3, p[1] + 3)
        }
      }
    }
    // planets
    for (const p of sky.planets) {
      if (p.alt <= 0) continue
      const [x, y] = project(p.az, p.alt, cx, cy, R)
      const st = PLANET_STYLE[p.id]
      const bright = sky.sun.alt < -2 || daylight
      ctx.globalAlpha = bright ? 1 : 0.35
      ctx.fillStyle = st.color
      ctx.beginPath()
      ctx.arc(x, y, p.id === 'venus' || p.id === 'jupiter' ? 4.5 : 3.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,.5)'
      ctx.stroke()
      ctx.fillStyle = '#ffe9b0'
      ctx.font = '12px Segoe UI, sans-serif'
      ctx.fillText(st.name, x + 8, y + 4)
      ctx.globalAlpha = 1
      hitList.push({ x, y, label: `${st.name} · ${p.alt.toFixed(0)}° up (approximate)` })
    }
    // moon
    if (sky.moon.alt > -1) {
      const [x, y] = project(sky.moon.az, Math.max(0, sky.moon.alt), cx, cy, R)
      drawMoon(ctx, x, y, 10, sky.moon.illumination, sky.moon.waxing !== southern)
      ctx.fillStyle = '#e8ecff'
      ctx.font = '12px Segoe UI, sans-serif'
      ctx.fillText('Moon', x + 14, y + 4)
      hitList.push({ x, y, label: `Moon · ${sky.moon.phaseName}, ${Math.round(sky.moon.illumination * 100)}% lit` })
    }
    // sun
    if (sky.sun.alt > -0.833) {
      const [x, y] = project(sky.sun.az, Math.max(0, sky.sun.alt), cx, cy, R)
      const glow = ctx.createRadialGradient(x, y, 2, x, y, 36)
      glow.addColorStop(0, 'rgba(255,240,170,.95)')
      glow.addColorStop(1, 'rgba(255,220,120,0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(x, y, 36, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#fff6c8'
      ctx.beginPath()
      ctx.arc(x, y, 8, 0, Math.PI * 2)
      ctx.fill()
      hitList.push({ x, y, label: `Sun · ${sky.sun.alt.toFixed(0)}° up` })
    }
    ctx.restore()
    // grid
    ctx.strokeStyle = 'rgba(255,255,255,.22)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,.1)'
    ctx.lineWidth = 1
    for (const a of [30, 60]) {
      ctx.beginPath()
      ctx.arc(cx, cy, ((90 - a) / 90) * R, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.fillStyle = '#aebbc2'
    ctx.font = '600 13px Segoe UI, sans-serif'
    ctx.textAlign = 'center'
    for (const [t, az] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const) {
      const [x, y] = project(az, -7, cx, cy, R)
      ctx.fillText(t, x, y + 5)
    }
    ctx.textAlign = 'start'
    hits.current = hitList
  }, [sky, colors, lines, names, daylight, southern, size])

  const move = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    let best: Hit | null = null
    let bd = 14
    for (const h of hits.current) {
      const d = Math.hypot(h.x - x, h.y - y)
      if (d < bd) {
        bd = d
        best = h
      }
    }
    onHover(best ? best.label : null)
  }

  return (
    <div ref={box} className="skycanvas">
      <canvas ref={ref} style={{ width: size.w, height: size.h }} onMouseMove={move} onMouseLeave={() => onHover(null)} />
    </div>
  )
}

/** Moon icon with the lit part drawn from the illuminated fraction (orientation simplified: lit side right when waxing). */
function drawMoon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, k: number, litRight: boolean) {
  ctx.save()
  ctx.translate(x, y)
  if (!litRight) ctx.scale(-1, 1)
  ctx.fillStyle = '#2a2f45'
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#f4f1e1'
  ctx.beginPath()
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false)
  const rx = Math.abs(1 - 2 * k) * r
  if (k < 0.5) ctx.ellipse(0, 0, rx, r, 0, Math.PI / 2, -Math.PI / 2, true)
  else ctx.ellipse(0, 0, rx, r, 0, Math.PI / 2, (3 * Math.PI) / 2, false)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,.5)'
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}
