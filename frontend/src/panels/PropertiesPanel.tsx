import { Copy, Crosshair, RotateCcw, RotateCw, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import { bearing, centroid, fmtArea, fmtAreaBoth, fmtLength, measureGeom } from '../geo/measure'
import { pivotOf, rotate, scale } from '../geo/transform'
import { mapRef } from '../map/controller'
import { KINDS, STATUS_OPTIONS, kindDef, num, type FieldDef } from '../model/kinds'
import { sortedLayers } from '../model/ops'
import { useEditor } from '../model/store'
import { useLibrary } from '../library/store'
import { useApp } from '../model/app'
import { stateText, useSmart } from '../smart/store'
import { placementFor } from '../library/place'
import { KindSections, SpeciesSelect } from './DesignSections'
import type { Doc } from '../model/types'

export function PropertiesPanel() {
  const selection = useEditor((s) => s.selection)
  const objects = useEditor((s) => s.doc.objects)
  const live = selection.filter((id) => objects[id])
  return (
    <aside className="rightpanel glass">
      <div className="scroll">
        {live.length === 0 ? <PropertySummary /> : live.length === 1 ? <ObjectPanel id={live[0]} /> : <MultiPanel ids={live} />}
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------------------------- property summary
export function estateStats(doc: Doc) {
  let boundaryArea = 0, boundaryPerimeter = 0, fenceLen = 0, roadLen = 0, pondArea = 0, bedArea = 0, buildingArea = 0
  const counts: Record<string, number> = {}
  for (const o of Object.values(doc.objects)) {
    counts[o.kind] = (counts[o.kind] ?? 0) + 1
    const m = measureGeom(o.geometry)
    if (o.kind === 'boundary') { boundaryArea += m.area; boundaryPerimeter += m.perimeter }
    else if (o.kind === 'fence' || o.kind === 'hedge') fenceLen += m.perimeter
    else if (o.kind === 'road' || o.kind === 'path') roadLen += m.perimeter
    else if (o.kind === 'pond') pondArea += m.area
    else if (o.kind === 'garden_bed') bedArea += m.area
    else if (o.kind === 'building' || o.kind === 'greenhouse') buildingArea += m.area
  }
  return { boundaryArea, boundaryPerimeter, fenceLen, roadLen, pondArea, bedArea, buildingArea, counts }
}

function PropertySummary() {
  const property = useEditor((s) => s.property)
  const doc = useEditor((s) => s.doc)
  const rename = useEditor((s) => s.renameProperty)
  if (!property) return null
  const st = estateStats(doc)
  return (
    <div className="form">
      <h3>Property</h3>
      <label>Name<input value={property.name} onChange={(e) => rename(e.target.value)} /></label>
      <label>Description<textarea rows={3} value={property.description} onChange={(e) => rename(property.name, e.target.value)} /></label>
      {property.isDemo && <div className="demo-note">DEMO DATA — fictional. Nothing here is a real property, device or sensor.</div>}
      <h4>Measurements</h4>
      <dl className="kv">
        <dt>Total property area</dt><dd>{st.boundaryArea ? fmtAreaBoth(st.boundaryArea) : <em>draw the boundary</em>}</dd>
        <dt>Boundary perimeter</dt><dd>{st.boundaryPerimeter ? fmtLength(st.boundaryPerimeter) : '—'}</dd>
        <dt>Buildings footprint</dt><dd>{fmtArea(st.buildingArea)}</dd>
        <dt>Garden beds</dt><dd>{fmtArea(st.bedArea)}</dd>
        <dt>Pond surface</dt><dd>{fmtArea(st.pondArea)}</dd>
        <dt>Fences &amp; hedges</dt><dd>{fmtLength(st.fenceLen)}</dd>
        <dt>Roads &amp; paths</dt><dd>{fmtLength(st.roadLen)}</dd>
      </dl>
      <h4>Objects</h4>
      <dl className="kv">
        {KINDS.filter((k) => st.counts[k.kind]).map((k) => (
          <div key={k.kind} className="kvrow"><dt><span className="swatch" style={{ background: k.color }} /> {k.label}</dt><dd>{st.counts[k.kind]}</dd></div>
        ))}
      </dl>
      {!Object.keys(st.counts).length && <p className="empty">Nothing drawn yet. Start with the <strong>Property boundary</strong> in the Draw tab.</p>}
      <p className="note">Click an object on the map to edit it. Shift-click selects several.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- multi selection
function MultiPanel({ ids }: { ids: string[] }) {
  const doc = useEditor((s) => s.doc)
  const del = useEditor((s) => s.deleteObjects)
  const dup = useEditor((s) => s.duplicateObjects)
  const moveTo = useEditor((s) => s.moveToLayer)
  const setSel = useEditor((s) => s.setSelection)
  return (
    <div className="form">
      <h3>{ids.length} objects selected</h3>
      <ul className="objlist">
        {ids.map((id) => (
          <li key={id}><button className="linklike" onClick={() => setSel([id])}><span className="swatch" style={{ background: kindDef(doc.objects[id].kind).color }} />{doc.objects[id].name || kindDef(doc.objects[id].kind).label}</button></li>
        ))}
      </ul>
      <label>Move all to layer
        <select value="" onChange={(e) => e.target.value && moveTo(ids, e.target.value)}>
          <option value="">Choose a layer…</option>
          {sortedLayers(doc.layers).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>
      <div className="btnrow">
        <button onClick={() => dup(ids)}><Copy size={14} /> Duplicate</button>
        <button className="danger" onClick={() => del(ids)}><Trash2 size={14} /> Delete</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- single object
/** Live status of the device linked to a map object, or an honest "not connected". */
function DeviceLink({ objectId }: { objectId: string }) {
  const devices = useSmart((s) => s.devices).filter((d) => d.objectId === objectId)
  const cams = useSmart((s) => s.cameras).filter((c) => c.objectId === objectId)
  const go = useApp((s) => s.go)
  if (!devices.length && !cams.length) {
    return <div className="notice">Position only. This is <strong>not connected</strong> to a device, so no status is shown. <button className="linklike" onClick={() => go('smart')}>Link a device</button></div>
  }
  return (
    <div className="notice ok" style={{ display: 'block' }}>
      {devices.map((d) => (
        <div key={d.id}><strong>{d.name}</strong>: {stateText(d)}{d.integrationStatus !== 'online' && d.domain !== 'mqtt' ? ' (integration offline, last known)' : ''}</div>
      ))}
      {cams.map((c) => <div key={c.id}><strong>{c.name}</strong>: camera feed configured <button className="linklike" onClick={() => go('security')}>View</button></div>)}
    </div>
  )
}

function ObjectPanel({ id }: { id: string }) {
  const o = useEditor((s) => s.doc.objects[id])
  const layers = useEditor((s) => s.doc.layers)
  const patch = useEditor((s) => s.patchObject)
  const del = useEditor((s) => s.deleteObjects)
  const dup = useEditor((s) => s.duplicateObjects)
  const setGeoms = useEditor((s) => s.setGeometries)
  const libIx = useLibrary((s) => s.ix)
  if (!o) return null
  const def = kindDef(o.kind)
  const layer = layers.find((l) => l.id === o.layerId)
  const locked = !!layer?.locked
  const m = measureGeom(o.geometry)
  const setProp = (key: string, value: unknown) => patch(id, { props: { [key]: value } }, `prop:${id}:${key}`)
  const sections = [...new Set(def.fields.map((f) => f.section ?? 'Details'))]
  const sectionsOrdered = ['Details', ...sections.filter((s) => s !== 'Details')].filter((s) => sections.includes(s))
  const pickSpecies = (sid: string) => {
    const sp = sid ? (libIx?.plants.get(sid) ?? libIx?.aquatic.get(sid)) : undefined
    const old = typeof o.props.speciesId === 'string' ? libIx?.plants.get(o.props.speciesId) : undefined
    const props: Record<string, unknown> = { speciesId: sid || undefined }
    if (sp && libIx) {
      const pl = placementFor(libIx, sid)
      props.species = sp.name
      if (pl) {
        if (o.kind === 'tree') props.category = pl.extra.category
        for (const k of ['canopy', 'height'] as const) if (o.props[k] === undefined && pl.extra[k] !== undefined) props[k] = pl.extra[k]
      }
    }
    const wasDefault = !o.name || o.name === def.label || o.name === old?.name || o.name === String(o.props.species ?? '')
    patch(id, { props, ...(wasDefault && sp ? { name: sp.name } : {}) })
  }
  const orientation = num(o.props.orientation, 0)
  const transform = (kind: 'rot' | 'scale', v: number) => {
    const pivot = pivotOf(o.geometry)
    if (kind === 'rot') {
      const props = { ...o.props, orientation: (((orientation + v) % 360) + 360) % 360 }
      const geometry = rotate(o.geometry, v, pivot)
      useEditor.getState().commit({ ...useEditor.getState().doc, objects: { ...useEditor.getState().doc.objects, [id]: { ...o, geometry, props } } })
    } else setGeoms({ [id]: scale(o.geometry, v, pivot) })
  }
  const c = centroid(o.geometry)
  return (
    <div className="form" aria-disabled={locked}>
      <div className="objhead"><span className="swatch big" style={{ background: def.color }} /><div><h3>{def.label}</h3><small>{layer?.name}{locked ? ' · locked' : ''}</small></div></div>
      {locked && <div className="demo-note">This layer is locked. Unlock it in the Layers tab to edit.</div>}
      <fieldset disabled={locked}>
        <label>Name<input value={o.name} onChange={(e) => patch(id, { name: e.target.value }, `name:${id}`)} /></label>
        <label>Layer
          <select value={o.layerId} onChange={(e) => patch(id, { layerId: e.target.value })}>
            {sortedLayers(layers).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        {sectionsOrdered.map((sec) => (
          <div key={sec}>
            {sectionsOrdered.length > 1 && <h4>{sec}</h4>}
            {def.fields.filter((f) => (f.section ?? 'Details') === sec).map((f) => f.type === 'species'
              ? <label key={f.key}>{f.label}<SpeciesSelect place={f.place} value={typeof o.props.speciesId === 'string' ? o.props.speciesId : ''} onChange={pickSpecies} /></label>
              : <FieldInput key={f.key} f={f} value={o.props[f.key]} onChange={(v) => setProp(f.key, v)} />)}
          </div>
        ))}
        <KindSections o={o} />
        {def.smart && <DeviceLink objectId={id} />}
        <label>Status
          <select value={String(o.props.status ?? '')} onChange={(e) => setProp('status', e.target.value || undefined)}>
            <option value="">—</option>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label>Description<textarea rows={2} value={String(o.props.description ?? '')} onChange={(e) => setProp('description', e.target.value)} /></label>
        <label>Notes<textarea rows={3} value={String(o.props.notes ?? '')} onChange={(e) => setProp('notes', e.target.value)} placeholder="Maintenance remarks, materials, history…" /></label>
      </fieldset>

      <h4>Measurements</h4>
      <dl className="kv">
        {o.geometry.type === 'Polygon' && <><dt>Area</dt><dd>{fmtAreaBoth(m.area)}</dd><dt>Perimeter</dt><dd>{fmtLength(m.perimeter)}</dd><dt>Corners</dt><dd>{m.vertices}</dd></>}
        {o.geometry.type === 'LineString' && <><dt>Length</dt><dd>{fmtLength(m.perimeter)}</dd><dt>Points</dt><dd>{m.vertices}</dd><dt>Bearing</dt><dd>{bearing(o.geometry.coordinates[0], o.geometry.coordinates[o.geometry.coordinates.length - 1]).toFixed(0)}° (start → end)</dd>
          {o.kind === 'fence' && <><dt>Sections</dt><dd>{Math.max(1, Math.ceil(m.perimeter / Math.max(0.5, num(o.props.sectionLength, 2.5))))} × {num(o.props.sectionLength, 2.5)} m</dd></>}</>}
        {o.geometry.type === 'Point' && def.radiusProp && <><dt>Canopy area</dt><dd>{fmtArea(Math.PI * (num(o.props[def.radiusProp], 0) / 2) ** 2)}</dd></>}
        <dt>Position</dt><dd className="mono">{c[1].toFixed(6)}, {c[0].toFixed(6)}</dd>
      </dl>

      {o.geometry.type !== 'Point' && !locked && (
        <>
          <h4>Transform</h4>
          <div className="btnrow">
            <button onClick={() => transform('rot', -15)} title="Rotate 15° anticlockwise"><RotateCcw size={14} /> 15°</button>
            <button onClick={() => transform('rot', 15)} title="Rotate 15° clockwise"><RotateCw size={14} /> 15°</button>
            <button onClick={() => transform('rot', 90)}>90°</button>
            <button onClick={() => transform('scale', 0.9)} title="Shrink 10%"><ZoomOut size={14} /></button>
            <button onClick={() => transform('scale', 1.1)} title="Grow 10%"><ZoomIn size={14} /></button>
          </div>
          <label>Orientation (°)
            <input type="number" step={1} value={Number(orientation.toFixed(1))} onChange={(e) => { const t = Number(e.target.value); if (Number.isFinite(t)) transform('rot', t - orientation) }} />
          </label>
          <p className="note">Drag the green handle above the shape to rotate freely (hold Shift for 15° steps). Drag corner dots to reshape, drag the faint dots to add corners, right-click a corner to remove it.</p>
        </>
      )}
      {o.geometry.type === 'Point' && <p className="note">Drag the marker to move it.</p>}

      <div className="btnrow">
        <button onClick={() => mapRef.current?.fitObjects([id])}><Crosshair size={14} /> Zoom to</button>
        <button onClick={() => dup([id])} disabled={locked}><Copy size={14} /> Duplicate</button>
        <button className="danger" onClick={() => del([id])} disabled={locked}><Trash2 size={14} /> Delete</button>
      </div>
    </div>
  )
}

function FieldInput({ f, value, onChange }: { f: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const label = f.unit ? `${f.label} (${f.unit})` : f.label
  if (f.type === 'boolean') return <label className="check"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {f.label}</label>
  if (f.type === 'select') {
    return (
      <label>{label}
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">—</option>
          {f.options?.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
        </select>
      </label>
    )
  }
  if (f.type === 'textarea') return <label>{label}<textarea rows={3} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} /></label>
  if (f.type === 'color') return <label>{label}<input type="color" value={typeof value === 'string' ? value : '#888888'} onChange={(e) => onChange(e.target.value)} /></label>
  if (f.type === 'number') {
    return (
      <label>{label}
        <input type="number" min={f.min} max={f.max} step={f.step ?? 'any'} value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
      </label>
    )
  }
  return <label>{label}<input type={f.type === 'date' ? 'date' : 'text'} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} /></label>
}

