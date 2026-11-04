import { fmtArea, measureGeom } from '../geo/measure'
import { pointInRing } from '../library/logic'
import { useManage } from '../manage/store'
import { useApp } from '../model/app'
import { kindDef, num } from '../model/kinds'
import { useEditor } from '../model/store'
import type { EdenObject } from '../model/types'
import { useSmart } from '../smart/store'

const INSIDE = new Set(['outlet', 'light', 'sensor', 'camera'])
const SERVICES: [string, string][] = [['electricity', 'Electricity'], ['water', 'Water'], ['heating', 'Heating'], ['internet', 'Internet']]

export function BuildingsPage() {
  const doc = useEditor((s) => s.doc)
  const property = useEditor((s) => s.property)
  const focus = useEditor((s) => s.requestFocus)
  const go = useApp((s) => s.go)
  const { tasks, documents } = useManage()
  const devices = useSmart((s) => s.devices)
  const buildings = Object.values(doc.objects).filter((o) => (o.kind === 'building' || o.kind === 'greenhouse') && o.geometry.type === 'Polygon').sort((a, b) => a.name.localeCompare(b.name))
  const small = Object.values(doc.objects).filter((o) => INSIDE.has(o.kind) && o.geometry.type === 'Point')
  const inside = (b: EdenObject) => small.filter((s) => s.geometry.type === 'Point' && b.geometry.type === 'Polygon' && pointInRing(s.geometry.coordinates, b.geometry.coordinates[0]))
  const totalFloor = buildings.reduce((s, b) => s + measureGeom(b.geometry).area * Math.max(1, num(b.props.floors, 1)), 0)

  return (
    <div className="page">
      <div className="pagehead">
        <div><h1>Buildings</h1><p>Every building and greenhouse drawn in the Property Editor, with what is known about it: size, floors, services, the devices placed inside it, open tasks and attached documents. Edit a building by selecting it on the map.</p></div>
        <span className="badge">{buildings.length} building{buildings.length === 1 ? '' : 's'}</span>
      </div>
      {!property && <p className="empty">Open or create a property first.</p>}
      <div className="glass tablewrap">
        <table>
          <thead><tr><th>Building</th><th>Footprint</th><th>Floors · height</th><th>Floor area</th><th>Services</th><th>Inside</th><th>Tasks</th><th>Files</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {buildings.map((b) => {
              const area = measureGeom(b.geometry).area
              const floors = Math.max(1, num(b.props.floors, 1))
              const items = inside(b)
              const linked = items.filter((i) => devices.some((d) => d.objectId === i.id && d.state !== null)).length
              const openTasks = tasks.filter((t) => t.objectId === b.id && t.status === 'open').length
              const docs = documents.filter((d) => d.objectId === b.id).length
              const def = kindDef(b.kind)
              return (
                <tr key={b.id}>
                  <td><span className="swatch" style={{ background: def.color }} /> <b>{b.name || def.label}</b><br /><small className="muted">{String(b.props.buildingType ?? def.label).replace(/_/g, ' ')}{b.props.constructionYear ? ` · built ${b.props.constructionYear}` : ''}</small></td>
                  <td>{fmtArea(area)}</td>
                  <td>{b.kind === 'building' ? `${floors} · ${num(b.props.height, 0) || '—'} m` : `${num(b.props.height, 0) || '—'} m`}{b.props.roofType ? <><br /><small className="muted">{String(b.props.roofType)} roof</small></> : ''}</td>
                  <td>{b.kind === 'building' ? fmtArea(area * floors) : '—'}</td>
                  <td>{b.kind === 'building' ? SERVICES.filter(([k]) => b.props[k] === true).map(([k, l]) => <span key={k} className="pill">{l}</span>) : <small className="muted">—</small>}{b.kind === 'building' && !SERVICES.some(([k]) => b.props[k] === true) && <small className="muted">none recorded</small>}</td>
                  <td>{items.length ? <>{items.length} placed<br /><small className="muted">{linked ? `${linked} with live data` : 'none connected'}</small></> : <small className="muted">nothing placed</small>}</td>
                  <td>{openTasks ? <button className="linklike" onClick={() => go('tasks')}>{openTasks} open</button> : <small className="muted">none</small>}</td>
                  <td>{docs ? <button className="linklike" onClick={() => go('notes')}>{docs}</button> : <small className="muted">none</small>}</td>
                  <td><button onClick={() => { focus(b.id); go('editor') }}>Show on map</button></td>
                </tr>
              )
            })}
            {!buildings.length && <tr><td colSpan={9} className="empty">{property ? 'No buildings yet. Draw one in the Property Editor (Structures → Building).' : 'Open or create a property first.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {buildings.length > 0 && <p className="muted">Total floor area of buildings (footprint × floors): <b>{fmtArea(totalFloor)}</b>. A planning figure from the drawn outlines, not a surveyed measurement.</p>}
    </div>
  )
}
