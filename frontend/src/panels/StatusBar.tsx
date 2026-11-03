import { fmtAreaBoth } from '../geo/measure'
import { kindDef } from '../model/kinds'
import { useEditor } from '../model/store'
import { useStatus } from '../map/support'
import { estateStats } from './PropertiesPanel'

export function StatusBar() {
  const cursor = useStatus((s) => s.cursor)
  const zoom = useStatus((s) => s.zoom)
  const doc = useEditor((s) => s.doc)
  const selection = useEditor((s) => s.selection)
  const baseMap = useEditor((s) => s.baseMap)
  const catalog = useEditor((s) => s.catalog)
  const view3d = useEditor((s) => s.view3d)
  const st = estateStats(doc)
  const first = selection.length ? doc.objects[selection[0]] : undefined
  const provider = catalog?.basemaps[baseMap]?.layers.map((id) => catalog.providers[id]?.name).filter(Boolean).join(' + ') || 'no imagery'
  return (
    <footer className="statusbar glass">
      <span className="mono">{cursor ? `${cursor[1].toFixed(6)}°, ${cursor[0].toFixed(6)}°` : '—'}</span>
      <span>Zoom {zoom.toFixed(1)}</span>
      <span>{selection.length > 1 ? `${selection.length} selected` : first ? `Selected: ${first.name || kindDef(first.kind).label}` : 'Nothing selected'}</span>
      <span>Property area: {st.boundaryArea ? fmtAreaBoth(st.boundaryArea) : 'no boundary yet'}</span>
      <span className="grow" />
      <span>{view3d ? '3D' : '2D'} · {catalog?.basemaps[baseMap]?.label ?? baseMap} · {provider}</span>
    </footer>
  )
}
