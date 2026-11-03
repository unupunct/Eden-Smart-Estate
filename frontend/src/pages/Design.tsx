import { useMemo, useState } from 'react'
import { fmtArea, measureGeom } from '../geo/measure'
import { analyseBed, companionsOf, compass, fishVerdict, matureCanopy, orchardStats, orientedBox, pollinationCheck, pondVolume, treeAge, waterIssues } from '../library/logic'
import { startPlacing } from '../library/place'
import { useLibrary } from '../library/store'
import type { Fish, Planting, StockedFish, WaterReading } from '../library/types'
import { useApp } from '../model/app'
import { kindDef, num } from '../model/kinds'
import { useEditor } from '../model/store'
import type { EdenObject } from '../model/types'
import { insideObjects, LEGEND, LevelChip } from '../panels/DesignSections'

function Head({ title, text, badge }: { title: string; text: string; badge?: string }) {
  return <div className="pagehead"><div><h1>{title}</h1><p>{text}</p></div>{badge && <span className="badge">{badge}</span>}</div>
}

function useShow() {
  const focus = useEditor((s) => s.requestFocus)
  const go = useApp((s) => s.go)
  return (id: string) => { focus(id); go('editor') }
}

const Empty = ({ what }: { what: string }) => <p className="empty">No {what} on this property yet. Draw some in the Property Editor.</p>

// ---------------------------------------------------------------------------------------------- garden
export function GardenPage() {
  const objects = useEditor((s) => s.doc.objects)
  const property = useEditor((s) => s.property)
  const { ix, lib } = useLibrary()
  const show = useShow()
  const [explore, setExplore] = useState('tomato')
  const beds = Object.values(objects).filter((o) => o.kind === 'garden_bed')
  const zones = Object.values(objects).filter((o) => o.kind === 'zone')
  const loose = Object.values(objects).filter((o) => o.kind === 'plant')
  if (!ix || !lib) return <div className="page"><p>Loading…</p></div>
  const sug = companionsOf(ix, explore)
  return (
    <div className="page">
      <Head title="Garden & Permaculture" text="Beds, zones and plantings with companion-planting checks. Draw beds in the Property Editor, then list their crops in the bed's panel." badge="Phase 3" />
      {!property && <p className="empty">Open or create a property first.</p>}
      <h2 className="sect">Garden beds</h2>
      <div className="glass tablewrap">
        <table>
          <thead><tr><th>Bed</th><th>Area</th><th>Plantings</th><th>Plants</th><th>Companion check</th><th /></tr></thead>
          <tbody>
            {beds.map((b) => {
              const plantings: Planting[] = Array.isArray(b.props.plantings) ? (b.props.plantings as Planting[]) : []
              const an = analyseBed(ix, measureGeom(b.geometry).area, plantings)
              return (
                <tr key={b.id}>
                  <td>{b.name}</td><td>{fmtArea(measureGeom(b.geometry).area)}</td>
                  <td>{plantings.map((p) => ix.plants.get(p.speciesId)?.name ?? p.speciesId).join(', ') || <span className="muted">none yet</span>}</td>
                  <td>{an.total || '—'}</td>
                  <td>{an.worst ? <LevelChip level={an.worst} label={{ green: 'Good', yellow: 'Check notes', red: 'Conflict' }[an.worst]} /> : <span className="muted">—</span>}{an.crowded && <small className="warn"> overcrowded</small>}</td>
                  <td><button onClick={() => show(b.id)}>Open</button></td>
                </tr>
              )
            })}
            {!beds.length && <tr><td colSpan={6}><Empty what="garden beds" /></td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted">{zones.length} zone{zones.length === 1 ? '' : 's'} and {loose.length} individually placed plants are also on the map.</p>

      <h2 className="sect">Companion planting explorer</h2>
      <p className="muted">Pick a plant to see what the data says about it. Every entry shows how strong the evidence is — tradition is not presented as science.</p>
      <label style={{ maxWidth: 360 }}>Plant
        <select value={explore} onChange={(e) => setExplore(e.target.value)}>
          {lib.plants.filter((p) => ix.byPlant.has(p.id)).sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      {LEGEND}
      <div className="glass formcard">
        {sug.map((c) => (
          <div key={c.other} className="rel">
            <LevelChip level={c.level} evidence={c.rel.evidence} />
            <div><strong>{ix.plants.get(c.other)?.name}</strong>
              {c.level !== 'red' && <button className="link" onClick={() => startPlacing(ix, c.other)}>place on map</button>}
              <p className="note">{c.rel.note}</p></div>
          </div>
        ))}
      </div>
      <p className="note">{lib.disclaimers.data}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- orchard
export function OrchardPage() {
  const objects = useEditor((s) => s.doc.objects)
  const setShowMature = useEditor((s) => s.setShowMature)
  const go = useApp((s) => s.go)
  const { ix } = useLibrary()
  const show = useShow()
  const stats = useMemo(() => (ix ? orchardStats(ix, objects) : null), [ix, objects])
  if (!ix || !stats) return <div className="page"><p>Loading…</p></div>
  const trees = Object.values(objects).filter((o) => o.kind === 'tree')
  const areas = Object.values(objects).filter((o) => o.kind === 'orchard_area')
  const areaM2 = areas.reduce((s, a) => s + measureGeom(a.geometry).area, 0)
  const status = (t: EdenObject) => pollinationCheck(ix, objects, t.id).status
  const label = { 'self-fertile': 'self-fertile', 'partner-found': 'partner nearby', 'partner-missing': 'NO PARTNER', 'unknown-variety': 'variety needed', 'no-data': '—' } as const
  return (
    <div className="page">
      <Head title="Orchard" text="Every tree on the property: species, variety, age, mature size and pollination." badge="Phase 3" />
      <div className="btnrow"><button onClick={() => { setShowMature(true); go('editor') }}>Show mature canopy on the map</button></div>
      <div className="stats">
        <div className="stat glass"><small>Trees</small><strong>{stats.trees}</strong><em>{stats.bySpecies.length} species</em></div>
        <div className="stat glass"><small>Average age</small><strong>{stats.avgAge === null ? '—' : `${stats.avgAge.toFixed(1)} yr`}</strong><em>from planting year</em></div>
        <div className="stat glass"><small>Mature canopy</small><strong>{fmtArea(stats.matureCanopyArea)}</strong><em>{areaM2 ? `${Math.round((stats.matureCanopyArea / areaM2) * 100)}% of orchard area (${fmtArea(areaM2)})` : 'no orchard area drawn'}</em></div>
        <div className="stat glass"><small>Not linked to library</small><strong>{stats.unknownSpecies}</strong><em>pick a species for pollination data</em></div>
      </div>
      <h2 className="sect">By species</h2>
      <div className="glass tablewrap">
        <table><thead><tr><th>Species</th><th>Trees</th><th>Varieties</th></tr></thead>
          <tbody>{stats.bySpecies.map((s) => <tr key={s.key}><td>{s.label}</td><td>{s.count}</td><td className="muted">{s.varieties.join(', ') || '—'}</td></tr>)}
            {!stats.bySpecies.length && <tr><td colSpan={3}><Empty what="trees" /></td></tr>}</tbody></table>
      </div>
      <h2 className="sect">Trees</h2>
      <div className="glass tablewrap">
        <table><thead><tr><th>Tree</th><th>Variety</th><th>Age</th><th>Canopy now / mature</th><th>Pollination</th><th /></tr></thead>
          <tbody>{trees.map((t) => {
            const sp = typeof t.props.speciesId === 'string' ? ix.plants.get(t.props.speciesId) : undefined
            const age = treeAge(t.props.plantedYear)
            const st = status(t)
            return (
              <tr key={t.id}><td>{t.name}</td><td>{String(t.props.variety ?? '') || '—'}</td><td>{age === null ? '—' : `${age} yr`}</td>
                <td>{num(t.props.canopy, 0) || '—'} m / {matureCanopy(t, sp)} m</td>
                <td className={st === 'partner-missing' ? 'warn' : ''}>{label[st]}</td>
                <td><button onClick={() => show(t.id)}>Show</button></td></tr>
            )
          })}</tbody></table>
      </div>
      <p className="note">Pollination checks look for a different named variety of the same species within 50 m. Real compatibility depends on each cultivar's pollination group and flowering time — confirm with your nursery.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- greenhouse
export function GreenhousePage() {
  const objects = useEditor((s) => s.doc.objects)
  const show = useShow()
  const houses = Object.values(objects).filter((o) => o.kind === 'greenhouse')
  return (
    <div className="page">
      <Head title="Greenhouse" text="Footprint, orientation, interior equipment and target ranges for every greenhouse." badge="Phase 3" />
      <div className="notice">Live monitoring (temperature, humidity, soil moisture, light, CO₂, tank level, ventilation, heating, irrigation) needs connected sensors. <strong>None are connected</strong>, so no readings are shown. Targets you set here are stored for the upcoming alerts and automation.</div>
      <div className="cardgrid">
        {houses.map((g) => {
          if (g.geometry.type !== 'Polygon') return null
          const box = orientedBox(g.geometry.coordinates[0])
          const inside = insideObjects(g, objects, (x) => x.kind.startsWith('gh_') || x.kind === 'sensor' || x.kind === 'outlet')
          const counts = new Map<string, number>()
          for (const i of inside) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1)
          const p = g.props
          const range = (a: string, b: string, u: string) => (p[a] !== undefined || p[b] !== undefined ? `${p[a] ?? '…'} – ${p[b] ?? '…'} ${u}` : 'not set')
          return (
            <div key={g.id} className="card glass">
              <div className="cardtop"><h3>{g.name || 'Greenhouse'}</h3></div>
              <dl className="kv">
                <dt>Size</dt><dd>{box.length.toFixed(1)} × {box.width.toFixed(1)} m</dd>
                <dt>Floor area</dt><dd>{fmtArea(measureGeom(g.geometry).area)}</dd>
                <dt>Long axis</dt><dd>{Math.round(box.bearing)}° ({compass(box.bearing)}–{compass(box.bearing + 180)})</dd>
                <dt>Height / roof</dt><dd>{num(p.height, 0) || '—'} m / {String(p.roofType ?? '—')}</dd>
                <dt>Target temperature</dt><dd>{range('tempMin', 'tempMax', '°C')}</dd>
                <dt>Target humidity</dt><dd>{range('humMin', 'humMax', '%')}</dd>
                <dt>Target soil moisture</dt><dd>{range('soilMin', 'soilMax', '%')}</dd>
              </dl>
              <h4>Inside</h4>
              {[...counts.entries()].map(([k, n]) => <div key={k} className="kvrow2"><span>{kindDef(k).label}</span><b>{n}</b></div>)}
              {!counts.size && <p className="empty">Nothing drawn inside yet.</p>}
              <div className="notice">Monitoring: no sensors connected.</div>
              <div className="btnrow"><button className="primary" onClick={() => show(g.id)}>Open in editor</button></div>
            </div>
          )
        })}
      </div>
      {!houses.length && <Empty what="greenhouses" />}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- pond
export function PondPage() {
  const objects = useEditor((s) => s.doc.objects)
  const { lib, ix } = useLibrary()
  const show = useShow()
  if (!lib || !ix) return <div className="page"><p>Loading…</p></div>
  const ponds = Object.values(objects).filter((o) => o.kind === 'pond')
  const zones = Object.values(objects).filter((o) => o.kind === 'pond_zone')
  const features = Object.values(objects).filter((o) => o.kind.startsWith('pond_') && o.kind !== 'pond_zone')
  return (
    <div className="page">
      <Head title="Natural Swimming Pond" text="Surface, estimated volume, zones, fish suitability and your water-quality log." badge="Phase 3" />
      <div className="notice">Water quality values come from <strong>manual entries</strong> in the pond's panel. No sensor is connected. Volume is a planning estimate, not a survey.</div>
      <div className="cardgrid">
        {ponds.map((p) => {
          const v = pondVolume(p, zones)
          const fish: StockedFish[] = Array.isArray(p.props.fish) ? (p.props.fish as StockedFish[]) : []
          const log: WaterReading[] = Array.isArray(p.props.waterLog) ? (p.props.waterLog as WaterReading[]) : []
          const last = [...log].sort((a, b) => a.date.localeCompare(b.date)).pop()
          const issues = last ? waterIssues(last, lib.waterQuality.ranges) : []
          const myZones = zones.filter((z) => insideObjects(p, { [z.id]: z }, () => true).length)
          return (
            <div key={p.id} className="card glass">
              <div className="cardtop"><h3>{p.name || 'Pond'}</h3></div>
              <dl className="kv">
                <dt>Surface</dt><dd>{fmtArea(v.surface)}</dd>
                <dt>Volume (estimate)</dt><dd>≈ {Math.round(v.volume)} m³</dd>
                <dt>Max depth</dt><dd>{num(p.props.maxDepth, 0) || '—'} m</dd>
                <dt>Zones</dt><dd>{myZones.map((z) => `${z.name} (${fmtArea(measureGeom(z.geometry).area)})`).join(', ') || 'none'}</dd>
              </dl>
              <h4>Fish</h4>
              {fish.map((f, i) => {
                const sp: Fish | undefined = ix.fish.get(f.speciesId)
                const vd = sp ? fishVerdict(sp, v.surface, f.qty) : null
                return <div key={i} className="rel"><span className={`pill ${vd?.level === 'ok' ? 'native' : vd?.level === 'caution' ? 'cooked' : 'toxic'}`}>{vd?.level === 'ok' ? 'suitable' : vd?.level === 'caution' ? 'caution' : 'not suitable'}</span><div><strong>{f.qty} × {sp?.name ?? f.speciesId}</strong>{vd?.messages.map((m, k) => <p key={k} className="note">{m}</p>)}</div></div>
              })}
              {!fish.length && <p className="empty">No fish recorded (often the best choice for a swimming pond).</p>}
              <h4>Latest water reading</h4>
              {last ? <p>{last.date}: {Object.entries(last).filter(([k, val]) => k !== 'date' && k !== 'note' && typeof val === 'number').map(([k, val]) => `${k} ${val}`).join(' · ')}</p> : <p className="empty">No readings logged.</p>}
              {issues.map((i, k) => <div key={k} className="notice warnbox">⚠ {i.message}</div>)}
              <div className="btnrow"><button className="primary" onClick={() => show(p.id)}>Open in editor</button></div>
            </div>
          )
        })}
      </div>
      {!ponds.length && <Empty what="ponds" />}
      {features.length > 0 && <p className="muted">Pond equipment on the map: {features.map((f) => f.name || kindDef(f.kind).label).join(', ')}.</p>}
      <h2 className="sect">Aquatic planting guide</h2>
      <p className="muted">Browse all species, including the invasive ones to avoid, in the Plants &amp; Mushrooms library (Aquatic plants tab).</p>
      <div className="stats">
        {(['oxygenating', 'floating', 'deep', 'shallow', 'marginal'] as const).map((z) => (
          <div key={z} className="stat glass"><small>{z}</small><strong>{lib.aquatic.filter((a) => a.zone === z && !a.avoid).length} species</strong><em>{lib.aquatic.filter((a) => a.zone === z && !a.avoid).slice(0, 3).map((a) => a.name).join(', ')}</em></div>
        ))}
      </div>
    </div>
  )
}
