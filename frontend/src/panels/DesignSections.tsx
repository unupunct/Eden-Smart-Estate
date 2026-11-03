import { useMemo, useState } from 'react'
import { MapPin, Plus, Trash2 } from 'lucide-react'
import { centroid, fmtArea, fmtLength, measureGeom } from '../geo/measure'
import { useLibrary } from '../library/store'
import { startPlacing, placementFor } from '../library/place'
import {
  EVIDENCE_LABEL, LEVEL_COLOR, analyseBed, companionsOf, compass, fishVerdict, gridInPolygon, matureCanopy, monthRange, neighbourLinks, orientedBox,
  pointInRing, pollinationCheck, pondVolume, treeAge, waterIssues,
} from '../library/logic'
import type { Evidence, Level, LogEntry, Planting, StockedFish, WaterReading } from '../library/types'
import { kindDef } from '../model/kinds'
import { createObject } from '../model/ops'
import { useEditor } from '../model/store'
import type { EdenObject } from '../model/types'

export function LevelChip({ level, evidence, label }: { level: Level; evidence?: Evidence; label?: string }) {
  return (
    <span className="lvl" style={{ borderColor: LEVEL_COLOR[level], color: LEVEL_COLOR[level] }}>
      <i style={{ background: LEVEL_COLOR[level] }} /> {label ?? { green: 'Compatible', yellow: 'Conditional / uncertain', red: 'Avoid' }[level]}
      {evidence && <em> · {EVIDENCE_LABEL[evidence]}</em>}
    </span>
  )
}

export const LEGEND = (
  <p className="note legend">
    <LevelChip level="green" label="Compatible (documented)" /> <LevelChip level="yellow" label="Conditional or only traditional / mixed evidence" /> <LevelChip level="red" label="Known incompatibility" />
  </p>
)

export function SpeciesSelect({ place, value, onChange }: { place?: 'tree' | 'bush' | 'plant'; value: string; onChange: (id: string) => void }) {
  const lib = useLibrary((s) => s.lib)
  if (!lib) return <select disabled><option>Loading plant library…</option></select>
  const plants = lib.plants.filter((p) => !place || p.place === place || (place === 'plant' && p.place !== 'tree')).filter((p) => !p.cats.includes('toxic') || p.id === value).sort((a, b) => a.name.localeCompare(b.name))
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— not from the library —</option>
      {plants.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sci})</option>)}
      {place === 'plant' && <optgroup label="Aquatic plants">{lib.aquatic.filter((a) => !a.avoid).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.sci})</option>)}</optgroup>}
    </select>
  )
}

/** Dispatches to the design sections that belong to an object kind. */
export function KindSections({ o }: { o: EdenObject }) {
  switch (o.kind) {
    case 'garden_bed': return <PlantingsSection o={o} />
    case 'plant': return <><SpeciesFacts o={o} /><NeighbourSection o={o} /></>
    case 'bush': return <><SpeciesFacts o={o} /><NeighbourSection o={o} /></>
    case 'tree': return <><SpeciesFacts o={o} /><TreeSection o={o} /><NeighbourSection o={o} /></>
    case 'orchard_area': return <OrchardGrid o={o} />
    case 'greenhouse': return <GreenhouseSection o={o} />
    case 'pond': return <PondSection o={o} />
    default: return null
  }
}

// ------------------------------------------------------------------ species facts
function SpeciesFacts({ o }: { o: EdenObject }) {
  const ix = useLibrary((s) => s.ix)
  const id = typeof o.props.speciesId === 'string' ? o.props.speciesId : ''
  const p = ix?.plants.get(id)
  const a = ix?.aquatic.get(id)
  if (!p && !a) return null
  if (a) return <div className="infobox"><strong>{a.name}</strong> <small>{a.sci}</small><p>{a.notes}</p>{a.tox && <p className="warn">⚠ {a.tox}</p>}</div>
  if (!p) return null
  return (
    <div className="infobox">
      <strong>{p.name}</strong> <small>{p.sci} · {p.family}</small>
      <dl className="kv">
        <dt>Sun / water</dt><dd>{p.sun.replace('-', ' to ')} / {p.water}</dd>
        <dt>Mature size</dt><dd>{p.height} m high{p.canopy ? `, ${p.canopy} m canopy` : ''}</dd>
        <dt>Flowers</dt><dd>{monthRange(p.flower)}</dd>
        <dt>Harvest</dt><dd>{monthRange(p.harvest)}</dd>
        <dt>Sow / plant</dt><dd>{monthRange(p.sow)}</dd>
      </dl>
      {p.tox && <p className="warn">⚠ {p.tox}</p>}
      {p.notes && <p className="note">{p.notes}</p>}
    </div>
  )
}

// ------------------------------------------------------------------ neighbours
function NeighbourSection({ o }: { o: EdenObject }) {
  const ix = useLibrary((s) => s.ix)
  const objects = useEditor((s) => s.doc.objects)
  const id = typeof o.props.speciesId === 'string' ? o.props.speciesId : ''
  const links = useMemo(() => (ix ? neighbourLinks(ix, objects, o.id) : []), [ix, objects, o.id])
  const sug = useMemo(() => (ix && id ? companionsOf(ix, id) : []), [ix, id])
  if (!ix || !id) return null
  return (
    <>
      <h4>Companion planting</h4>
      {links.length === 0 && <p className="note">No known relationships with plants nearby (checked within 6 m; 15 m around walnut trees).</p>}
      {links.map((l, i) => (
        <div key={i} className="rel">
          <LevelChip level={l.level} evidence={l.rel.evidence} />
          <div><strong>{ix.plants.get(l.b)?.name ?? l.b}</strong> <small className="muted">{l.other.name && l.other.name !== ix.plants.get(l.b)?.name ? `${l.other.name} · ` : ''}{l.distance < 0.05 ? 'in the bed' : `${fmtLength(l.distance)} away`}</small><p className="note">{l.rel.note}</p></div>
        </div>
      ))}
      <details className="more">
        <summary>All known companions of {ix.plants.get(id)?.name} ({sug.length})</summary>
        {LEGEND}
        {sug.map((c) => (
          <div key={c.other} className="rel">
            <LevelChip level={c.level} evidence={c.rel.evidence} />
            <div>
              <strong>{ix.plants.get(c.other)?.name}</strong>
              {c.level !== 'red' && placementFor(ix, c.other) && <button className="link" title="Place this plant on the map" onClick={() => startPlacing(ix, c.other)}><MapPin size={12} /> place</button>}
              <p className="note">{c.rel.note}</p>
            </div>
          </div>
        ))}
        {!sug.length && <p className="empty">The library has no recorded relationships for this plant. That does not mean it is incompatible with anything.</p>}
      </details>
    </>
  )
}

// ------------------------------------------------------------------ garden bed plantings
function PlantingsSection({ o }: { o: EdenObject }) {
  const ix = useLibrary((s) => s.ix)
  const patch = useEditor((s) => s.patchObject)
  const plantings: Planting[] = Array.isArray(o.props.plantings) ? (o.props.plantings as Planting[]) : []
  const area = measureGeom(o.geometry).area
  const an = useMemo(() => (ix ? analyseBed(ix, area, plantings) : null), [ix, area, plantings])
  const set = (next: Planting[]) => patch(o.id, { props: { plantings: next } }, `plantings:${o.id}`)
  const edit = (i: number, p: Partial<Planting>) => set(plantings.map((x, j) => (j === i ? { ...x, ...p } : x)))
  const [adding, setAdding] = useState('')
  if (!ix) return null
  return (
    <>
      <h4>Plantings</h4>
      <p className="note">Bed {fmtArea(area)}. Add the crops you plan to grow together; EDEN checks every pair against the companion-planting data.</p>
      {plantings.map((p, i) => {
        const sp = ix.plants.get(p.speciesId)
        const info = an?.perPlanting[i]
        return (
          <div key={i} className="planting">
            <div className="row">
              <strong>{sp?.name ?? p.speciesId}</strong>
              <button className="icon" title="Remove" onClick={() => set(plantings.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
            </div>
            <div className="three">
              <label>Plants<input type="number" min={0} value={p.count ?? ''} onChange={(e) => edit(i, { count: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
              <label>Spacing cm<input type="number" min={5} placeholder={String(sp?.spacing ?? '')} value={p.spacing ?? ''} onChange={(e) => edit(i, { spacing: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
              <label>Sown / planted<input type="date" value={p.sown ?? ''} onChange={(e) => edit(i, { sown: e.target.value || undefined })} /></label>
            </div>
            <small className="muted">Room for about {info?.room ?? '?'} alone at {info?.spacing} cm · harvest {monthRange(sp?.harvest)} · sow {monthRange(sp?.sow)}</small>
            {sp?.tox && <p className="warn">⚠ {sp.tox}</p>}
          </div>
        )
      })}
      <div className="inline">
        <SpeciesSelect place="plant" value={adding} onChange={(id) => { if (id) { set([...plantings, { speciesId: id, spacing: ix.plants.get(id)?.spacing }]); setAdding('') } }} />
        <Plus size={16} />
      </div>
      {an && an.total > 0 && <dl className="kv"><dt>Total plants</dt><dd>{an.total}</dd><dt>Plants per m²</dt><dd>{(an.total / Math.max(area, 0.01)).toFixed(1)}</dd></dl>}
      {an?.crowded && <div className="notice">The planned counts need more room than this bed has at the chosen spacings.</div>}
      {an && an.pairs.length > 0 && <h4>Companion check</h4>}
      {an?.pairs.map((p, i) => (
        <div key={i} className="rel">
          <LevelChip level={p.level} evidence={p.rel.evidence} />
          <div><strong>{ix.plants.get(p.a)?.name} + {ix.plants.get(p.b)?.name}</strong><p className="note">{p.rel.note}</p></div>
        </div>
      ))}
      {an && plantings.length > 1 && an.pairs.length === 0 && <p className="note">No recorded relationships between these crops (neither good nor bad).</p>}
      {LEGEND}
    </>
  )
}

// ------------------------------------------------------------------ tree records
function LogList({ title, items, onChange }: { title: string; items: LogEntry[]; onChange: (v: LogEntry[]) => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  return (
    <details className="more">
      <summary>{title} ({items.length})</summary>
      {[...items].sort((a, b) => b.date.localeCompare(a.date)).map((e, i) => (
        <div key={i} className="logrow"><small>{e.date}</small><span>{e.note}</span><button className="icon" onClick={() => onChange(items.filter((x) => x !== e))}><Trash2 size={12} /></button></div>
      ))}
      <div className="inline"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /><input placeholder="What was done?" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && note.trim() && (onChange([...items, { date, note: note.trim() }]), setNote(''))} />
        <button disabled={!note.trim()} onClick={() => { onChange([...items, { date, note: note.trim() }]); setNote('') }}>Add</button></div>
    </details>
  )
}

function TreeSection({ o }: { o: EdenObject }) {
  const ix = useLibrary((s) => s.ix)
  const objects = useEditor((s) => s.doc.objects)
  const patch = useEditor((s) => s.patchObject)
  const setSel = useEditor((s) => s.setSelection)
  const showMature = useEditor((s) => s.showMature)
  const setShowMature = useEditor((s) => s.setShowMature)
  const sp = ix && typeof o.props.speciesId === 'string' ? ix.plants.get(o.props.speciesId) : undefined
  const poll = useMemo(() => (ix ? pollinationCheck(ix, objects, o.id) : null), [ix, objects, o.id])
  const age = treeAge(o.props.plantedYear)
  const log = (k: string) => (Array.isArray(o.props[k]) ? (o.props[k] as LogEntry[]) : [])
  const setLog = (k: string) => (v: LogEntry[]) => patch(o.id, { props: { [k]: v } }, `${k}:${o.id}`)
  const icon = { 'self-fertile': '✓', 'partner-found': '✓', 'partner-missing': '⚠', 'unknown-variety': 'ℹ', 'no-data': 'ℹ' } as const
  return (
    <>
      <h4>Tree record</h4>
      <dl className="kv">
        <dt>Age</dt><dd>{age === null ? '—' : `${age} year${age === 1 ? '' : 's'}`}</dd>
        <dt>Mature canopy</dt><dd>{matureCanopy(o, sp)} m across</dd>
        <dt>Mature height</dt><dd>{sp ? `${sp.height} m` : '—'}</dd>
      </dl>
      <label className="check"><input type="checkbox" checked={showMature} onChange={(e) => setShowMature(e.target.checked)} /> Show projected mature canopy on the map</label>
      {poll && (
        <div className={`notice ${poll.status === 'partner-missing' ? 'warnbox' : ''}`}>
          <strong>{icon[poll.status]} Pollination: {{ 'self-fertile': 'self-fertile', 'partner-found': 'partner nearby', 'partner-missing': 'no partner within 50 m', 'unknown-variety': 'variety needed', 'no-data': 'no data' }[poll.status]}</strong>
          <p className="note">{poll.note}</p>
          {poll.partners.map((p) => <button key={p.tree.id} className="link" onClick={() => setSel([p.tree.id])}>{p.tree.name} · {String(p.tree.props.variety ?? '')} · {fmtLength(p.distance)}</button>)}
        </div>
      )}
      <LogList title="Pruning history" items={log('pruning')} onChange={setLog('pruning')} />
      <LogList title="Fertilisation history" items={log('fertilizing')} onChange={setLog('fertilizing')} />
      <LogList title="Pests and diseases" items={log('pests')} onChange={setLog('pests')} />
    </>
  )
}

// ------------------------------------------------------------------ orchard grid
function OrchardGrid({ o }: { o: EdenObject }) {
  const ix = useLibrary((s) => s.ix)
  const layers = useEditor((s) => s.doc.layers)
  const addObjects = useEditor((s) => s.addObjects)
  const notify = useEditor((s) => s.notify)
  const [sid, setSid] = useState('apple')
  const [along, setAlong] = useState(0)
  const [across, setAcross] = useState(0)
  const [angle, setAngle] = useState(0)
  const [stagger, setStagger] = useState(false)
  const sp = ix?.plants.get(sid)
  const sa = along || (sp ? sp.spacing / 100 : 5)
  const sc = across || sa
  const pts = useMemo(() => (o.geometry.type === 'Polygon' && ix && sp ? gridInPolygon(o.geometry.coordinates[0], sa, sc, angle, sa / 2, stagger, 500) : []), [o.geometry, ix, sp, sa, sc, angle, stagger])
  if (!ix || o.geometry.type !== 'Polygon') return null
  const plant = () => {
    const pl = placementFor(ix, sid)
    if (!pl || !sp) return
    const variety = prompt('Variety for these trees? (optional, you can edit each tree later)') ?? ''
    const trees = pts.map((p, i) => createObject(layers, 'tree', { type: 'Point', coordinates: p }, undefined, { ...pl.extra, name: `${sp.name} ${i + 1}`, variety }))
    addObjects(trees, false)
    notify(`Planted ${trees.length} ${sp.name.toLowerCase()} trees. Use Undo to remove them all at once.`)
  }
  return (
    <>
      <h4>Plant a grid of trees</h4>
      <p className="note">Fills this orchard area with evenly spaced trees at the spacing you choose (default: the species' usual spacing).</p>
      <label>Species<SpeciesSelect place="tree" value={sid} onChange={(v) => { setSid(v); setAlong(0); setAcross(0) }} /></label>
      <div className="three">
        <label>Along row (m)<input type="number" min={0.5} step={0.5} placeholder={String(sa)} value={along || ''} onChange={(e) => setAlong(Number(e.target.value))} /></label>
        <label>Between rows (m)<input type="number" min={0.5} step={0.5} placeholder={String(sc)} value={across || ''} onChange={(e) => setAcross(Number(e.target.value))} /></label>
        <label>Row angle (°)<input type="number" step={5} value={angle} onChange={(e) => setAngle(Number(e.target.value))} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={stagger} onChange={(e) => setStagger(e.target.checked)} /> Staggered rows</label>
      <button className="primary wide" disabled={!pts.length || !sp} onClick={plant}>Plant {pts.length} {sp?.name.toLowerCase() ?? ''} tree{pts.length === 1 ? '' : 's'}</button>
      {sp && sp.canopy && sa < sp.canopy * 0.6 && <div className="notice">At {sa} m the mature crowns ({sp.canopy} m) will overlap heavily; trees will compete for light.</div>}
    </>
  )
}

// ------------------------------------------------------------------ greenhouse
export function insideObjects(host: EdenObject, objects: Record<string, EdenObject>, test: (o: EdenObject) => boolean): EdenObject[] {
  if (host.geometry.type !== 'Polygon') return []
  const ring = host.geometry.coordinates[0]
  return Object.values(objects).filter((x) => x.id !== host.id && test(x) && pointInRing(centroid(x.geometry), ring))
}

function GreenhouseSection({ o }: { o: EdenObject }) {
  const objects = useEditor((s) => s.doc.objects)
  const items = useMemo(() => insideObjects(o, objects, (x) => x.kind.startsWith('gh_') || x.kind === 'sensor' || x.kind === 'outlet'), [o, objects])
  if (o.geometry.type !== 'Polygon') return null
  const box = orientedBox(o.geometry.coordinates[0])
  const counts = new Map<string, number>()
  for (const i of items) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1)
  const bedArea = items.filter((i) => i.kind === 'gh_bed').reduce((s, i) => s + measureGeom(i.geometry).area, 0)
  return (
    <>
      <h4>Layout</h4>
      <dl className="kv">
        <dt>Size</dt><dd>{box.length.toFixed(1)} × {box.width.toFixed(1)} m</dd>
        <dt>Floor area</dt><dd>{fmtArea(measureGeom(o.geometry).area)}</dd>
        <dt>Long axis</dt><dd>{Math.round(box.bearing)}° ({compass(box.bearing)}–{compass(box.bearing + 180)})</dd>
        <dt>Growing beds</dt><dd>{bedArea ? fmtArea(bedArea) : '—'}</dd>
      </dl>
      <p className="note">Draw interior items from the <strong>Greenhouse</strong> group in the Draw tab inside this footprint: beds, shelving, doors, vents, heater, fan, lights, irrigation, tank, plus sensors and smart outlets.</p>
      {[...counts.entries()].map(([k, n]) => <div key={k} className="kvrow2"><span>{kindDef(k).label}</span><b>{n}</b></div>)}
      <div className="notice">Monitoring: <strong>no sensors connected</strong>. Set target ranges above; live readings and alerts arrive with the smart-home integration.</div>
    </>
  )
}

// ------------------------------------------------------------------ pond
function MiniChart({ data, label, unit }: { data: { date: string; v: number }[]; label: string; unit: string }) {
  if (data.length < 2) return <p className="note">Add at least two readings to see the {label.toLowerCase()} trend.</p>
  const w = 260, h = 70
  const min = Math.min(...data.map((d) => d.v)), max = Math.max(...data.map((d) => d.v))
  const span = max - min || 1
  const pts = data.map((d, i) => `${(i / (data.length - 1)) * (w - 10) + 5},${h - 8 - ((d.v - min) / span) * (h - 16)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart" role="img" aria-label={`${label} over time`}>
      <polyline points={pts} fill="none" stroke="#5cd6e6" strokeWidth="2" />
      {data.map((d, i) => <circle key={i} cx={(i / (data.length - 1)) * (w - 10) + 5} cy={h - 8 - ((d.v - min) / span) * (h - 16)} r="2.5" fill="#5cd6e6"><title>{`${d.date}: ${d.v} ${unit}`}</title></circle>)}
      <text x="4" y="10" fontSize="9" fill="#8b9ba3">{max} {unit}</text><text x="4" y={h - 1} fontSize="9" fill="#8b9ba3">{min}</text>
    </svg>
  )
}

export function PondSection({ o }: { o: EdenObject }) {
  const lib = useLibrary((s) => s.lib)
  const ix = useLibrary((s) => s.ix)
  const objects = useEditor((s) => s.doc.objects)
  const patch = useEditor((s) => s.patchObject)
  const zones = useMemo(() => Object.values(objects).filter((x) => x.kind === 'pond_zone'), [objects])
  const plantsIn = useMemo(() => insideObjects(o, objects, (x) => x.kind === 'plant' && x.props.aquatic === true), [o, objects])
  const fish: StockedFish[] = Array.isArray(o.props.fish) ? (o.props.fish as StockedFish[]) : []
  const log: WaterReading[] = Array.isArray(o.props.waterLog) ? (o.props.waterLog as WaterReading[]) : []
  const [metric, setMetric] = useState<keyof WaterReading>('ph')
  const [draft, setDraft] = useState<Partial<Record<keyof WaterReading, string>>>({ date: new Date().toISOString().slice(0, 10) })
  const [fishAdd, setFishAdd] = useState('')
  if (!lib || !ix || o.geometry.type !== 'Polygon') return null
  const vol = pondVolume(o, zones)
  const set = (k: string, v: unknown) => patch(o.id, { props: { [k]: v } }, `${k}:${o.id}`)
  const issuesLast = log.length ? waterIssues([...log].sort((a, b) => a.date.localeCompare(b.date))[log.length - 1], lib.waterQuality.ranges) : []
  const addReading = () => {
    const r: WaterReading = { date: draft.date || new Date().toISOString().slice(0, 10) }
    for (const k of ['tempC', 'ph', 'oxygen', 'ammonia', 'nitrite', 'nitrate'] as const) if (draft[k] !== undefined && draft[k] !== '') r[k] = Number(draft[k])
    if (draft.note) r.note = draft.note
    set('waterLog', [...log, r])
    setDraft({ date: draft.date })
  }
  const series = [...log].sort((a, b) => a.date.localeCompare(b.date)).filter((r) => typeof r[metric] === 'number').map((r) => ({ date: r.date, v: r[metric] as number }))
  const fields: [keyof WaterReading, string, string][] = [['tempC', 'Temp °C', '0.1'], ['ph', 'pH', '0.1'], ['oxygen', 'O₂ mg/L', '0.1'], ['ammonia', 'NH₃ mg/L', '0.01'], ['nitrite', 'NO₂ mg/L', '0.01'], ['nitrate', 'NO₃ mg/L', '1']]
  return (
    <>
      <h4>Pond overview</h4>
      <dl className="kv">
        <dt>Surface</dt><dd>{fmtArea(vol.surface)}</dd>
        <dt>Volume (estimate)</dt><dd>≈ {Math.round(vol.volume)} m³</dd>
        <dt>Depth zones</dt><dd>{zones.length ? `${zones.length} drawn` : 'none drawn'}</dd>
        <dt>Aquatic plants placed</dt><dd>{plantsIn.length}</dd>
      </dl>
      <p className="note">Volume = zone areas × their depths + the remaining surface at half the maximum depth. Planning estimate only; survey before sizing liner or pump.</p>

      <h4>Fish</h4>
      {fish.map((f, i) => {
        const sp = ix.fish.get(f.speciesId)
        const v = sp ? fishVerdict(sp, vol.surface, f.qty) : null
        return (
          <div key={i} className={`rel ${v?.level === 'bad' ? 'bad' : ''}`}>
            <span className="lvl" style={{ borderColor: v?.level === 'ok' ? LEVEL_COLOR.green : v?.level === 'caution' ? LEVEL_COLOR.yellow : LEVEL_COLOR.red, color: v?.level === 'ok' ? LEVEL_COLOR.green : v?.level === 'caution' ? LEVEL_COLOR.yellow : LEVEL_COLOR.red }}>{v?.level === 'ok' ? 'Suitable' : v?.level === 'caution' ? 'Caution' : 'Not suitable'}</span>
            <div>
              <strong>{sp?.name ?? f.speciesId}</strong> ×
              <input className="tiny" type="number" min={0} value={f.qty} onChange={(e) => set('fish', fish.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} />
              <input className="tiny wide" type="date" value={f.introduced ?? ''} onChange={(e) => set('fish', fish.map((x, j) => (j === i ? { ...x, introduced: e.target.value } : x)))} title="Introduction date" />
              <button className="icon" onClick={() => set('fish', fish.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
              {v?.messages.map((m, k) => <p key={k} className="note">{m}</p>)}
              {sp && <p className="note">Needs {sp.tempC[0]}–{sp.tempC[1]} °C water, dissolved oxygen above ~5 mg/L, near-zero ammonia and nitrite. {sp.diet}.</p>}
            </div>
          </div>
        )
      })}
      <div className="inline">
        <select value={fishAdd} onChange={(e) => { if (e.target.value) { set('fish', [...fish, { speciesId: e.target.value, qty: 1, introduced: new Date().toISOString().slice(0, 10) }]); setFishAdd('') } }}>
          <option value="">Add fish species…</option>
          {lib.fish.map((f) => <option key={f.id} value={f.id}>{f.name} — {{ suitable: 'suitable', conditional: 'conditional', not_recommended: 'not recommended', unsuitable: 'unsuitable' }[f.nsp]}</option>)}
        </select>
      </div>
      <p className="note">Many natural-pond designers recommend no fish, or very few in the regeneration zone only. Check local rules on stocking and non-native species.</p>
      {plantsIn.some((p) => ix.aquatic.get(String(p.props.speciesId))?.avoid) && <div className="notice err">A plant in this pond is flagged as invasive. Remove it.</div>}

      <h4>Water quality log (manual entries)</h4>
      {issuesLast.map((s, i) => <div key={i} className="notice warnbox">⚠ Latest reading: {s.message}</div>)}
      <div className="three">
        <label>Date<input type="date" value={draft.date ?? ''} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></label>
        {fields.map(([k, label, step]) => <label key={k}>{label}<input type="number" step={step} value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} /></label>)}
      </div>
      <button disabled={fields.every(([k]) => !draft[k])} onClick={addReading}>Add reading</button>
      {log.length > 0 && (
        <>
          <label>Chart<select value={metric} onChange={(e) => setMetric(e.target.value as keyof WaterReading)}>{fields.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <MiniChart data={series} label={fields.find((f) => f[0] === metric)![1]} unit="" />
          {[...log].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6).map((r, i) => (
            <div key={i} className="logrow"><small>{r.date}</small><span>{fields.filter(([k]) => typeof r[k] === 'number').map(([k, l]) => `${l.split(' ')[0]} ${r[k]}`).join(' · ')}</span><button className="icon" onClick={() => set('waterLog', log.filter((x) => x !== r))}><Trash2 size={12} /></button></div>
          ))}
        </>
      )}
      <p className="note">{lib.waterQuality.note} Values are what you enter; EDEN has no sensor connected.</p>
    </>
  )
}

