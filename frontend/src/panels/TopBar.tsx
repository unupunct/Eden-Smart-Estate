import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Box, Check, Download, Layers3, Loader2, Maximize, Plus, Redo2, Save, Search, TriangleAlert, Undo2, Upload } from 'lucide-react'
import { api, type GeocodeHit } from '../api/client'
import { flush } from '../model/autosave'
import { useApp } from '../model/app'
import { kindDef } from '../model/kinds'
import { mapRef } from '../map/controller'
import { useEditor } from '../model/store'

function Menu({ icon, label, children }: { icon: ReactNode; label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  return (
    <div className="menu" ref={ref}>
      <button className="tb" onClick={() => setOpen(!open)}>{icon}<span>{label}</span></button>
      {open && <div className="menupop glass">{children(() => setOpen(false))}</div>}
    </div>
  )
}

function SaveStatus() {
  const save = useEditor((s) => s.save)
  const label = { idle: 'Autosave on', dirty: 'Unsaved changes…', saving: 'Saving…', saved: 'All changes saved', error: 'Save failed — retrying' }[save.status]
  const icon = save.status === 'saving' ? <Loader2 size={14} className="spin" /> : save.status === 'error' ? <TriangleAlert size={14} /> : <Check size={14} />
  return <span className={`savepill ${save.status}`} title={save.error ?? 'Changes are written to the local database automatically'}>{icon} {label}</span>
}

export function TopBar() {
  const property = useEditor((s) => s.property)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const view3d = useEditor((s) => s.view3d)
  const setView3d = useEditor((s) => s.setView3d)
  const baseMap = useEditor((s) => s.baseMap)
  const setBaseMap = useEditor((s) => s.setBaseMap)
  const catalog = useEditor((s) => s.catalog)
  const notify = useEditor((s) => s.notify)
  const { properties, currentId, open, setDialog } = useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const projRef = useRef<HTMLInputElement>(null)
  if (!property) return null

  const importFile = async (f: File | undefined) => {
    if (!f) return
    try {
      await flush()
      const r = await api.importFeatures(property.id, f)
      await open(property.id)
      notify(`Imported ${r.imported} object${r.imported === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} skipped)` : ''}`)
    } catch (e) {
      notify((e as Error).message)
    }
  }
  const importProject = async (f: File | undefined) => {
    if (!f) return
    try {
      const p = await api.importProject(f)
      await useApp.getState().refresh()
      await open(p.id)
    } catch (e) {
      notify((e as Error).message)
    }
  }

  return (
    <header className="topbar glass">
      <div className="group">
        <select className="propselect" aria-label="Property" value={currentId ?? ''} onChange={(e) => void open(e.target.value)} title="Switch property">
          {properties.map((p) => <option key={p.id} value={p.id}>{p.isDemo ? '[DEMO] ' : ''}{p.name}</option>)}
        </select>
        <button className="tb" onClick={() => setDialog('new-property')} title="Create a new property"><Plus size={16} /><span>New</span></button>
      </div>
      <div className="group">
        <button className="tb" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)"><Undo2 size={16} /></button>
        <button className="tb" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Y)"><Redo2 size={16} /></button>
        <button className="tb" onClick={() => void flush()} title="Save now (Ctrl+S)"><Save size={16} /><span>Save</span></button>
        <SaveStatus />
      </div>
      <div className="group">
        <Menu icon={<Upload size={16} />} label="Import">
          {(close) => (
            <>
              <button onClick={() => { close(); fileRef.current?.click() }}>GeoJSON / KML into this property…</button>
              <button onClick={() => { close(); setDialog('image-import') }}>Aerial image or plan (calibrate)…</button>
              <button onClick={() => { close(); projRef.current?.click() }}>EDEN project file (.eden.json)…</button>
            </>
          )}
        </Menu>
        <Menu icon={<Download size={16} />} label="Export">
          {(close) => (
            <>
              {([['geojson', 'GeoJSON (GIS)'], ['kml', 'KML (Google Earth)'], ['csv', 'CSV table of objects'], ['json', 'EDEN project (full model)']] as const).map(([f, label]) => (
                <a key={f} href={api.exportUrl(property.id, f)} download onClick={() => { void flush(); close() }}>{label}</a>
              ))}
            </>
          )}
        </Menu>
        <input ref={fileRef} type="file" accept=".geojson,.json,.kml" hidden onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = '' }} />
        <input ref={projRef} type="file" accept=".json" hidden onChange={(e) => { void importProject(e.target.files?.[0]); e.target.value = '' }} />
      </div>
      <div className="group">
        <label className="tb select" title="Map layer">
          <Layers3 size={16} />
          <select value={baseMap} onChange={(e) => setBaseMap(e.target.value)}>
            {catalog && Object.entries(catalog.basemaps).map(([id, b]) => <option key={id} value={id}>{b.label}</option>)}
          </select>
        </label>
        <button className={`tb ${view3d ? 'on' : ''}`} onClick={() => setView3d(!view3d)} title="Toggle 3D view (right-drag or two fingers to orbit)"><Box size={16} /><span>{view3d ? '3D' : '2D'}</span></button>
        <button className="tb" onClick={() => mapRef.current?.fitObjects()} title="Zoom to everything"><Maximize size={16} /></button>
      </div>
      <SearchBox />
    </header>
  )
}

const COORD = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/

function SearchBox() {
  const [q, setQ] = useState('')
  const [places, setPlaces] = useState<GeocodeHit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const doc = useEditor((s) => s.doc)
  const focus = useEditor((s) => s.requestFocus)
  const term = q.trim().toLowerCase()
  const local = term.length < 2 ? [] : Object.values(doc.objects).filter((o) => `${o.name} ${kindDef(o.kind).label} ${String(o.props.species ?? '')}`.toLowerCase().includes(term)).slice(0, 8)
  const coord = COORD.exec(q)

  const searchPlaces = async () => {
    setBusy(true)
    setErr('')
    try {
      setPlaces(await api.geocode(q))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const goCoord = () => {
    if (!coord) return
    const lat = Number(coord[1])
    const lng = Number(coord[2])
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) mapRef.current?.flyTo([lng, lat], 18)
  }
  return (
    <div className="search">
      <Search size={15} />
      <input placeholder="Search objects, places or lat, lng…" value={q}
        onChange={(e) => { setQ(e.target.value); setPlaces(null); setErr('') }}
        onKeyDown={(e) => { if (e.key === 'Enter') { if (coord) goCoord(); else if (q.trim().length > 2) void searchPlaces() } if (e.key === 'Escape') setQ('') }} />
      {q.trim().length >= 2 && (
        <div className="menupop glass searchpop">
          {local.map((o) => (
            <button key={o.id} onClick={() => { focus(o.id); setQ('') }}><span className="swatch" style={{ background: kindDef(o.kind).color }} />{o.name || kindDef(o.kind).label}<small>{kindDef(o.kind).label}</small></button>
          ))}
          {coord && <button onClick={() => { goCoord(); setQ('') }}>Go to coordinates {coord[1]}, {coord[2]}</button>}
          {!coord && !places && <button onClick={() => void searchPlaces()}>{busy ? 'Searching…' : `Find place “${q.trim()}” on the map`}</button>}
          {places?.map((p) => <button key={p.label} onClick={() => { mapRef.current?.flyTo(p.center, 17.5); setQ(''); setPlaces(null) }}>{p.label}</button>)}
          {places && !places.length && <div className="empty">No places found.</div>}
          {err && <div className="empty">{err}</div>}
        </div>
      )}
    </div>
  )
}
