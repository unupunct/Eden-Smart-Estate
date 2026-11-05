import { useEffect, useRef, useState } from 'react'
import { Camera as CamIcon, Maximize2, Pause, Play, Trash2, X } from 'lucide-react'
import { smartApi } from '../api/client'
import { OnvifPanel } from './OnvifPanel'
import { useEditor } from '../model/store'
import { useSmart } from '../smart/store'
import type { Camera, Integration } from '../smart/types'
import { usePolling } from './SmartHome'

const KIND_HELP: Record<Camera['kind'], string> = {
  snapshot: 'A web address that returns the current picture as JPEG (most IP cameras have one). Refreshed every few seconds.',
  mjpeg: 'A web address that streams motion JPEG. Shown as a live stream.',
  rtsp: 'An rtsp:// address. Needs ffmpeg installed on the EDEN computer to grab pictures (refreshed every few seconds, not a smooth video).',
  ha: 'A camera entity of your connected Home Assistant (camera.front_door). Pictures come through Home Assistant.',
}

/** Loads a picture through the EDEN server (credentials stay there). Shows the server's reason instead of a blank when it fails. */
function Feed({ cam, every, big }: { cam: Camera; every: number; big?: boolean }) {
  const [src, setSrc] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [at, setAt] = useState<Date | null>(null)
  const last = useRef<string | null>(null)
  useEffect(() => {
    if (cam.kind === 'mjpeg') return
    let stop = false
    const pull = async () => {
      try {
        const r = await fetch(`${smartApi.snapshotUrl(cam.id)}?t=${Date.now()}`)
        if (!r.ok) {
          let m = r.statusText
          try { m = (await r.json()).detail ?? m } catch { /* keep */ }
          if (!stop) setErr(m)
          return
        }
        const url = URL.createObjectURL(await r.blob())
        if (stop) return URL.revokeObjectURL(url)
        if (last.current) URL.revokeObjectURL(last.current)
        last.current = url
        setSrc(url)
        setErr('')
        setAt(new Date())
      } catch {
        if (!stop) setErr('Cannot reach the EDEN server.')
      }
    }
    void pull()
    const h = every > 0 ? setInterval(() => void pull(), every * 1000) : undefined
    return () => {
      stop = true
      if (h) clearInterval(h)
    }
  }, [cam.id, cam.kind, every])
  useEffect(() => () => { if (last.current) URL.revokeObjectURL(last.current) }, [])
  if (cam.kind === 'mjpeg') return err ? <div className="feed err">{err}</div> : <img className={`feed ${big ? 'big' : ''}`} src={smartApi.streamUrl(cam.id)} alt={cam.name} onError={() => setErr('The stream could not be opened (check the address and password).')} />
  return (
    <div className={`feed ${big ? 'big' : ''} ${err ? 'err' : ''}`}>
      {src && <img src={src} alt={cam.name} />}
      {err && <p>{err}</p>}
      {!src && !err && <p className="muted">Loading…</p>}
      {src && at && <small className="stamp">picture taken {at.toLocaleTimeString()}{err ? ' · latest refresh failed' : ''}</small>}
    </div>
  )
}

export function SecurityPage() {
  usePolling(15000)
  const { cameras, integrations, status } = useSmart()
  const load = useSmart((s) => s.load)
  const objects = useEditor((s) => s.doc.objects)
  const [every, setEvery] = useState(5)
  const [paused, setPaused] = useState(false)
  const [full, setFull] = useState<Camera | null>(null)
  const [adding, setAdding] = useState(false)
  const [onvif, setOnvif] = useState(false)
  const placed = Object.values(objects).filter((o) => o.kind === 'camera')
  const linked = new Set(cameras.map((c) => c.objectId))
  const unconfigured = placed.filter((o) => !linked.has(o.id))
  return (
    <div className="page">
      <div className="pagehead">
        <div><h1>Security &amp; Cameras</h1><p>Pictures come from your cameras through the EDEN server, so passwords never reach the browser. If a camera cannot be reached EDEN shows the reason, never an old or made-up picture.</p></div>
        <span className="badge">Phase 5</span>
      </div>
      <div className="btnrow">
        <button className="primary" onClick={() => setAdding(true)}><CamIcon size={14} /> Add camera</button>
        <button onClick={() => setOnvif((v) => !v)}>Find ONVIF camera…</button>
        <label className="tb">Refresh every
          <select value={every} onChange={(e) => setEvery(Number(e.target.value))}><option value={2}>2 s</option><option value={5}>5 s</option><option value={10}>10 s</option><option value={30}>30 s</option></select></label>
        <button onClick={() => setPaused((p) => !p)}>{paused ? <Play size={14} /> : <Pause size={14} />} {paused ? 'Resume' : 'Pause'}</button>
      </div>
      {onvif && <OnvifPanel onDone={() => void load()} onCancel={() => setOnvif(false)} />}
      {adding && <AddCamera integrations={integrations.filter((i) => i.kind === 'homeassistant')} onDone={() => { setAdding(false); void load() }} onCancel={() => setAdding(false)} ffmpeg={status?.ffmpeg ?? false} />}
      <div className="camgrid">
        {cameras.map((c) => (
          <div key={c.id} className="camtile glass">
            <div className="camhead"><b>{c.name}</b><small className="muted">{c.kind}{c.objectId && objects[c.objectId] ? ` · ${objects[c.objectId].name}` : ''}</small>
              <button className="icon" title="Full screen" onClick={() => setFull(c)}><Maximize2 size={14} /></button>
              <button className="icon danger" title="Remove camera" onClick={() => { if (confirm(`Remove camera “${c.name}” from EDEN?`)) void smartApi.deleteCamera(c.id).then(() => load()) }}><Trash2 size={14} /></button></div>
            <Feed cam={c} every={paused ? 0 : every} />
          </div>
        ))}
        {!cameras.length && (
          <div className="card glass dashed"><div className="cardtop"><CamIcon size={18} /><h3>No camera configured</h3></div><p className="muted">There is no live picture, and EDEN does not simulate one. Add a camera to see it here.</p></div>
        )}
      </div>
      {unconfigured.length > 0 && <p className="muted">On the map without a feed: {unconfigured.map((o) => o.name || 'Camera').join(', ')}. Add a camera and choose the map position to link it.</p>}
      <details className="more"><summary>What EDEN can and cannot do with cameras</summary>
        <ul className="assume">
          <li>Snapshot, MJPEG and Home Assistant cameras work out of the box. RTSP needs ffmpeg ({status?.ffmpeg ? 'found on this computer' : 'not found on this computer'}).</li>
          <li>ONVIF cameras can be found on your network (multicast must be allowed) and added with their ONVIF user name and password; EDEN reads the picture and video addresses from the camera. This was tested against a simulated camera only, so a real camera may need ONVIF switched on in its own settings. If discovery finds nothing, add the camera by its snapshot or RTSP address.</li>
          <li>No recording, motion detection or cloud: EDEN only displays what the camera delivers right now.</li>
          <li>Camera passwords are stored on this computer, never returned by the API. They are part of a full backup file, so keep backups private.</li>
        </ul>
      </details>
      {full && (
        <div className="modal-back" onClick={() => setFull(null)}>
          <div className="fullcam" onClick={(e) => e.stopPropagation()}>
            <div className="camhead"><b>{full.name}</b><button className="icon" onClick={() => setFull(null)}><X size={18} /></button></div>
            <Feed cam={full} every={paused ? 0 : Math.min(every, 5)} big />
          </div>
        </div>
      )}
    </div>
  )
}

function AddCamera({ integrations, onDone, onCancel, ffmpeg }: { integrations: Integration[]; onDone: () => void; onCancel: () => void; ffmpeg: boolean }) {
  const objects = useEditor((s) => s.doc.objects)
  const cams = Object.values(objects).filter((o) => o.kind === 'camera')
  const [f, setF] = useState({ name: '', kind: 'snapshot' as Camera['kind'], url: '', username: '', password: '', integrationId: integrations[0]?.id ?? '', entityId: '', objectId: '' })
  const [err, setErr] = useState('')
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }))
  const save = async () => {
    setErr('')
    try {
      await smartApi.addCamera({ name: f.name, kind: f.kind, url: f.url, username: f.username, password: f.password || undefined, integrationId: f.kind === 'ha' ? f.integrationId : null, entityId: f.entityId, objectId: f.objectId || null })
      onDone()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <div className="formcard glass">
      <h3>Add a camera</h3>
      <div className="two">
        <label>Name<input value={f.name} onChange={(e) => set('name', e.target.value)} /></label>
        <label>Type<select value={f.kind} onChange={(e) => set('kind', e.target.value)}><option value="snapshot">Snapshot URL (JPEG)</option><option value="mjpeg">MJPEG stream</option><option value="rtsp">RTSP stream</option><option value="ha">Home Assistant camera</option></select></label>
      </div>
      <p className="note">{KIND_HELP[f.kind]}{f.kind === 'rtsp' && !ffmpeg ? ' ffmpeg was not found on this computer.' : ''}</p>
      {f.kind === 'ha' ? (
        <div className="two">
          <label>Integration<select value={f.integrationId} onChange={(e) => set('integrationId', e.target.value)}>{integrations.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
          <label>Camera entity<input value={f.entityId} placeholder="camera.front_door" onChange={(e) => set('entityId', e.target.value)} /></label>
        </div>
      ) : (
        <>
          <label>Address<input value={f.url} placeholder={f.kind === 'rtsp' ? 'rtsp://192.168.1.20:554/stream1' : 'http://192.168.1.20/snapshot.jpg'} onChange={(e) => set('url', e.target.value)} /></label>
          <div className="two"><label>User name (optional)<input autoComplete="off" value={f.username} onChange={(e) => set('username', e.target.value)} /></label><label>Password (optional, stored hidden)<input type="password" autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} /></label></div>
        </>
      )}
      <label>Position on the map<select value={f.objectId} onChange={(e) => set('objectId', e.target.value)}><option value="">not linked</option>{cams.map((o) => <option key={o.id} value={o.id}>{o.name || 'Camera'}</option>)}</select></label>
      {err && <p className="warn">{err}</p>}
      <div className="btnrow"><button className="primary" disabled={!f.name.trim()} onClick={() => void save()}>Add camera</button><button onClick={onCancel}>Cancel</button></div>
    </div>
  )
}
