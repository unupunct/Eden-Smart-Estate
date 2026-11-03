import { KIND_MAP, kindDef } from '../model/kinds'
import { fmtArea, fmtLength, measureGeom } from '../geo/measure'
import { useApp, type Route } from '../model/app'
import { useEditor } from '../model/store'

interface ModuleInfo {
  title: string
  phase: string
  blurb: string
  planned: string[]
  kinds?: string[] // module lists the matching objects already on the map
}

export const MODULES: Partial<Record<Route, ModuleInfo>> = {
  buildings: { title: 'Buildings', phase: 'Phase 2 (list) · detail pages later', kinds: ['building'], blurb: 'Every building drawn in the Property Editor. Click “Show on map” to edit its footprint, height, roof and services.', planned: ['Building detail page with floors, doors, windows and equipment', 'Associated devices, cameras and maintenance records', 'Roof geometry in 3D beyond simple extrusion'] },
}

export function ModulePage({ route }: { route: Route }) {
  const info = MODULES[route]
  const doc = useEditor((s) => s.doc)
  const property = useEditor((s) => s.property)
  const focus = useEditor((s) => s.requestFocus)
  const go = useApp((s) => s.go)
  if (!info) return null
  const objs = info.kinds ? Object.values(doc.objects).filter((o) => info.kinds!.includes(o.kind)) : []
  return (
    <div className="page">
      <div className="pagehead">
        <div><h1>{info.title}</h1><p>{info.blurb}</p></div>
        <span className="badge">{info.phase}</span>
      </div>
      {info.kinds && (
        <div className="glass tablewrap">
          <table>
            <thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Key facts</th><th /></tr></thead>
            <tbody>
              {objs.map((o) => {
                const m = measureGeom(o.geometry)
                const def = kindDef(o.kind)
                const facts = def.fields.slice(0, 4).map((f) => (o.props[f.key] !== undefined && o.props[f.key] !== '' ? `${f.label}: ${String(o.props[f.key])}${f.unit ? ' ' + f.unit : ''}` : '')).filter(Boolean).join(' · ')
                return (
                  <tr key={o.id}>
                    <td><span className="swatch" style={{ background: def.color }} /> {o.name || def.label}</td>
                    <td>{KIND_MAP[o.kind]?.label ?? o.kind}</td>
                    <td>{o.geometry.type === 'Polygon' ? fmtArea(m.area) : o.geometry.type === 'LineString' ? fmtLength(m.perimeter) : '—'}</td>
                    <td className="muted">{facts || '—'}</td>
                    <td><button onClick={() => { focus(o.id); go('editor') }}>Show on map</button></td>
                  </tr>
                )
              })}
              {!objs.length && <tr><td colSpan={5} className="empty">{property ? 'Nothing of this kind on the property yet. Draw some in the Property Editor.' : 'Open or create a property first.'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <h2 className="sect">On the roadmap</h2>
      <ul className="roadmap glass">{info.planned.map((p) => <li key={p}>{p}</li>)}</ul>
    </div>
  )
}
