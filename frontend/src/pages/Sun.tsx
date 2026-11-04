import { useEffect, useMemo, useState } from 'react'
import { Pause, Play, Sun } from 'lucide-react'
import { fmtArea, measureGeom } from '../geo/measure'
import { toLocal } from '../geo/transform'
import { useLibrary } from '../library/store'
import { kindDef } from '../model/kinds'
import { useEditor } from '../model/store'
import type { Doc, Pos, PropertyMeta } from '../model/types'
import { MapView } from '../panels/MapView'
import { compass, sunEvents, sunPosition } from '../sun/astro'
import {
  analyseAreas, buildCasters, growingSeasonKeys, heatGrid, leafFactor, lightClass, LIGHT_COLOR, LIGHT_LABEL, monthOf, possibleHours,
  SEASON_DAYS, seasonDayStart, SUN_NEED_HOURS, type AreaSun, type XY,
} from '../sun/shadows'
import { loadZone, saveZone, useSun } from '../sun/store'
import { addDays, allZones, fmtClock, fmtDate, fmtDuration, fromWall, toWall, zoneLabel } from '../sun/tz'

const AREA_KINDS = new Set(['garden_bed', 'greenhouse', 'gh_bed', 'orchard_area', 'pond'])
const DAY_KEYS = ['sel', 'mar', 'jun', 'sep', 'dec'] as const
type DayKey = (typeof DAY_KEYS)[number]

export function SunPage() {
  const property = useEditor((s) => s.property)
  if (!property) {
    return (
      <div className="emptystate">
        <h2>No property open</h2>
        <p>Open or create a property first: the sun and shadows are calculated for its location and its buildings, trees and fences.</p>
      </div>
    )
  }
  return <SunInner key={property.id} property={property} />
}

function SunInner({ property }: { property: PropertyMeta }) {
  const sun = useSun()
  const doc = useEditor((s) => s.doc)
  const ix = useLibrary((s) => s.ix)
  const [lng, lat] = property.center
  const origin = property.center

  // shadows are the point of this page; the zone is remembered per property
  useEffect(() => {
    useSun.getState().set({ on: true, tz: loadZone(property.id) })
    return () => useSun.getState().set({ on: false, heatOn: false })
  }, [property.id])

  const wall = toWall(sun.instant, sun.tz)
  const dayStartMs = fromWall({ ...wall, h: 0, mi: 0 }, sun.tz)
  const dayEndMs = addDays(dayStartMs, 1, sun.tz)
  const events = useMemo(() => sunEvents(dayStartMs, lat, lng), [dayStartMs, lat, lng])
  const pos = sunPosition(sun.instant, lat, lng)
  const minutes = wall.h * 60 + wall.mi
  const leafAt = (ms: number) => (sun.leaf === 'auto' ? leafFactor(monthOf(ms, sun.tz), lat) : sun.leaf === 'on' ? 1 : 0)

  const setMinutes = (m: number) => sun.set({ instant: fromWall({ ...wall, h: Math.floor(m / 60), mi: m % 60 }, sun.tz) })
  const setDate = (iso: string) => {
    const [y, mo, d] = iso.split('-').map(Number)
    if (y && mo && d) sun.set({ instant: fromWall({ y, mo, d, h: wall.h, mi: wall.mi }, sun.tz) })
  }
  const jump = (mo: number, d: number) => sun.set({ instant: fromWall({ y: wall.y, mo, d, h: wall.h, mi: wall.mi }, sun.tz) })
  const setZone = (tz: string) => {
    const keep = toWall(sun.instant, sun.tz)
    sun.set({ tz, instant: fromWall(keep, tz) })
    saveZone(property.id, tz)
  }

  // animation: sweep through the day, 5 minutes per tick
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (!playing) return
    const h = setInterval(() => {
      const s = useSun.getState()
      const w = toWall(s.instant, s.tz)
      const m = (w.h * 60 + w.mi + 5) % 1440
      s.set({ instant: fromWall({ ...w, h: Math.floor(m / 60), mi: m % 60 }, s.tz) })
    }, 120)
    return () => clearInterval(h)
  }, [playing])

  // ---- per-area sun hours: the chosen day and the four season days
  const areaIds = useMemo(() => {
    const vis = new Map(doc.layers.map((l) => [l.id, l.visible]))
    return Object.values(doc.objects).filter((o) => AREA_KINDS.has(o.kind) && vis.get(o.layerId)).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)).map((o) => o.id)
  }, [doc])
  const [table, setTable] = useState<{ ids: string[]; byDay: Record<DayKey, Record<string, AreaSun>>; possible: Record<DayKey, number> } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setBusy(true)
    const h = setTimeout(() => {
      const days: Record<DayKey, { start: number; end: number }> = {
        sel: { start: dayStartMs, end: dayEndMs },
        mar: seasonDayStart(wall.y, SEASON_DAYS[0], sun.tz), jun: seasonDayStart(wall.y, SEASON_DAYS[1], sun.tz),
        sep: seasonDayStart(wall.y, SEASON_DAYS[2], sun.tz), dec: seasonDayStart(wall.y, SEASON_DAYS[3], sun.tz),
      }
      const byDay = {} as Record<DayKey, Record<string, AreaSun>>
      const possible = {} as Record<DayKey, number>
      for (const k of DAY_KEYS) {
        const casters = buildCasters(doc, origin, { leaf: leafAt(days[k].start), ix })
        byDay[k] = Object.fromEntries(analyseAreas(doc, areaIds, casters, days[k].start, days[k].end, origin, { stepMin: 15 }).map((a) => [a.id, a]))
        possible[k] = possibleHours(days[k].start, days[k].end, origin, { stepMin: 15 })
      }
      setTable({ ids: areaIds, byDay, possible })
      setBusy(false)
    }, 450)
    return () => clearTimeout(h)
    // leafAt closes over sun.leaf and tz, both listed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, ix, areaIds, dayStartMs, wall.y, sun.tz, sun.leaf, lat, lng])

  // ---- whole-property sun-hours map for the chosen day
  const [heatNote, setHeatNote] = useState('')
  useEffect(() => {
    if (!sun.heatOn) {
      useSun.getState().set({ heat: null })
      setHeatNote('')
      return
    }
    const h = setTimeout(() => {
      const casters = buildCasters(doc, origin, { leaf: leafAt(dayStartMs), ix })
      const { cells, cell } = heatGrid(casters, boundsOf(doc, origin), origin, dayStartMs, dayEndMs, 3500, { stepMin: 15 })
      useSun.getState().set({
        heat: { type: 'FeatureCollection', features: cells.map((c) => ({ type: 'Feature', properties: { hours: c.hours }, geometry: { type: 'Polygon', coordinates: [c.ring] } })) },
      })
      setHeatNote(`${cells.length} cells of ${cell} m`)
    }, 400)
    return () => clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sun.heatOn, doc, ix, dayStartMs, sun.tz, sun.leaf, lat, lng])

  const pct = (t: number | null) => (t === null ? null : Math.max(0, Math.min(100, ((t - dayStartMs) / (dayEndMs - dayStartMs)) * 100)))
  const rise = pct(events.sunrise)
  const set = pct(events.sunset)
  const track =
    events.polar === 'day' ? 'linear-gradient(90deg,#f5c542,#f5c542)'
      : events.polar === 'night' || rise === null || set === null ? 'linear-gradient(90deg,#1e2a44,#1e2a44)'
        : `linear-gradient(90deg,#1e2a44 ${rise}%,#f5c542 ${rise}%,#f5c542 ${set}%,#1e2a44 ${set}%)`

  const shadow = pos.alt > 0.5 ? 1 / Math.tan((pos.alt * Math.PI) / 180) : null
  const growing = growingSeasonKeys(lat)
  const growingMean = (id: string) => {
    if (!table) return 0
    const v = growing.map((k) => table.byDay[k][id]?.mean ?? 0)
    return v.reduce((s, x) => s + x, 0) / v.length
  }
  const warnings = table ? plantingWarnings(doc, ix, table.ids, growingMean) : []
  const select = (id: string) => {
    useEditor.getState().setSelection([id])
    useEditor.getState().requestFocus(id)
  }
  const demo = property.isDemo

  return (
    <div className="sunpage">
      <h1 className="sr-only">Sun and shadows</h1>
      <div className="center"><MapView property={property} /></div>
      <aside className="sidepanel glass">
        <div className="objhead"><Sun size={18} /><h3>Sun &amp; Shadows</h3></div>
        {demo && <div className="demo-note">Demo estate: a fictional layout at a real location. Sun positions are real astronomy for that spot; the buildings and trees are made up.</div>}

        <div className="two">
          <label>Date<input type="date" value={fmtDate(sun.instant, sun.tz)} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Time <b className="mono">{fmtClock(sun.instant, sun.tz)}</b>
            <button className="chip" style={{ float: 'right' }} onClick={() => setPlaying((p) => !p)} title="Animate through the day">{playing ? <Pause size={13} /> : <Play size={13} />}</button>
          </label>
        </div>
        <input type="range" className="daytrack" min={0} max={1439} step={1} value={minutes} style={{ background: track }} aria-label="Time of day" onChange={(e) => setMinutes(Number(e.target.value))} />
        <div className="btnrow">
          <button className="chip" onClick={() => sun.set({ instant: Date.now() })}>Now</button>
          {SEASON_DAYS.map((s) => <button key={s.key} className="chip" onClick={() => jump(s.month, s.day)}>{s.label.replace(' equinox', ' eq.').replace(' solstice', ' sol.')}</button>)}
        </div>
        <label>Time zone
          <select value={sun.tz} onChange={(e) => setZone(e.target.value)}>
            {allZones().includes(sun.tz) ? null : <option value={sun.tz}>{sun.tz}</option>}
            {allZones().map((z) => <option key={z} value={z}>{z === sun.tz ? zoneLabel(z, sun.instant) : z}</option>)}
          </select>
        </label>

        <h4>The sun at {fmtClock(sun.instant, sun.tz)}</h4>
        <dl className="kv">
          <div className="kvrow"><dt>Azimuth</dt><dd>{pos.az.toFixed(1)}° {compass(pos.az)}</dd></div>
          <div className="kvrow"><dt>Elevation</dt><dd>{pos.alt.toFixed(1)}°{pos.alt <= 0 ? ' (below horizon)' : ''}</dd></div>
          <div className="kvrow"><dt>Shadow of a 1 m post</dt><dd>{shadow === null ? '—' : shadow > 20 ? '> 20 m' : `${shadow.toFixed(2)} m, pointing ${compass(pos.az + 180)}`}</dd></div>
        </dl>
        <h4>{fmtDate(dayStartMs, sun.tz)} at {lat.toFixed(3)}°, {lng.toFixed(3)}°</h4>
        <dl className="kv">
          <div className="kvrow"><dt>Sunrise</dt><dd>{events.polar === 'night' ? 'sun stays below the horizon' : events.polar === 'day' ? 'sun stays up all day' : fmtClock(events.sunrise, sun.tz)}</dd></div>
          <div className="kvrow"><dt>Solar noon</dt><dd>{fmtClock(events.solarNoon, sun.tz)} · {events.noonAlt.toFixed(1)}° high</dd></div>
          <div className="kvrow"><dt>Sunset</dt><dd>{events.polar ? '—' : fmtClock(events.sunset, sun.tz)}</dd></div>
          <div className="kvrow"><dt>Day length</dt><dd>{fmtDuration(events.dayLengthH)}</dd></div>
          <div className="kvrow"><dt>Civil twilight</dt><dd>{fmtClock(events.civilDawn, sun.tz)} – {fmtClock(events.civilDusk, sun.tz)}</dd></div>
        </dl>

        <SunPathDiagram lat={lat} lng={lng} tz={sun.tz} dayStartMs={dayStartMs} year={wall.y} current={pos} />

        <h4>Shadow settings</h4>
        <label>Tree and hedge foliage
          <select value={sun.leaf} onChange={(e) => sun.set({ leaf: e.target.value as 'auto' | 'on' | 'off' })}>
            <option value="auto">Automatic by month (leaves May–Sep)</option>
            <option value="on">Leaves on</option>
            <option value="off">Leaves off (bare branches)</option>
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={sun.heatOn} onChange={(e) => sun.set({ heatOn: e.target.checked })} /> Sun-hours map for this date {heatNote && <small>({heatNote})</small>}</label>
        {sun.heatOn && (
          <div className="heatlegend"><i style={{ background: 'linear-gradient(90deg,#312e81,#38bdf8,#a3e635,#fbbf24,#f97316,#ef4444)' }} /><span>0 h</span><span>3</span><span>6</span><span>9</span><span>12</span><span>15+ h</span></div>
        )}
        <p className="note">The map shows the shadows cast by every visible building, greenhouse, fence, hedge, tree and bush. Drag an object in the map to see how its shadow moves.</p>
      </aside>

      <section className="suntable glass">
        <div className="objhead">
          <h3>Direct sun on beds, greenhouse and orchard</h3>
          {busy && <small className="muted">calculating…</small>}
        </div>
        <p className="note">Hours of direct sunlight above 3° elevation, averaged over each area (foliage lets part of the light through). Selected date: <b>{fmtDate(dayStartMs, sun.tz)}</b> (open-horizon maximum {table ? table.possible.sel.toFixed(1) : '…'} h). Rule of thumb: 6+ h full sun, 4–6 part sun, 2–4 part shade, under 2 h shade.</p>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Area</th><th>Size</th><th>Selected date</th>{SEASON_DAYS.map((s) => <th key={s.key}>{s.label}</th>)}<th>Growing season</th></tr></thead>
            <tbody>
              {table?.ids.map((id) => {
                const o = doc.objects[id]
                if (!o) return null
                const cell = (k: DayKey) => {
                  const a = table.byDay[k][id]
                  return a ? <Hours h={a.mean} lo={a.min} hi={a.max} /> : '—'
                }
                const g = growingMean(id)
                return (
                  <tr key={id} className="clickrow" onClick={() => select(id)}>
                    <td><span className="swatch" style={{ background: kindDef(o.kind).color }} /> {o.name || kindDef(o.kind).label}<small> {kindDef(o.kind).label}</small></td>
                    <td>{fmtArea(measureGeom(o.geometry).area)}</td>
                    <td>{cell('sel')}</td>
                    {SEASON_DAYS.map((s) => <td key={s.key}>{cell(s.key)}</td>)}
                    <td><Hours h={g} /></td>
                  </tr>
                )
              })}
              {table && !table.ids.length && <tr><td colSpan={8} className="empty">No garden beds, greenhouses, orchard areas or ponds on the property yet.</td></tr>}
              {!table && <tr><td colSpan={8} className="empty">Calculating…</td></tr>}
            </tbody>
          </table>
        </div>
        {warnings.length > 0 && (
          <div className="infobox warnbox">
            <b>Light needs vs. what the beds get</b>
            <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            <small>Needs come from the starter plant library (full sun 6 h+, full/part 4 h+, part sun 3 h+). Real sites vary: reflected light, soil and climate matter too.</small>
          </div>
        )}
        <details className="more">
          <summary>How this is calculated, and its limits</summary>
          <ul className="assume">
            <li>Sun and moon positions: standard astronomical formulas (sun to about 0.01°). Sunrise and sunset use the usual −0.833° (refraction and the sun's radius). Times follow the time zone chosen above.</li>
            <li>Ground is treated as flat: there is no terrain model, so a hill or a neighbour's house outside your property does not cast shade in this view.</li>
            <li>Buildings and solar panels are boxes at the height you entered; pitched roofs therefore give slightly longer shadows than reality. Fences and hedges are walls of their entered height.</li>
            <li>Tree and bush crowns are cylinders from 30 % of the height up. Foliage blocks about {Math.round(0.75 * 100)} % of light in leaf, 20 % when bare; evergreens 85 % all year. Greenhouse glazing is assumed to pass 60 %. These are estimates, not measurements.</li>
            <li>Sun hours count direct light above 3° elevation, sampled every 15 minutes at a grid of points in each area.</li>
          </ul>
        </details>
      </section>
    </div>
  )
}

function Hours({ h, lo, hi }: { h: number; lo?: number; hi?: number }) {
  const c = lightClass(h)
  return (
    <span className="hrs" title={`${LIGHT_LABEL[c]}${lo !== undefined && hi !== undefined ? ` · ${lo.toFixed(1)}–${hi.toFixed(1)} h across the area` : ''}`}>
      <i style={{ width: `${Math.min(100, (h / 14) * 100)}%`, background: LIGHT_COLOR[c] }} />
      <b>{h.toFixed(1)} h</b>
    </span>
  )
}

/** Sun-hours need warnings for library-linked beds. */
function plantingWarnings(doc: Doc, ix: ReturnType<typeof useLibrary.getState>['ix'], ids: string[], growingMean: (id: string) => number): string[] {
  if (!ix) return []
  const out: string[] = []
  for (const id of ids) {
    const o = doc.objects[id]
    if (!o || o.kind !== 'garden_bed' || !Array.isArray(o.props.plantings)) continue
    const hrs = growingMean(id)
    for (const p of o.props.plantings as { speciesId: string }[]) {
      const sp = ix.plants.get(p.speciesId)
      if (!sp) continue
      const need = SUN_NEED_HOURS[sp.sun]
      if (hrs + 0.5 < need) out.push(`${o.name}: ${sp.name} wants ${sp.sun === 'full' ? 'full sun (6 h+)' : sp.sun === 'full-part' ? 'full to part sun (4 h+)' : 'part sun (3 h+)'}, this bed averages ${hrs.toFixed(1)} h in the growing season.`)
      else if (sp.sun === 'shade' && hrs > 5) out.push(`${o.name}: ${sp.name} prefers shade, this bed averages ${hrs.toFixed(1)} h of direct sun in the growing season.`)
    }
  }
  return out
}

/** The property boundary as a local ring, or the bounding box of everything plus a margin. */
function boundsOf(doc: Doc, origin: Pos): XY[] {
  const boundary = Object.values(doc.objects).find((o) => o.kind === 'boundary' && o.geometry.type === 'Polygon')
  if (boundary && boundary.geometry.type === 'Polygon') {
    return boundary.geometry.coordinates[0].slice(0, -1).map((p) => toLocal(p, origin))
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const eat = (p: Pos) => {
    const [x, y] = toLocal(p, origin)
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
  }
  for (const o of Object.values(doc.objects)) {
    const g = o.geometry
    if (g.type === 'Point') eat(g.coordinates)
    else if (g.type === 'LineString') g.coordinates.forEach(eat)
    else g.coordinates[0].forEach(eat)
  }
  if (!isFinite(x0)) return [[-30, -30], [30, -30], [30, 30], [-30, 30]]
  const m = 15
  return [[x0 - m, y0 - m], [x1 + m, y0 - m], [x1 + m, y1 + m], [x0 - m, y1 + m]]
}

// ---------------------------------------------------------------------------------------------- sun path
function SunPathDiagram({ lat, lng, tz, dayStartMs, year, current }: { lat: number; lng: number; tz: string; dayStartMs: number; year: number; current: { az: number; alt: number } }) {
  const R = 100
  const C = 120
  const xy = (az: number, alt: number): [number, number] => {
    const r = ((90 - alt) / 90) * R
    const a = (az * Math.PI) / 180
    return [C + r * Math.sin(a), C - r * Math.cos(a)]
  }
  const curve = (start: number) => {
    const pts: [number, number][] = []
    const hourMarks: { x: number; y: number; h: number }[] = []
    for (let m = 0; m <= 1440; m += 10) {
      const t = start + m * 60000
      const p = sunPosition(t, lat, lng)
      if (p.alt >= 0) {
        const q = xy(p.az, p.alt)
        pts.push(q)
        if (m % 120 === 0 && m < 1440) hourMarks.push({ x: q[0], y: q[1], h: m / 60 })
      } else if (pts.length && pts[pts.length - 1][0] !== -1) pts.push([-1, -1]) // break the line at the horizon
    }
    const segs: string[] = []
    let cur: [number, number][] = []
    for (const p of pts) {
      if (p[0] === -1) {
        if (cur.length > 1) segs.push(cur.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' '))
        cur = []
      } else cur.push(p)
    }
    if (cur.length > 1) segs.push(cur.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' '))
    return { d: segs.join(' '), hourMarks }
  }
  const seasons = SEASON_DAYS.map((s) => ({ s, ...curve(seasonDayStart(year, s, tz).start) }))
  const sel = curve(dayStartMs)
  const cur = current.alt > 0 ? xy(current.az, current.alt) : null
  const colors: Record<string, string> = { mar: '#a3e635', jun: '#fbbf24', sep: '#fb923c', dec: '#38bdf8' }
  return (
    <>
      <h4>Sun path (looking down on the property, north up)</h4>
      <svg viewBox="0 0 240 250" className="sunpath" role="img" aria-label="Sun path diagram">
        {[0, 30, 60].map((a) => <circle key={a} cx={C} cy={C} r={((90 - a) / 90) * R} fill="none" stroke="rgba(255,255,255,.14)" strokeDasharray={a ? '2 3' : ''} />)}
        <line x1={C - R} y1={C} x2={C + R} y2={C} stroke="rgba(255,255,255,.1)" />
        <line x1={C} y1={C - R} x2={C} y2={C + R} stroke="rgba(255,255,255,.1)" />
        {([['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['W', -1, 0]] as const).map(([t, dx, dy]) => <text key={t} x={C + dx * (R + 11)} y={C + dy * (R + 11) + 4} textAnchor="middle" fill="#8b9ba3" fontSize="11">{t}</text>)}
        <text x={C + 4} y={C - ((90 - 30) / 90) * R + 10} fill="#8b9ba3" fontSize="8">30°</text>
        <text x={C + 4} y={C - ((90 - 60) / 90) * R + 10} fill="#8b9ba3" fontSize="8">60°</text>
        {seasons.map(({ s, d }) => <path key={s.key} d={d} fill="none" stroke={colors[s.key]} strokeOpacity=".55" strokeWidth="1.4" />)}
        <path d={sel.d} fill="none" stroke="#fff" strokeWidth="2.2" />
        {sel.hourMarks.map((m) => (
          <g key={m.h}><circle cx={m.x} cy={m.y} r="2.2" fill="#fff" /><text x={m.x + 4} y={m.y - 3} fill="#cfe" fontSize="8">{m.h}</text></g>
        ))}
        {cur && <circle cx={cur[0]} cy={cur[1]} r="6.5" fill="#fde047" stroke="#7c2d12" strokeWidth="1.5" />}
        <g fontSize="8.5" fill="#aebbc2">
          {SEASON_DAYS.map((s, i) => (
            <g key={s.key} transform={`translate(${6 + i * 58},244)`}><rect width="10" height="3" y="-4" fill={colors[s.key]} /><text x="13" y="0">{s.label.replace(' equinox', ' eq.').replace(' solstice', ' sol.')}</text></g>
          ))}
        </g>
      </svg>
      <p className="note">White line: the chosen date, with local hours marked. Coloured lines: the four season days. {cur ? '' : 'The sun is below the horizon at this time.'}</p>
    </>
  )
}
