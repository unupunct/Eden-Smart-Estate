import { useState } from 'react'
import { MapPin, X } from 'lucide-react'
import { api, type GeocodeHit } from '../api/client'
import { useApp } from '../model/app'
import type { Pos } from '../model/types'

const COORD = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/

export function NewPropertyDialog() {
  const { setDialog, refresh, open, go } = useApp()
  const [name, setName] = useState('My estate')
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<GeocodeHit[]>([])
  const [center, setCenter] = useState<Pos | null>(null)
  const [label, setLabel] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const search = async () => {
    setErr('')
    const m = COORD.exec(q)
    if (m) {
      const lat = Number(m[1]), lng = Number(m[2])
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return setErr('Coordinates out of range. Enter latitude first, then longitude.')
      setCenter([lng, lat])
      setLabel(`${lat}, ${lng}`)
      return setHits([])
    }
    setBusy(true)
    try {
      const r = await api.geocode(q)
      setHits(r)
      if (!r.length) setErr('No places found. Try a nearby village or enter coordinates as “lat, lng”.')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    if (!center || !name.trim()) return
    setBusy(true)
    try {
      const p = await api.createProperty(name.trim(), center, 17)
      await refresh()
      await open(p.id)
      setDialog(null)
      go('editor')
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setDialog(null)}>
      <div className="modal glass">
        <div className="modal-head"><h3>New property</h3><button className="icon" onClick={() => setDialog(null)}><X size={16} /></button></div>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <label>Where is it?
          <div className="inline">
            <input placeholder="Village, address or  46.0484, 24.0526" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && q.trim().length > 1 && void search()} />
            <button onClick={() => void search()} disabled={busy || q.trim().length < 2}>Find</button>
          </div>
        </label>
        {hits.length > 0 && (
          <ul className="hits">
            {hits.map((h) => <li key={h.label}><button onClick={() => { setCenter(h.center); setLabel(h.label); setHits([]) }}><MapPin size={14} /> {h.label}</button></li>)}
          </ul>
        )}
        {center && <div className="notice ok"><MapPin size={14} /> {label}</div>}
        <p className="note">You can fine-tune the position on the map afterwards. Place search uses OpenStreetMap Nominatim through your local EDEN server; coordinates work offline.</p>
        {err && <div className="notice err">{err}</div>}
        <div className="btnrow end">
          <button onClick={() => setDialog(null)}>Cancel</button>
          <button className="primary" disabled={!center || !name.trim() || busy} onClick={() => void create()}>Create and open editor</button>
        </div>
      </div>
    </div>
  )
}
