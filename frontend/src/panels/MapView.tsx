import { useEffect, useRef } from 'react'
import { Magnet, X } from 'lucide-react'
import { EdenMap, mapRef } from '../map/controller'
import { useStatus } from '../map/support'
import { kindDef } from '../model/kinds'
import { useEditor } from '../model/store'
import type { PropertyMeta } from '../model/types'

export function MapView({ property }: { property: PropertyMeta }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const m = new EdenMap(host.current!, property)
    mapRef.current = m
    ;(window as unknown as { __edenMap?: unknown }).__edenMap = m.map // handle for the e2e tests
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(host.current!)
    return () => {
      ro.disconnect()
      mapRef.current = null
      m.destroy()
    }
    // the map is rebuilt per property; later view changes come from the map itself
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property.id])

  return (
    <div className="mapwrap">
      <div ref={host} className="map" />
      <ToolOptions />
      <Banner />
    </div>
  )
}

function ToolOptions() {
  const tool = useEditor((s) => s.tool)
  const shape = useEditor((s) => s.shape)
  const snap = useEditor((s) => s.snap)
  const setShape = useEditor((s) => s.setShape)
  const setSnap = useEditor((s) => s.setSnap)
  const setTool = useEditor((s) => s.setTool)
  const showMature = useEditor((s) => s.showMature)
  const setShowMature = useEditor((s) => s.setShowMature)
  const def = tool.type === 'draw' ? kindDef(tool.kind) : null
  return (
    <div className="tooloptions glass">
      {tool.type === 'draw' && def && (
        <>
          <span className="swatch" style={{ background: def.color }} />
          <strong>{def.label}</strong>
          {def.presets && !tool.extra && (
            <select value={tool.presetId ?? def.presets[0].id} onChange={(e) => setTool({ type: 'draw', kind: tool.kind, presetId: e.target.value })}>
              {def.presets.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          )}
          {def.geom === 'Polygon' && (
            <div className="seg">
              {(['polygon', 'rectangle', 'circle'] as const).map((sh) => (
                <button key={sh} className={shape === sh ? 'on' : ''} onClick={() => setShape(sh)}>{sh}</button>
              ))}
            </div>
          )}
        </>
      )}
      {tool.type === 'draw' && tool.extra && typeof tool.extra.species === 'string' && <small className="muted">species: {tool.extra.species}</small>}
      {tool.type === 'measure' && <strong>{tool.mode === 'area' ? 'Measure area' : 'Measure distance'}</strong>}
      <button className={`chip ${snap ? 'on' : ''}`} title="Snap to existing corners and edges (hold Alt to bypass)" onClick={() => setSnap(!snap)}>
        <Magnet size={14} /> Snap
      </button>
      <button className={`chip ${showMature ? 'on' : ''}`} title="Show every tree's projected canopy at maturity" onClick={() => setShowMature(!showMature)}>🌳 Mature canopy</button>
      {tool.type !== 'select' && (
        <button className="chip" onClick={() => setTool({ type: 'select' })}>
          <X size={14} /> Done
        </button>
      )}
    </div>
  )
}

function Banner() {
  const hint = useStatus((s) => s.hint)
  const flash = useEditor((s) => s.flash)
  const notify = useEditor((s) => s.notify)
  const cal = useEditor((s) => s.calibration)
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => notify(null), 3500)
    return () => clearTimeout(t)
  }, [flash, notify])
  const calMsg = cal && cal.phase === 'pick-map' ? `Image calibration: click on the map where picture point ${cal.geoPts.length + 1} is.` : ''
  return (
    <>
      {(hint || calMsg) && <div className="hintbar glass">{calMsg || hint}</div>}
      {flash && <div className="toast glass">{flash}</div>}
    </>
  )
}
