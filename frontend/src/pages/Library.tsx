import { useMemo, useState } from 'react'
import { MapPin } from 'lucide-react'
import { companionsOf, monthRange } from '../library/logic'
import { placementFor, startPlacing } from '../library/place'
import { useLibrary } from '../library/store'
import type { AquaticPlant, Fish, Mushroom, Plant } from '../library/types'
import { LEGEND, LevelChip } from '../panels/DesignSections'

type Tab = 'plants' | 'mushrooms' | 'aquatic' | 'fish'

const CAT_LABEL: Record<string, string> = {
  vegetable: 'Vegetables', herb: 'Herbs', flower: 'Flowers', fruit_tree: 'Fruit trees', nut_tree: 'Nut trees', ornamental_tree: 'Ornamental trees', forest_tree: 'Forest trees',
  forest_plant: 'Forest plants', shrub: 'Bushes and shrubs', fruit_shrub: 'Fruit bushes', climber: 'Climbing plants', wild_edible: 'Edible wild plants', medicinal: 'Medicinal (traditional use)',
  native: 'Native to Romania', toxic: 'Toxic plants',
}
const STATUS_LABEL: Record<string, string> = { edible: 'Edible', edible_cooked: 'Edible only if cooked', inedible: 'Inedible', poisonous: 'POISONOUS', deadly: 'DEADLY' }
const NSP_LABEL: Record<string, string> = { suitable: 'Suitable', conditional: 'Conditional', not_recommended: 'Not recommended', unsuitable: 'Unsuitable' }

export function LibraryPage() {
  const { lib, ix, error } = useLibrary()
  const [tab, setTab] = useState<Tab>('plants')
  if (error) return <div className="page"><div className="notice err">{error}</div></div>
  if (!lib || !ix) return <div className="page"><p>Loading the library…</p></div>
  return (
    <div className="page">
      <div className="pagehead">
        <div><h1>Plants &amp; Mushrooms Library</h1><p>{lib.plants.length} plants and trees, {lib.aquatic.length} aquatic plants, {lib.fish.length} pond fish, {lib.mushrooms.length} mushrooms, {lib.companions.length} companion relationships. Romania-focused.</p></div>
        <span className="badge">Starter data set</span>
      </div>
      <div className="notice">{lib.disclaimers.data}</div>
      <div className="seg" style={{ marginBottom: 14 }}>
        {([['plants', 'Plants & trees'], ['mushrooms', 'Mushrooms'], ['aquatic', 'Aquatic plants'], ['fish', 'Pond fish']] as [Tab, string][]).map(([t, l]) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{l}</button>)}
      </div>
      {tab === 'plants' && <PlantsTab />}
      {tab === 'mushrooms' && <MushroomsTab />}
      {tab === 'aquatic' && <AquaticTab />}
      {tab === 'fish' && <FishTab />}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- plants
function PlantsTab() {
  const { lib, ix } = useLibrary()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [native, setNative] = useState('')
  const [sun, setSun] = useState('')
  const [water, setWater] = useState('')
  const [edible, setEdible] = useState('')
  const [zone, setZone] = useState('')
  const [flower, setFlower] = useState('')
  const [harvest, setHarvest] = useState('')
  const [maxH, setMaxH] = useState('')
  const [companionOf, setCompanionOf] = useState('')
  const [wildlife, setWildlife] = useState(false)
  const [sel, setSel] = useState('tomato')
  const inRange = (r: [number, number] | null, m: number) => !!r && (r[0] <= r[1] ? m >= r[0] && m <= r[1] : m >= r[0] || m <= r[1])
  const related = useMemo(() => (companionOf && ix ? new Set(companionsOf(ix, companionOf).map((c) => c.other)) : null), [companionOf, ix])
  const list = useMemo(() => {
    if (!lib) return []
    const t = q.trim().toLowerCase()
    return lib.plants.filter((p) =>
      (!t || `${p.name} ${p.sci} ${p.ro ?? ''} ${p.family}`.toLowerCase().includes(t)) &&
      (!cat || p.cats.includes(cat)) && (!native || p.native === native) && (!sun || p.sun.includes(sun)) && (!water || p.water === water) &&
      (!edible || (edible === 'edible' ? p.edible === 'yes' || p.edible === 'parts' : p.edible === edible)) &&
      (!zone || p.zone === null || p.zone <= Number(zone)) && (!flower || inRange(p.flower, Number(flower))) && (!harvest || inRange(p.harvest, Number(harvest))) &&
      (!maxH || p.height <= Number(maxH)) && (!wildlife || !!p.wildlife) && (!related || related.has(p.id)),
    ).sort((a, b) => a.name.localeCompare(b.name))
  }, [lib, q, cat, native, sun, water, edible, zone, flower, harvest, maxH, wildlife, related])
  if (!lib || !ix) return null
  const cats = Object.keys(CAT_LABEL)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const monthSel = (v: string, set: (s: string) => void, label: string) => (
    <label>{label}<select value={v} onChange={(e) => set(e.target.value)}><option value="">Any</option>{months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
  )
  const plant = ix.plants.get(sel)
  return (
    <>
      <div className="filters">
        <label>Search<input placeholder="Common, Latin or Romanian name" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label>Category<select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All</option>{cats.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}</select></label>
        <label>Native status<select value={native} onChange={(e) => setNative(e.target.value)}><option value="">Any</option><option value="native">Native to Romania</option><option value="naturalised">Naturalised</option><option value="introduced">Introduced</option></select></label>
        <label>Sun<select value={sun} onChange={(e) => setSun(e.target.value)}><option value="">Any</option><option value="full">Full sun</option><option value="part">Part shade</option><option value="shade">Shade</option></select></label>
        <label>Water<select value={water} onChange={(e) => setWater(e.target.value)}><option value="">Any</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        <label>Edible<select value={edible} onChange={(e) => setEdible(e.target.value)}><option value="">Any</option><option value="edible">Edible (some parts)</option><option value="toxic">Toxic</option></select></label>
        <label>Winter hardiness<select value={zone} onChange={(e) => setZone(e.target.value)}><option value="">Any</option><option value="5">Hardy in zone 5 (cold areas, mountains)</option><option value="6">Hardy in zone 6 (most of Romania)</option><option value="7">Hardy in zone 7 (south, sheltered)</option></select></label>
        {monthSel(flower, setFlower, 'Flowering in')}
        {monthSel(harvest, setHarvest, 'Harvest in')}
        <label>Max. mature height<select value={maxH} onChange={(e) => setMaxH(e.target.value)}><option value="">Any</option><option value="1">1 m</option><option value="3">3 m</option><option value="6">6 m</option><option value="12">12 m</option></select></label>
        <label>Companion of<select value={companionOf} onChange={(e) => setCompanionOf(e.target.value)}><option value="">—</option>{lib.plants.filter((p) => ix.byPlant.has(p.id)).sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="check" style={{ minWidth: 150 }}><input type="checkbox" checked={wildlife} onChange={(e) => setWildlife(e.target.checked)} /> Wildlife value</label>
      </div>
      <p className="muted">{list.length} of {lib.plants.length} shown</p>
      <div className="libgrid">
        <div className="glass tablewrap liblist">
          {list.map((p) => (
            <button key={p.id} className={`item ${sel === p.id ? 'on' : ''}`} onClick={() => setSel(p.id)}>
              <span>{p.name}<small>{p.sci}</small></span>
              <span>{p.cats.includes('toxic') ? <span className="pill toxic">toxic</span> : p.tox ? <span className="pill cooked">caution</span> : null}{p.native === 'native' && <span className="pill native">native</span>}</span>
            </button>
          ))}
          {!list.length && <p className="empty">Nothing matches these filters.</p>}
        </div>
        {plant && <PlantDetail p={plant} onSelect={setSel} />}
      </div>
    </>
  )
}

function PlantDetail({ p, onSelect }: { p: Plant; onSelect: (id: string) => void }) {
  const { lib, ix } = useLibrary()
  if (!lib || !ix) return null
  const comps = companionsOf(ix, p.id)
  const add = () => {
    if (p.cats.includes('toxic') && !confirm(`${p.name} is poisonous.\n\n${p.tox}\n\nPlace it on the map anyway?`)) return
    startPlacing(ix, p.id)
  }
  return (
    <div className="detail glass">
      <h2>{p.name}</h2>
      <div className="sci">{p.sci} · {p.family}{p.ro ? ` · ro: ${p.ro}` : ''}</div>
      <div>{p.cats.map((c) => <span key={c} className={`pill ${c === 'native' ? 'native' : c === 'toxic' ? 'toxic' : ''}`}>{CAT_LABEL[c] ?? c}</span>)}<span className="pill">{{ native: 'Native', naturalised: 'Naturalised', introduced: 'Introduced' }[p.native]}</span></div>
      {p.tox && <div className="dangerbox" style={p.cats.includes('toxic') ? undefined : { borderColor: 'rgba(244,193,93,.6)', background: 'rgba(244,193,93,.08)' }}>⚠ {p.tox}</div>}
      <button className="primary wide" disabled={!placementFor(ix, p.id)} onClick={add}><MapPin size={15} /> ADD TO PROPERTY</button>
      <dl className="kv">
        <dt>Sun</dt><dd>{p.sun.replace('-', ' to ')}{p.shadeTol ? ' (shade tolerant)' : ''}</dd>
        <dt>Water</dt><dd>{p.water}</dd>
        <dt>Soil</dt><dd>{p.soil || '—'}</dd>
        <dt>Mature size</dt><dd>{p.height} m high{p.canopy ? `, ${p.canopy} m canopy` : ''}</dd>
        <dt>Spacing</dt><dd>{p.spacing >= 100 ? `${p.spacing / 100} m` : `${p.spacing} cm`}</dd>
        <dt>Roots</dt><dd>{p.root}</dd>
        <dt>Hardiness</dt><dd>{p.zone ? `zone ${p.zone}+` : 'annual / frost-tender'}</dd>
        <dt>Sow / plant</dt><dd>{monthRange(p.sow)}</dd>
        <dt>Flowering</dt><dd>{monthRange(p.flower)}</dd>
        <dt>Harvest</dt><dd>{monthRange(p.harvest)}</dd>
        <dt>Propagation</dt><dd>{p.prop || '—'}</dd>
        <dt>Edible</dt><dd>{{ yes: 'Yes (see notes)', parts: 'Some parts only', no: 'No', toxic: 'No - toxic' }[p.edible]}</dd>
      </dl>
      {p.wildlife && <p><strong>Wildlife:</strong> {p.wildlife}</p>}
      {p.pollination && <p><strong>Pollination:</strong> {p.pollination.selfFertile === 'yes' ? 'self-fertile. ' : p.pollination.selfFertile === 'no' ? 'needs a partner. ' : `${p.pollination.selfFertile}. `}{p.pollination.note}</p>}
      {p.notes && <p>{p.notes}</p>}
      {p.med && <div className="infobox"><strong>Traditional use only</strong><p>{p.med}</p><small className="muted">{lib.disclaimers.medicinal}</small></div>}
      <h4>Companion planting</h4>
      {comps.length === 0 ? <p className="empty">No relationships recorded. That does not mean it has no companions or conflicts.</p> : (
        <>
          {LEGEND}
          {comps.map((c) => (
            <div key={c.other} className="rel">
              <LevelChip level={c.level} evidence={c.rel.evidence} />
              <div><button className="link" onClick={() => onSelect(c.other)}><strong>{ix.plants.get(c.other)?.name}</strong></button><p className="note">{c.rel.note}</p></div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- mushrooms
function MushroomsTab() {
  const { lib } = useLibrary()
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState('chanterelle')
  const [cult, setCult] = useState(false)
  if (!lib) return null
  const list = lib.mushrooms.filter((m) => (!status || m.status === status) && (!cult || m.cultivation !== 'none') && (!q || `${m.name} ${m.sci} ${m.ro ?? ''}`.toLowerCase().includes(q.toLowerCase())))
  const m = lib.mushrooms.find((x) => x.id === sel)
  return (
    <>
      <div className="dangerbox"><strong>Safety first.</strong> {lib.disclaimers.mushrooms}</div>
      <div className="filters">
        <label>Search<input value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label>Edibility<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="check" style={{ minWidth: 200 }}><input type="checkbox" checked={cult} onChange={(e) => setCult(e.target.checked)} /> Cultivable at home</label>
      </div>
      <div className="libgrid">
        <div className="glass tablewrap liblist">
          {list.map((x) => (
            <button key={x.id} className={`item ${sel === x.id ? 'on' : ''}`} onClick={() => setSel(x.id)}>
              <span>{x.name}<small>{x.sci}</small></span><MushroomPill m={x} />
            </button>
          ))}
        </div>
        {m && <MushroomDetail m={m} />}
      </div>
    </>
  )
}

function MushroomPill({ m }: { m: Mushroom }) {
  return <span className={`pill ${m.status === 'edible_cooked' ? 'cooked' : m.status === 'edible' ? '' : m.status}`}>{STATUS_LABEL[m.status]}</span>
}

function MushroomDetail({ m }: { m: Mushroom }) {
  const bad = m.status === 'poisonous' || m.status === 'deadly'
  return (
    <div className="detail glass">
      <h2>{m.name}</h2>
      <div className="sci">{m.sci}{m.ro ? ` · ro: ${m.ro}` : ''}</div>
      <MushroomPill m={m} />
      <div className="dangerbox" style={bad ? undefined : { borderColor: 'rgba(244,193,93,.6)', background: 'rgba(244,193,93,.08)' }}>{bad ? '☠ ' : '⚠ '}{m.warning}</div>
      <dl className="kv">
        <dt>Season</dt><dd>{monthRange(m.season)}</dd>
        <dt>Habitat</dt><dd>{m.habitat}</dd>
        <dt>Substrate</dt><dd>{m.substrate}</dd>
        <dt>Cultivation</dt><dd>{{ none: 'not cultivated', easy: 'easy', moderate: 'moderate', difficult: 'difficult' }[m.cultivation]}</dd>
      </dl>
      <p><strong>Look-alikes:</strong> {m.lookalikes}</p>
      {m.cultivationNote && <p><strong>Growing:</strong> {m.cultivationNote}</p>}
      <p className="note">No photograph is shown on purpose: a picture must never be used to decide a mushroom is safe.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- aquatic
function AquaticTab() {
  const { lib, ix } = useLibrary()
  const [zone, setZone] = useState('')
  const [sel, setSel] = useState('hornwort')
  if (!lib || !ix) return null
  const list = lib.aquatic.filter((a) => !zone || a.zone === zone)
  const a = lib.aquatic.find((x) => x.id === sel)
  return (
    <>
      <div className="filters"><label>Planting zone<select value={zone} onChange={(e) => setZone(e.target.value)}><option value="">All</option>{['oxygenating', 'floating', 'marginal', 'shallow', 'deep'].map((z) => <option key={z} value={z}>{z}</option>)}</select></label></div>
      <div className="libgrid">
        <div className="glass tablewrap liblist">
          {list.map((x) => (
            <button key={x.id} className={`item ${sel === x.id ? 'on' : ''}`} onClick={() => setSel(x.id)}>
              <span>{x.name}<small>{x.sci}</small></span><span>{x.avoid ? <span className="pill toxic">avoid</span> : <span className="pill">{x.zone}</span>}</span>
            </button>
          ))}
        </div>
        {a && <AquaticDetail a={a} />}
      </div>
    </>
  )
}

function AquaticDetail({ a }: { a: AquaticPlant }) {
  const ix = useLibrary((s) => s.ix)!
  return (
    <div className="detail glass">
      <h2>{a.name}</h2>
      <div className="sci">{a.sci}</div>
      <span className="pill">{a.zone}</span><span className="pill">{a.native}</span><span className="pill">vigour: {a.vigour}</span>
      {a.avoid && <div className="dangerbox">⛔ {a.avoid}</div>}
      {a.tox && <div className="dangerbox">⚠ {a.tox}</div>}
      <button className="primary wide" disabled={!!a.avoid} onClick={() => startPlacing(ix, a.id)}><MapPin size={15} /> ADD TO PROPERTY</button>
      <dl className="kv"><dt>Water over crown</dt><dd>{a.depthCm[0]}–{a.depthCm[1]} cm</dd><dt>Sun</dt><dd>{a.sun}</dd><dt>Flowers</dt><dd>{monthRange(a.flower)}</dd></dl>
      <p>{a.notes}</p>
      {a.wildlife && <p><strong>Wildlife:</strong> {a.wildlife}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- fish
function FishTab() {
  const { lib } = useLibrary()
  const [sel, setSel] = useState('stickleback')
  if (!lib) return null
  const f = lib.fish.find((x) => x.id === sel)
  return (
    <>
      <div className="notice">Many natural-pond designers recommend no fish, or very few in the regeneration zone only. Suitability below is general guidance for a <strong>natural swimming pond</strong>; check local rules on stocking and non-native species.</div>
      <div className="libgrid">
        <div className="glass tablewrap liblist">
          {lib.fish.map((x) => (
            <button key={x.id} className={`item ${sel === x.id ? 'on' : ''}`} onClick={() => setSel(x.id)}>
              <span>{x.name}<small>{x.sci}</small></span><span className={`pill ${x.nsp === 'suitable' ? 'native' : x.nsp === 'conditional' ? 'cooked' : 'toxic'}`}>{NSP_LABEL[x.nsp]}</span>
            </button>
          ))}
        </div>
        {f && <FishDetail f={f} />}
      </div>
    </>
  )
}

function FishDetail({ f }: { f: Fish }) {
  return (
    <div className="detail glass">
      <h2>{f.name}</h2>
      <div className="sci">{f.sci}</div>
      <span className={`pill ${f.nsp === 'suitable' ? 'native' : f.nsp === 'conditional' ? 'cooked' : 'toxic'}`}>{NSP_LABEL[f.nsp]} for natural swimming ponds</span><span className="pill">{f.native}</span>
      {f.warning && <div className="dangerbox">⚠ {f.warning}</div>}
      <dl className="kv"><dt>Adult length</dt><dd>up to ~{f.lengthCm} cm</dd><dt>Temperature</dt><dd>{f.tempC[0]}–{f.tempC[1]} °C</dd><dt>Diet</dt><dd>{f.diet}</dd></dl>
      <p>{f.notes}</p>
      <p className="note">General water-quality needs: dissolved oxygen above ~5 mg/L, ammonia and nitrite near zero. Record fish in the pond's panel in the Property Editor to get automatic suitability warnings.</p>
    </div>
  )
}
