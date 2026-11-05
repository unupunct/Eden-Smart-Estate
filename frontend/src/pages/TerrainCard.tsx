import { useEffect, useMemo, useState } from 'react'
import { elevationCells, useTerrain } from '../terrain/terrain'
import { compass, sunPosition } from '../sun/astro'
import { useSun } from '../sun/store'

/** Sun page: the lie of the land (elevation, slope, aspect) and the horizon it makes. */
export function TerrainCard({ propertyId, lat, lng, dayStartMs }: { propertyId: string; lat: number; lng: number; dayStartMs: number }) {
  const t = useTerrain()
  const sun = useSun()
  const [pick, setPick] = useState('terrarium') // new installations are offered the finer source first
  useEffect(() => { void useTerrain.getState().loadSettings(); void useTerrain.getState().load(propertyId) }, [propertyId])
  // elevation tint on the map
  useEffect(() => {
    const on = sun.terrainOn && t.data
    useSun.getState().set({ terrain: on ? elevationCells(t.data!) : null })
  }, [sun.terrainOn, t.data])
  useEffect(() => () => useSun.getState().set({ terrain: null, terrainOn: false }), [])

  const path = useMemo(() => {
    const pts: { az: number; alt: number }[] = []
    for (let m = 0; m < 1440; m += 10) {
      const s = sunPosition(dayStartMs + m * 60000, lat, lng)
      if (s.alt > -2) pts.push({ az: s.az, alt: s.alt })
    }
    return pts
  }, [dayStartMs, lat, lng])

  const d = t.data
  const topAlt = d ? Math.max(10, Math.ceil(d.horizonMax.alt * 1.6)) : 10
  // the part of the sun's path that is below the top of the chart, as separate runs (never a line across the part that is above it)
  const runs = useMemo(() => {
    const out: { az: number; alt: number }[][] = []
    let cur: { az: number; alt: number }[] = []
    for (const p of path) {
      if (p.alt <= topAlt) cur.push(p)
      else if (cur.length) { out.push(cur); cur = [] }
    }
    if (cur.length) out.push(cur)
    return out
  }, [path, topAlt])
  const W = 330, H = 96, L = 24, B = 16
  const top = d ? Math.max(10, Math.ceil(d.horizonMax.alt * 1.6)) : 10
  const x = (az: number) => L + (az / 360) * (W - L - 4)
  const y = (alt: number) => H - B - (Math.min(alt, top) / top) * (H - B - 6)

  return (
    <>
      <h4>Terrain</h4>
      {!t.enabled && !d && (
        <>
          <p className="note">Switched off. Turn it on to look up the ground height around the property, tilt beds to the lie of the land and let hills on the skyline count in the sun hours. Nothing is sent unless you turn it on. Choose where the heights come from:</p>
          <div className="radios" role="radiogroup" aria-label="Elevation data source">
            {[...(t.providers.length ? t.providers : [{ id: 'terrarium', name: 'Terrain Tiles on AWS (about 30 m)', resolutionM: 30, licence: '', sends: 'only the numbers of the map tiles that cover the property' }])].sort((a, b) => a.resolutionM - b.resolutionM).map((p) => (
              <label key={p.id} className="check"><input type="radio" name="terrain-source" checked={pick === p.id} onChange={() => setPick(p.id)} /> <span><b>{p.name}</b><small className="muted"> sends {p.sends}</small></span></label>
            ))}
          </div>
          <button onClick={() => void t.setEnabled(propertyId, true, pick).catch((e) => useTerrain.setState({ error: (e as Error).message }))}>Turn on terrain</button>
        </>
      )}
      {t.loading && <p className="note">Looking up the terrain…</p>}
      {t.error && <p className="warn" role="alert">{t.error}</p>}
      {d && (
        <>
          <dl className="kv">
            <div className="kvrow"><dt>Ground height</dt><dd>{d.elevation.toFixed(0)} m above sea level</dd></div>
            <div className="kvrow"><dt>Slope here</dt><dd>{d.slopeDeg.toFixed(1)}°{d.aspectDeg === null ? ' (flat)' : `, facing ${d.aspect} (${d.aspectDeg.toFixed(0)}°)`}</dd></div>
            <div className="kvrow"><dt>Height range</dt><dd>{d.localRelief.toFixed(0)} m within 180 m · {d.regionRelief.toFixed(0)} m within 2 km</dd></div>
            <div className="kvrow"><dt>Highest skyline</dt><dd>{d.horizonMax.alt.toFixed(1)}° towards {compass(d.horizonMax.az)}</dd></div>
          </dl>
          <svg viewBox={`0 0 ${W} ${H}`} className="horizonchart" role="img" aria-label={`Skyline of the surrounding land and the sun's path on the chosen day. Highest skyline ${d.horizonMax.alt.toFixed(1)} degrees towards ${compass(d.horizonMax.az)}.`}>
            <rect x={L} y={6} width={W - L - 4} height={H - B - 6} fill="none" stroke="currentColor" opacity={0.25} />
            <path d={`M${x(0)},${y(0)} ${[...d.horizon, d.horizon[0]].map((h, i) => `L${x(i * 10)},${y(h.alt)}`).join(' ')} L${x(360)},${y(0)} Z`} fill="#6b7280" opacity={0.65} />
            {runs.map((run, i) => run.length > 1 && <polyline key={i} fill="none" stroke="#fbbf24" strokeWidth={1.6} points={run.map((p) => `${x(p.az)},${y(p.alt)}`).join(' ')} />)}
            {[0, 90, 180, 270, 360].map((a) => <text key={a} x={x(a)} y={H - 3} fontSize={9} textAnchor="middle" fill="currentColor" opacity={0.7}>{a === 360 ? 'N' : compass(a)}</text>)}
            <text x={2} y={y(0) + 3} fontSize={8} fill="currentColor" opacity={0.7}>0°</text>
            <text x={2} y={y(top) + 3} fontSize={8} fill="currentColor" opacity={0.7}>{top}°</text>
          </svg>
          <small className="muted">Grey: the skyline of the land; amber: the sun’s path on the chosen day (the part below {top}°).</small>
          <label className="check"><input type="checkbox" checked={t.blocks} onChange={(e) => t.set({ blocks: e.target.checked })} /> Hills on the skyline block the sun in the sun-hours figures</label>
          <label className="check"><input type="checkbox" checked={t.tilt} onChange={(e) => t.set({ tilt: e.target.checked })} /> Tilt beds and the sun map to the lie of the land (a slope facing the sun gets more, one facing away gets less)</label>
          <label className="check"><input type="checkbox" checked={sun.terrainOn} onChange={(e) => sun.set({ terrainOn: e.target.checked })} /> Show ground height on the map</label>
          {t.providers.length > 1 && (
            <label className="check">Elevation source{' '}
              <select value={t.providerId} onChange={(e) => void t.setEnabled(propertyId, true, e.target.value).catch((er) => useTerrain.setState({ error: (er as Error).message }))} aria-label="Elevation source">
                {t.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          {sun.terrainOn && <div className="heatlegend"><i style={{ background: 'linear-gradient(90deg,#1e3a8a,#0e7490,#65a30d,#ca8a04,#92400e,#f5f5f4)' }} /><span>low</span><span /><span /><span /><span>high</span></div>}
          <div className="btnrow">
            <button className="chip" disabled={t.loading || !t.enabled} onClick={() => void t.load(propertyId, true)}>Look up again</button>
            <button className="chip danger" onClick={() => void t.forget(propertyId)}>Forget terrain</button>
            {t.enabled && <button className="chip" onClick={() => void t.setEnabled(propertyId, false)}>Turn off lookups</button>}
          </div>
          <small className="muted">Looked up {new Date(d.fetchedAt).toLocaleDateString()}{d.stale ? ' (could not be refreshed; this is the last real answer)' : ''}. {d.source.attribution} ({d.source.licence}). {d.source.resolutionM} m resolution surface model: hills and valleys yes, terraces and garden mounds no; trees and buildings may appear in it. The skyline is seen from the property centre.</small>
        </>
      )}
    </>
  )
}
