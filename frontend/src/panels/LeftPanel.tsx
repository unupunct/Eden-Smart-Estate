import { useState } from 'react'
import { ArrowDown, ArrowUp, Eye, EyeOff, ImagePlus, Lock, MousePointer2, Plus, Ruler, Square, Trash2, Unlock } from 'lucide-react'
import { api } from '../api/client'
import { KIND_GROUPS, KINDS } from '../model/kinds'
import { sortedLayers } from '../model/ops'
import { useApp } from '../model/app'
import { useEditor } from '../model/store'
import type { Layer } from '../model/types'

type Tab = 'draw' | 'layers' | 'images'

export function LeftPanel() {
  const [tab, setTab] = useState<Tab>('draw')
  return (
    <aside className="leftpanel glass" aria-label="Tools, layers and images">
      <div className="tabs">
        {(['draw', 'layers', 'images'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'draw' ? 'Draw' : t === 'layers' ? 'Layers' : 'Images'}
          </button>
        ))}
      </div>
      <div className="scroll">{tab === 'draw' ? <DrawTab /> : tab === 'layers' ? <LayersTab /> : <ImagesTab />}</div>
    </aside>
  )
}

function DrawTab() {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const glyph = (g: string) => (g === 'Polygon' ? '⬠' : g === 'LineString' ? '⁓' : '●')
  return (
    <>
      <div className="toolrow">
        <button className={tool.type === 'select' ? 'tool on' : 'tool'} onClick={() => setTool({ type: 'select' })} title="Select and edit (Esc)">
          <MousePointer2 size={16} /> Select
        </button>
        <button className={tool.type === 'measure' && tool.mode === 'distance' ? 'tool on' : 'tool'} onClick={() => setTool({ type: 'measure', mode: 'distance' })}>
          <Ruler size={16} /> Distance
        </button>
        <button className={tool.type === 'measure' && tool.mode === 'area' ? 'tool on' : 'tool'} onClick={() => setTool({ type: 'measure', mode: 'area' })}>
          <Square size={16} /> Area
        </button>
      </div>
      {KIND_GROUPS.map((g) => (
        <section key={g}>
          <h4>{g}</h4>
          <div className="palette">
            {KINDS.filter((k) => k.group === g && !k.noTool).map((k) => {
              const on = tool.type === 'draw' && tool.kind === k.kind
              return (
                <button key={k.kind} className={on ? 'pal on' : 'pal'} onClick={() => setTool({ type: 'draw', kind: k.kind, presetId: k.presets?.[0].id })}>
                  <span className="swatch" style={{ background: k.color }} />
                  <span className="lbl">{k.label}</span>
                  <span className="glyph">{k.icon ?? glyph(k.geom)}</span>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </>
  )
}

function LayersTab() {
  const layers = useEditor((s) => s.doc.layers)
  const objects = useEditor((s) => s.doc.objects)
  const addLayer = useEditor((s) => s.addLayer)
  const counts: Record<string, number> = {}
  for (const o of Object.values(objects)) counts[o.layerId] = (counts[o.layerId] ?? 0) + 1
  const sorted = sortedLayers(layers)
  const groups = [...new Set(sorted.map((l) => l.group))]
  return (
    <>
      <p className="note">Layers draw bottom to top; use the arrows to reorder. Locked layers cannot be selected or changed.</p>
      {groups.map((g) => (
        <section key={g}>
          <h4>{g || 'Other'}</h4>
          {sorted.filter((l) => l.group === g).map((l) => <LayerRow key={l.id} layer={l} count={counts[l.id] ?? 0} />)}
        </section>
      ))}
      <button className="ghost wide" onClick={() => { const n = prompt('Name for the new layer?'); if (n?.trim()) addLayer(n.trim(), 'Custom') }}>
        <Plus size={14} /> Add layer
      </button>
    </>
  )
}

function LayerRow({ layer, count }: { layer: Layer; count: number }) {
  const update = useEditor((s) => s.updateLayer)
  const move = useEditor((s) => s.moveLayer)
  const del = useEditor((s) => s.deleteLayer)
  const [editing, setEditing] = useState(false)
  return (
    <div className={`layerrow ${layer.visible ? '' : 'dim'}`}>
      <button className="icon" title={layer.visible ? 'Hide layer' : 'Show layer'} onClick={() => update(layer.id, { visible: !layer.visible })}>
        {layer.visible ? <Eye size={15} /> : <EyeOff size={15} />}
      </button>
      <button className="icon" title={layer.locked ? 'Unlock layer' : 'Lock layer'} onClick={() => update(layer.id, { locked: !layer.locked })}>
        {layer.locked ? <Lock size={15} /> : <Unlock size={15} />}
      </button>
      <input type="color" className="colorpick" value={layer.color} title="Layer colour (overrides the default for objects without their own colour)" onChange={(e) => update(layer.id, { color: e.target.value })} />
      {editing ? (
        <input autoFocus className="rename" defaultValue={layer.name} onBlur={(e) => { update(layer.id, { name: e.target.value.trim() || layer.name }); setEditing(false) }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      ) : (
        <span className="lname" onDoubleClick={() => setEditing(true)} title="Double-click to rename">{layer.name}</span>
      )}
      <span className="count">{count}</span>
      <button className="icon" onClick={() => move(layer.id, -1)} title="Move down the stack"><ArrowDown size={14} /></button>
      <button className="icon" onClick={() => move(layer.id, 1)} title="Move up the stack"><ArrowUp size={14} /></button>
      {layer.key.startsWith('custom_') && <button className="icon" onClick={() => del(layer.id)} title="Delete layer"><Trash2 size={14} /></button>}
    </div>
  )
}

function ImagesTab() {
  const overlays = useEditor((s) => s.overlays)
  const setOverlays = useEditor((s) => s.setOverlays)
  const setDialog = useApp((s) => s.setDialog)
  const notify = useEditor((s) => s.notify)
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (e) {
      notify((e as Error).message)
    }
  }
  return (
    <>
      <p className="note">Use your own aerial photo or plan when satellite imagery is unavailable or out of date. Calibrate it with two known points, a known distance, or a world file.</p>
      <button className="primary wide" onClick={() => setDialog('image-import')}><ImagePlus size={15} /> Import and calibrate image</button>
      {overlays.map((o) => (
        <div key={o.id} className="overlayrow">
          <div className="row">
            <button className="icon" onClick={() => act(async () => { const r = await api.patchOverlay(o.id, { visible: !o.visible }); setOverlays(useEditor.getState().overlays.map((x) => (x.id === o.id ? r : x))) })}>
              {o.visible ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
            <span className="lname">{o.name}</span>
            <button className="icon" title="Remove image" onClick={() => act(async () => { await api.deleteOverlay(o.id); setOverlays(useEditor.getState().overlays.filter((x) => x.id !== o.id)) })}>
              <Trash2 size={14} />
            </button>
          </div>
          <input type="range" min={0.1} max={1} step={0.05} value={o.opacity}
            onChange={(e) => setOverlays(useEditor.getState().overlays.map((x) => (x.id === o.id ? { ...x, opacity: Number(e.target.value) } : x)))}
            onPointerUp={(e) => act(async () => { await api.patchOverlay(o.id, { opacity: Number((e.target as HTMLInputElement).value) }) })} />
        </div>
      ))}
      {!overlays.length && <p className="empty">No images yet.</p>}
    </>
  )
}

