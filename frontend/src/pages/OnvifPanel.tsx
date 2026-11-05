import { useState } from 'react'
import { Radar } from 'lucide-react'
import { useEditor } from '../model/store'

interface Found { id: string; xaddr: string; host: string; name: string; hardware: string; location: string; alreadyAdded: boolean }
interface Profile { token: string; name: string; encoding: string; width: number; height: number; streamUri: string; snapshotUri: string }
interface Inspect { device: Record<string, string>; profiles: Profile[] }

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (r.status === 401) { location.reload(); throw new Error('Login required') }
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : r.statusText)
  return j as T
}

/** Find ONVIF cameras on the network, log in, pick a video profile and add it. */
export function OnvifPanel({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const objects = useEditor((s) => s.doc.objects)
  const [found, setFound] = useState<Found[] | null>(null)
  const [note, setNote] = useState('')
  const [xaddr, setXaddr] = useState('')
  const [cred, setCred] = useState({ username: '', password: '' })
  const [info, setInfo] = useState<Inspect | null>(null)
  const [token, setToken] = useState('')
  const [name, setName] = useState('')
  const [objectId, setObjectId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')
  const cams = Object.values(objects).filter((o) => o.kind === 'camera')

  const run = async (fn: () => Promise<void>) => {
    setErr(''); setBusy(true)
    try { await fn() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const search = () => run(async () => {
    setFound(null)
    const r = await post<{ cameras: Found[]; note: string }>('/api/onvif/discover', { seconds: 3 })
    setFound(r.cameras); setNote(r.note)
  })
  const login = () => run(async () => {
    const r = await post<Inspect>('/api/onvif/profiles', { xaddr, ...cred })
    setInfo(r)
    setToken(r.profiles[0]?.token ?? '')
    setName((n) => n || [r.device.Manufacturer, r.device.Model].filter(Boolean).join(' ') || 'ONVIF camera')
  })
  const add = () => run(async () => {
    const r = await post<{ name: string; note: string }>('/api/onvif/add', { xaddr, ...cred, profileToken: token, name, objectId: objectId || null })
    setDone(`${r.name}: ${r.note}`)
    onDone()
  })

  return (
    <div className="glass formcard" aria-labelledby="onvif-h">
      <h3 id="onvif-h"><Radar size={16} /> Find an ONVIF camera</h3>
      <p className="note">EDEN asks your network which cameras speak ONVIF, then logs in with the user name and password you give (use the ONVIF user you created in the camera’s own settings) and reads its picture and video addresses from the camera itself. Only addresses on your own network are contacted. The password is stored on this computer like every camera password.</p>
      {err && <div className="notice err" role="alert">{err}</div>}
      {done && <div className="notice ok" role="status">{done}</div>}
      <div className="btnrow"><button disabled={busy} onClick={() => void search()}>{busy && !found ? 'Searching…' : 'Search the network'}</button></div>
      {found && (
        <>
          {found.length === 0 ? <p className="note">{note}</p> : (
            <ul className="plain">
              {found.map((c) => (
                <li key={c.xaddr} className="inline">
                  <span><strong>{c.name || c.hardware || c.host}</strong> · {c.host}{c.hardware && c.name ? ` · ${c.hardware}` : ''}{c.alreadyAdded ? ' · already added' : ''}</span>
                  <button onClick={() => { setXaddr(c.xaddr); setInfo(null) }}>Use this camera</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <label>Camera’s ONVIF address
        <input value={xaddr} onChange={(e) => { setXaddr(e.target.value); setInfo(null) }} placeholder="http://192.168.1.20/onvif/device_service" />
      </label>
      <div className="two">
        <label>ONVIF user name<input autoComplete="off" value={cred.username} onChange={(e) => setCred({ ...cred, username: e.target.value })} /></label>
        <label>Password<input type="password" autoComplete="off" value={cred.password} onChange={(e) => setCred({ ...cred, password: e.target.value })} /></label>
      </div>
      <div className="btnrow"><button className="primary" disabled={busy || !xaddr.trim() || !cred.username} onClick={() => void login()}>Log in and read the camera</button></div>
      {info && (
        <>
          <p className="note">{[info.device.Manufacturer, info.device.Model, info.device.FirmwareVersion && `firmware ${info.device.FirmwareVersion}`].filter(Boolean).join(' · ') || 'Camera answered.'}</p>
          <label>Video profile
            <select value={token} onChange={(e) => setToken(e.target.value)}>
              {info.profiles.map((p) => <option key={p.token} value={p.token}>{p.name || p.token}{p.width ? ` · ${p.width}×${p.height}` : ''}{p.encoding ? ` · ${p.encoding}` : ''}{p.snapshotUri ? ' · snapshot' : p.streamUri ? ' · RTSP (needs ffmpeg)' : ''}</option>)}
            </select>
          </label>
          <div className="two">
            <label>Name in EDEN<input value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label>Camera on the map<select value={objectId} onChange={(e) => setObjectId(e.target.value)}><option value="">not linked</option>{cams.map((o) => <option key={o.id} value={o.id}>{o.name || 'Camera'}</option>)}</select></label>
          </div>
          <div className="btnrow"><button className="primary" disabled={busy || !name.trim() || !token} onClick={() => void add()}>Add this camera</button></div>
        </>
      )}
      <div className="btnrow"><button onClick={onCancel}>Close</button></div>
    </div>
  )
}
