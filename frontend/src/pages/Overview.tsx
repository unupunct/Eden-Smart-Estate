import { useMemo, useRef, useState } from 'react'
import { Camera, CloudSun, Droplets, FlaskConical, Map as MapIcon, Plug, Sprout, Thermometer, Trash2, Upload } from 'lucide-react'
import { moonPosition, sunEvents } from '../sun/astro'
import { loadZone } from '../sun/store'
import { dayStart, fmtClock, fmtDuration } from '../sun/tz'
import { api } from '../api/client'
import { fmtArea, fmtLength } from '../geo/measure'
import { useApp } from '../model/app'
import { useEditor } from '../model/store'
import { estateStats } from '../panels/PropertiesPanel'
import { useSmart } from '../smart/store'

export function Overview() {
  const { properties, currentId, open, remove, go, setDialog, refresh } = useApp()
  const property = useEditor((s) => s.property)
  const doc = useEditor((s) => s.doc)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const proj = useRef<HTMLInputElement>(null)
  const st = estateStats(doc)
  const sky = useMemo(() => {
    if (!property) return null
    const tz = loadZone(property.id)
    const now = Date.now()
    const ev = sunEvents(dayStart(now, tz), property.center[1], property.center[0])
    return { tz, ev, moon: moonPosition(now, property.center[1], property.center[0]) }
  }, [property?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const demo = async () => {
    setBusy(true)
    setErr('')
    try {
      const p = await api.createDemo()
      await refresh()
      await open(p.id)
      go('editor')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const confirmDelete = async (id: string, name: string, isDemo: boolean) => {
    if (confirm(isDemo ? `Delete the demo property “${name}”?` : `Permanently delete “${name}” and all of its objects? Export or back up first if unsure.`)) await remove(id)
  }
  const importProject = async (f?: File) => {
    if (!f) return
    try {
      const p = await api.importProject(f)
      await refresh()
      await open(p.id)
      go('editor')
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Estate Overview</h1>
          <p>Your properties and an at-a-glance summary of what is on the land.</p>
        </div>
        <div className="btnrow">
          <button onClick={() => proj.current?.click()}><Upload size={14} /> Import project</button>
          <button className="primary" onClick={() => setDialog('new-property')}>New property</button>
          <input ref={proj} type="file" accept=".json" hidden onChange={(e) => { void importProject(e.target.files?.[0]); e.target.value = '' }} />
        </div>
      </div>
      {err && <div className="notice err">{err}</div>}

      {properties.length === 0 ? (
        <div className="hero glass">
          <h2>Start your digital twin</h2>
          <p>Open a satellite image of your land, trace the boundary, then add buildings, fences, trees, garden zones, a greenhouse and a pond. Everything stays editable and is stored as a real geographic model on this computer.</p>
          <div className="btnrow">
            <button className="primary big" onClick={() => setDialog('new-property')}>Create my property</button>
            <button className="big" disabled={busy} onClick={() => void demo()}><FlaskConical size={16} /> Explore the demo estate</button>
          </div>
          <small>The demo is a fictional estate clearly labelled DEMO DATA; delete it any time.</small>
        </div>
      ) : (
        <>
          <div className="cards">
            {properties.map((p) => (
              <div key={p.id} className={`card glass ${p.id === currentId ? 'current' : ''}`}>
                <div className="cardtop"><MapIcon size={18} /><h3>{p.name}</h3>{p.isDemo && <span className="badge">DEMO DATA</span>}</div>
                <p className="muted">{p.description || 'No description'}</p>
                <small className="muted">{p.objectCount ?? 0} objects · {p.center[1].toFixed(4)}°, {p.center[0].toFixed(4)}°</small>
                <div className="btnrow">
                  <button className="primary" onClick={async () => { await open(p.id); go('editor') }}>Open in editor</button>
                  {p.id !== currentId && <button onClick={() => void open(p.id)}>Select</button>}
                  <button className="danger icon" title="Delete property" onClick={() => void confirmDelete(p.id, p.name, p.isDemo)}><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
            {!properties.some((p) => p.isDemo) && (
              <div className="card glass dashed">
                <div className="cardtop"><FlaskConical size={18} /><h3>Demo estate</h3></div>
                <p className="muted">A fictional rural estate with house, workshop, greenhouse, orchard, pond and more — handy for learning the editor.</p>
                <button disabled={busy} onClick={() => void demo()}>Load demo</button>
              </div>
            )}
          </div>

          {property && (
            <>
              <h2 className="sect">{property.name}</h2>
              {property.isDemo && <div className="demo-note">DEMO DATA — fictional estate. Delete it from the card above to start with your own land.</div>}
              <div className="stats">
                <Stat label="Property area" value={st.boundaryArea ? fmtArea(st.boundaryArea) : 'No boundary drawn'} sub={st.boundaryArea ? `${Math.round(st.boundaryArea).toLocaleString('en-US')} m²` : undefined} />
                <Stat label="Boundary" value={st.boundaryPerimeter ? fmtLength(st.boundaryPerimeter) : '—'} />
                <Stat label="Buildings" value={`${st.counts.building ?? 0}`} sub={fmtArea(st.buildingArea) + ' footprint'} />
                <Stat label="Trees" value={`${st.counts.tree ?? 0}`} sub={`${st.counts.bush ?? 0} bushes`} />
                <Stat label="Garden beds" value={`${st.counts.garden_bed ?? 0}`} sub={fmtArea(st.bedArea)} />
                <Stat label="Fences & hedges" value={fmtLength(st.fenceLen)} />
                <Stat label="Greenhouses" value={`${st.counts.greenhouse ?? 0}`} />
                <Stat label="Pond surface" value={fmtArea(st.pondArea)} />
              </div>
              {sky && (
                <>
                  <h2 className="sect">Sun and moon today <small className="muted">(calculated for the property's location)</small></h2>
                  <div className="stats">
                    <Stat label="Sunrise" value={sky.ev.polar === 'night' ? 'does not rise' : sky.ev.polar === 'day' ? 'stays up' : fmtClock(sky.ev.sunrise, sky.tz)} sub={sky.tz} />
                    <Stat label="Sunset" value={sky.ev.polar ? '—' : fmtClock(sky.ev.sunset, sky.tz)} />
                    <Stat label="Daylight" value={fmtDuration(sky.ev.dayLengthH)} sub={`noon sun ${sky.ev.noonAlt.toFixed(0)}° high`} />
                    <Stat label="Moon" value={sky.moon.phaseName} sub={`${Math.round(sky.moon.illumination * 100)}% lit`} />
                  </div>
                </>
              )}
              <h2 className="sect">Live data</h2>
              <p className="muted">Tiles show only what a connected integration reports. EDEN never shows invented sensor values or camera pictures.</p>
              <LiveTiles placed={st.counts} />
            </>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="stat glass"><small>{label}</small><strong>{value}</strong>{sub && <em>{sub}</em>}</div>
}
function Pending({ icon, label, phase, sub }: { icon: React.ReactNode; label: string; phase: string; sub?: string }) {
  return <div className="stat glass pending">{icon}<small>{label}</small><strong>Not connected</strong><em>{sub ?? `Planned · ${phase}`}</em></div>
}

function LiveTiles({ placed }: { placed: Record<string, number> }) {
  const { integrations, devices, cameras } = useSmart()
  const go = useApp((x) => x.go)
  const online = integrations.filter((i) => i.status === 'online')
  const temp = devices.filter((d) => d.deviceClass === 'temperature' && d.state !== null && !['unavailable', 'unknown'].includes(d.state) && d.integrationStatus === 'online').slice(0, 2)
  const real = devices.filter((d) => d.state !== null)
  const placedDevices = (placed.outlet ?? 0) + (placed.light ?? 0) + (placed.sensor ?? 0)
  return (
    <div className="stats">
      <Pending icon={<CloudSun size={18} />} label="Weather" phase="Phase 6" />
      {temp.length ? temp.map((d) => <Stat key={d.id} label={d.name} value={`${d.state} ${d.unit}`} sub="reported by your integration" />) : <Pending icon={<Thermometer size={18} />} label="Temperature" phase="no temperature sensor connected" />}
      {integrations.length ? (
        <div className="stat glass" onClick={() => go('smart')} style={{ cursor: 'pointer' }}><Plug size={18} /><small>Smart devices</small><strong>{real.length} reporting</strong><em>{devices.length} known · {online.length}/{integrations.length} integrations connected · {Math.max(0, placedDevices - devices.filter((d) => d.objectId).length)} map positions unlinked</em></div>
      ) : <Pending icon={<Plug size={18} />} label="Smart devices" phase="Phase 5" sub={`${placedDevices} placed on the map, none connected`} />}
      {cameras.length ? (
        <div className="stat glass" onClick={() => go('security')} style={{ cursor: 'pointer' }}><Camera size={18} /><small>Cameras</small><strong>{cameras.length} configured</strong><em>pictures load on the Security page</em></div>
      ) : <Pending icon={<Camera size={18} />} label="Cameras" phase="Phase 5" sub={`${placed.camera ?? 0} placed on the map, none connected`} />}
      <Pending icon={<Sprout size={18} />} label="Greenhouse conditions" phase="needs a linked sensor" />
      <Pending icon={<Droplets size={18} />} label="Pond water quality" phase="manual log on the Pond page" />
    </div>
  )
}
