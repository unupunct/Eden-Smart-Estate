import { useEffect, useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { api, type AppSettings } from '../api/client'
import { useApp } from '../model/app'
import { useEditor } from '../model/store'

const PROVIDER_LABEL: Record<string, string> = {
  'esri-imagery': 'Esri World Imagery (no key needed)',
  'maptiler-satellite': 'MapTiler Satellite (your API key)',
  custom: 'Custom XYZ tile server (your URL)',
}

export function SettingsPage() {
  const [s, setS] = useState<AppSettings | null>(null)
  const [mt, setMt] = useState('')
  const [custom, setCustom] = useState({ url: '', attr: '', key: '' })
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const restore = useRef<HTMLInputElement>(null)
  const setCatalog = useEditor((x) => x.setCatalog)

  useEffect(() => {
    api.settings().then((r) => { setS(r); setCustom((c) => ({ ...c, url: r.customTilesUrl, attr: r.customAttribution })) }).catch((e) => setErr(e.message))
  }, [])

  const save = async (patch: Parameters<typeof api.saveSettings>[0], ok: string) => {
    setErr(''); setMsg('')
    try {
      const r = await api.saveSettings(patch)
      setS(r)
      setCatalog(await api.providers())
      setMsg(ok)
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const doRestore = async (f?: File) => {
    if (!f) return
    if (!confirm('Restoring replaces ALL current data with the backup. A safety copy of the current database is kept in data/backups. Continue?')) return
    try {
      await api.restore(f)
      await useApp.getState().refresh()
      const first = useApp.getState().properties[0]
      if (first) await useApp.getState().open(first.id)
      else useEditor.getState().clearProperty()
      setMsg('Backup restored.')
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  if (!s) return <div className="page"><h1>Settings</h1>{err ? <div className="notice err">{err}</div> : <p>Loading…</p>}</div>

  return (
    <div className="page narrow">
      <div className="pagehead"><div><h1>Settings</h1><p>Imagery sources, backup and about.</p></div></div>
      {msg && <div className="notice ok">{msg}</div>}
      {err && <div className="notice err">{err}</div>}

      <section className="glass formcard">
        <h2>Satellite imagery provider</h2>
        <p className="note">EDEN never scrapes tiles. It uses a documented imagery service you choose and shows that provider’s attribution on the map. Please read your provider’s terms of use; commercial or high-volume use usually needs your own key.</p>
        <label>Provider used for the Satellite and Hybrid maps
          <select value={s.satelliteProvider} onChange={(e) => void save({ satelliteProvider: e.target.value }, 'Provider updated.')}>
            {s.satelliteChoices.map((c) => <option key={c} value={c}>{PROVIDER_LABEL[c] ?? c}</option>)}
          </select>
        </label>
        {s.satelliteProvider === 'maptiler-satellite' && !s.hasMaptilerKey && <div className="notice">Add a MapTiler key below, otherwise Esri imagery is used as the fallback.</div>}

        <label>Esri imagery: deepest zoom level to request
          <select value={s.esriMaxZoom} onChange={(e) => void save({ esriMaxZoom: Number(e.target.value) }, 'Zoom limit updated.')}>
            {[16, 17, 18, 19].map((z) => <option key={z} value={z}>{z}{z === 17 ? ' (safe default for rural areas)' : z === 19 ? ' (cities only)' : ''}</option>)}
          </select>
        </label>
        <p className="note">Coverage depth differs by region. If you see grey “Map data not yet available” tiles, lower this value — the map then magnifies the last available level. Dense areas often have level 18–19.</p>

        <h3>MapTiler</h3>
        <p className="note">Get a free key at maptiler.com. The key is stored in your local database and used only by the EDEN server; it is never sent to the browser.</p>
        <div className="inline">
          <input type="password" autoComplete="off" placeholder={s.hasMaptilerKey ? '•••••••• (saved — type to replace)' : 'API key'} value={mt} onChange={(e) => setMt(e.target.value)} />
          <button disabled={!mt.trim()} onClick={() => { void save({ maptilerKey: mt }, 'MapTiler key saved.'); setMt('') }}>Save key</button>
          {s.hasMaptilerKey && <button className="danger" onClick={() => void save({ maptilerKey: '' }, 'MapTiler key removed.')}>Remove</button>}
        </div>

        <h3>Custom XYZ tiles</h3>
        <p className="note">Any provider that serves <code>{'{z}/{x}/{y}'}</code> tiles (for example your own WMTS/XYZ endpoint or a drone-imagery host). Use <code>{'{key}'}</code> in the URL if it needs a key; the key stays on the server.</p>
        <label>Tile URL<input placeholder="https://tiles.example.com/{z}/{x}/{y}.jpg?key={key}" value={custom.url} onChange={(e) => setCustom({ ...custom, url: e.target.value })} /></label>
        <label>Attribution text<input placeholder="© Your provider" value={custom.attr} onChange={(e) => setCustom({ ...custom, attr: e.target.value })} /></label>
        <label>Key (optional)<input type="password" autoComplete="off" placeholder={s.hasCustomKey ? '•••••••• (saved)' : 'key'} value={custom.key} onChange={(e) => setCustom({ ...custom, key: e.target.value })} /></label>
        <button onClick={() => { void save({ customTilesUrl: custom.url, customAttribution: custom.attr, ...(custom.key ? { customKey: custom.key } : {}) }, 'Custom provider saved.'); setCustom((c) => ({ ...c, key: '' })) }}>Save custom provider</button>
      </section>

      <section className="glass formcard">
        <h2>Backup and restore</h2>
        <p className="note">A backup is one .zip with your whole database and every imported image. Your data lives in the <code>data</code> folder next to the app; updates never touch it.</p>
        <div className="btnrow">
          <a className="btn" href={api.backupUrl} download><Download size={14} /> Download full backup</a>
          <button onClick={() => restore.current?.click()}><Upload size={14} /> Restore from backup…</button>
          <input ref={restore} hidden type="file" accept=".zip" onChange={(e) => { void doRestore(e.target.files?.[0]); e.target.value = '' }} />
        </div>
      </section>

      <section className="glass formcard">
        <h2>About</h2>
        <p><strong>EDEN — Smart Estate</strong> v1.0.0 · map, property editor, landscape design, plant library, sun and shadows, night sky, smart home, cameras, automations, tasks, documents, weather, reports and optional password protection.</p>
        <p className="note">Units are metric. Areas and distances are geodesic (on the WGS84 sphere), so they stay correct at any zoom and map layer.</p>
      </section>
    </div>
  )
}
