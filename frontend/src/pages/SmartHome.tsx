import { useEffect, useState } from 'react'
import { Plug, RefreshCw, Trash2 } from 'lucide-react'
import { smartApi } from '../api/client'
import { kindDef } from '../model/kinds'
import { useEditor } from '../model/store'
import { ago, stateText, useSmart } from '../smart/store'
import { SERVICES, type Device, type Integration } from '../smart/types'

const LINKABLE = new Set(['outlet', 'light', 'sensor', 'camera', 'solar', 'gh_heater', 'gh_fan', 'gh_light', 'gh_irrigation', 'pond_pump', 'pond_filter'])

export function usePolling(ms = 8000) {
  const load = useSmart((s) => s.load)
  useEffect(() => {
    void load()
    const h = setInterval(() => void load(), ms)
    return () => clearInterval(h)
  }, [load, ms])
}

function StatusPill({ i }: { i: Integration }) {
  const label = { online: 'connected', error: 'problem', disabled: 'disabled', unknown: 'not checked' }[i.status]
  return <span className={`conn ${i.status}`} title={i.statusMsg}>{label}</span>
}

export function SmartHomePage() {
  usePolling()
  const { integrations, devices, loaded, error, status } = useSmart()
  const load = useSmart((s) => s.load)
  const objects = useEditor((s) => s.doc.objects)
  const [adding, setAdding] = useState<null | 'homeassistant' | 'mqtt'>(null)
  const [msg, setMsg] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const hasMqtt = integrations.some((i) => i.kind === 'mqtt')

  const run = async (f: () => Promise<unknown>) => {
    setErr('')
    try {
      await f()
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const test = async (i: Integration) => {
    try {
      const r = await smartApi.testIntegration(i.id)
      setMsg((m) => ({ ...m, [i.id]: r.message }))
    } catch (e) {
      setMsg((m) => ({ ...m, [i.id]: (e as Error).message }))
    }
    await load()
  }
  const onMap = Object.values(objects).filter((o) => LINKABLE.has(o.kind))
  const linked = new Set(devices.map((d) => d.objectId).filter(Boolean))
  const unlinked = onMap.filter((o) => !linked.has(o.id))

  return (
    <div className="page">
      <div className="pagehead">
        <div><h1>Smart Home</h1><p>Devices from Home Assistant and MQTT. EDEN shows only what an integration really reports: nothing is simulated, and a device with no report says <b>no data</b>.</p></div>
        <span className="badge">Phase 5</span>
      </div>
      {error && <div className="notice err">{error}</div>}
      {err && <div className="notice err">{err}</div>}

      <h2 className="sect">Integrations</h2>
      <div className="cards">
        {integrations.map((i) => (
          <div key={i.id} className="card glass">
            <div className="cardtop"><Plug size={18} /><h3>{i.name}</h3><StatusPill i={i} /></div>
            <small className="muted">{i.kind === 'homeassistant' ? 'Home Assistant' : 'MQTT broker'} · {i.url} · {i.deviceCount} device{i.deviceCount === 1 ? '' : 's'} · {i.hasToken ? 'credentials stored (hidden)' : 'no credentials'}</small>
            {i.status === 'error' && <p className="warn">{i.statusMsg}</p>}
            {msg[i.id] && <p className="note">{msg[i.id]}</p>}
            <small className="muted">Last update: {ago(i.lastSync)}</small>
            <div className="btnrow">
              <button onClick={() => void test(i)}><RefreshCw size={13} /> Test &amp; sync</button>
              <button onClick={() => void run(() => smartApi.patchIntegration(i.id, { enabled: !i.enabled }))}>{i.enabled ? 'Disable' : 'Enable'}</button>
              <button onClick={() => { const t = prompt(i.kind === 'homeassistant' ? 'New long-lived access token (stored on this computer, never shown again):' : 'New MQTT password:'); if (t !== null) void run(() => smartApi.patchIntegration(i.id, { token: t })) }}>Change {i.kind === 'homeassistant' ? 'token' : 'password'}</button>
              <button className="danger icon" title="Remove integration and its devices" onClick={() => { if (confirm(`Remove “${i.name}” and its ${i.deviceCount} devices from EDEN? Nothing is changed in ${i.kind === 'homeassistant' ? 'Home Assistant' : 'the broker'}.`)) void run(() => smartApi.deleteIntegration(i.id)) }}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
        {adding ? <AddIntegration kind={adding} onDone={() => { setAdding(null); void load() }} onCancel={() => setAdding(null)} mqttOk={status?.mqttAvailable ?? true} /> : (
          <div className="card glass dashed">
            <div className="cardtop"><Plug size={18} /><h3>Add an integration</h3></div>
            <p className="muted">Connect Home Assistant (recommended: it already talks to most devices) or an MQTT broker.</p>
            <div className="btnrow"><button className="primary" onClick={() => setAdding('homeassistant')}>Home Assistant</button><button onClick={() => setAdding('mqtt')}>MQTT broker</button></div>
          </div>
        )}
      </div>
      {!integrations.length && loaded && <div className="notice">Nothing is connected, so EDEN shows no device status at all. Outlets, lights and sensors you place on the map stay marked <b>not connected</b> until a device is linked to them.</div>}

      <h2 className="sect">Devices</h2>
      <div className="glass tablewrap">
        <table>
          <thead><tr><th>Device</th><th>Type</th><th>Reported state</th><th>Map object</th><th>Controls</th><th /></tr></thead>
          <tbody>
            {devices.map((d) => <DeviceRow key={d.id} d={d} onChange={() => void load()} onErr={setErr} />)}
            {!devices.length && <tr><td colSpan={6} className="empty">No devices yet. Connect an integration above{hasMqtt ? ' and add MQTT topics below' : ''}.</td></tr>}
          </tbody>
        </table>
      </div>
      {hasMqtt && <AddMqttDevice integrations={integrations.filter((i) => i.kind === 'mqtt')} onDone={() => void load()} onErr={setErr} />}

      <h2 className="sect">On the map but not connected</h2>
      <p className="muted">Positions you drew in the Property Editor that have no device linked. They show no status anywhere in EDEN.</p>
      <ul className="objlist">
        {unlinked.map((o) => <li key={o.id}><span className="swatch" style={{ background: kindDef(o.kind).color }} /> {o.name || kindDef(o.kind).label} <small className="muted">{kindDef(o.kind).label} · not connected</small></li>)}
        {!unlinked.length && <li className="empty">{onMap.length ? 'Every device on the map is linked.' : 'No outlets, lights, sensors or cameras on the map yet.'}</li>}
      </ul>
    </div>
  )
}

function DeviceRow({ d, onChange, onErr }: { d: Device; onChange: () => void; onErr: (m: string) => void }) {
  const objects = useEditor((s) => s.doc.objects)
  const [busy, setBusy] = useState(false)
  const offline = d.integrationStatus !== 'online' && d.domain !== 'mqtt'
  const options = Object.values(objects).filter((o) => LINKABLE.has(o.kind))
  const send = async (service: string, label: string) => {
    if (d.risky && !confirm(`“${d.name}” is marked as risky. Really send “${label}”?`)) return
    setBusy(true)
    onErr('')
    try {
      await smartApi.command(d.id, service, d.risky)
      onChange()
    } catch (e) {
      onErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const patch = async (b: Parameters<typeof smartApi.patchDevice>[1]) => {
    try {
      await smartApi.patchDevice(d.id, b)
      onChange()
    } catch (e) {
      onErr((e as Error).message)
    }
  }
  return (
    <tr>
      <td>
        <input className="inlineedit" defaultValue={d.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== d.name) void patch({ name: e.target.value }) }} />
        <small className="muted mono"> {d.externalId}</small>
      </td>
      <td>{d.domain}{d.deviceClass ? ` · ${d.deviceClass}` : ''}</td>
      <td>
        <b className={`st ${d.state === null ? 'nodata' : ['unavailable', 'unknown'].includes(d.state) ? 'bad' : ''}`}>{stateText(d)}</b>
        {offline && <small className="warn"> integration offline: last known value</small>}
        <br /><small className="muted">changed {ago(d.stateUpdated)}</small>
      </td>
      <td>
        <select value={d.objectId ?? ''} onChange={(e) => void patch({ objectId: e.target.value || null })}>
          <option value="">not linked</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name || kindDef(o.kind).label} ({kindDef(o.kind).label})</option>)}
        </select>
      </td>
      <td>
        {d.controllable && (SERVICES[d.domain] ?? []).map(([s, label]) => <button key={s} className="chip" disabled={busy || offline} onClick={() => void send(s, label)}>{label}</button>)}
        {!d.controllable && <small className="muted">read-only</small>}
        {d.controllable && <label className="check riskcheck" title="Commands (and automations) need your explicit confirmation"><input type="checkbox" checked={d.risky} onChange={(e) => void patch({ risky: e.target.checked })} /> risky</label>}
      </td>
      <td><button className="danger icon" title="Forget this device in EDEN" onClick={() => { if (confirm(`Forget “${d.name}”? (It is re-imported on the next sync if Home Assistant still has it.)`)) void smartApi.deleteDevice(d.id).then(onChange) }}><Trash2 size={14} /></button></td>
    </tr>
  )
}

function AddIntegration({ kind, onDone, onCancel, mqttOk }: { kind: 'homeassistant' | 'mqtt'; onDone: () => void; onCancel: () => void; mqttOk: boolean }) {
  const [f, setF] = useState({ name: kind === 'homeassistant' ? 'Home Assistant' : 'MQTT broker', url: kind === 'homeassistant' ? 'http://homeassistant.local:8123' : '', token: '', port: '1883', username: '', tls: false })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: unknown) => setF((s) => ({ ...s, [k]: v }))
  const save = async () => {
    setBusy(true)
    setErr('')
    try {
      const options = kind === 'mqtt' ? { port: Number(f.port) || 1883, username: f.username, tls: f.tls } : {}
      const i = await smartApi.addIntegration({ kind, name: f.name, url: f.url, token: f.token || undefined, options })
      await smartApi.testIntegration(i.id) // the result (including a failure reason) is shown on the integration's card
      onDone()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="card glass">
      <div className="cardtop"><Plug size={18} /><h3>{kind === 'homeassistant' ? 'Connect Home Assistant' : 'Connect an MQTT broker'}</h3></div>
      {kind === 'homeassistant' && <p className="note">In Home Assistant open your profile, scroll to <b>Long-lived access tokens</b> and create one. EDEN stores it on this computer only and never shows it again.</p>}
      {kind === 'mqtt' && !mqttOk && <p className="warn">The optional <code>paho-mqtt</code> package is not installed on the server, so MQTT cannot connect (pip install paho-mqtt).</p>}
      <label>Name<input value={f.name} onChange={(e) => set('name', e.target.value)} /></label>
      <label>{kind === 'homeassistant' ? 'Home Assistant URL' : 'Broker host'}<input value={f.url} placeholder={kind === 'mqtt' ? '192.168.1.10' : ''} onChange={(e) => set('url', e.target.value)} /></label>
      {kind === 'mqtt' && <div className="two"><label>Port<input value={f.port} onChange={(e) => set('port', e.target.value)} /></label><label>User name<input value={f.username} autoComplete="off" onChange={(e) => set('username', e.target.value)} /></label></div>}
      <label>{kind === 'homeassistant' ? 'Long-lived access token' : 'Password (optional)'}<input type="password" autoComplete="new-password" value={f.token} onChange={(e) => set('token', e.target.value)} /></label>
      {kind === 'mqtt' && <label className="check"><input type="checkbox" checked={f.tls} onChange={(e) => set('tls', e.target.checked)} /> Use TLS</label>}
      {err && <p className="warn">{err}</p>}
      <div className="btnrow"><button className="primary" disabled={busy || !f.url.trim()} onClick={() => void save()}>{busy ? 'Connecting…' : 'Save & test'}</button><button onClick={onCancel}>Cancel</button></div>
    </div>
  )
}

function AddMqttDevice({ integrations, onDone, onErr }: { integrations: Integration[]; onDone: () => void; onErr: (m: string) => void }) {
  const [f, setF] = useState({ integrationId: integrations[0]?.id ?? '', name: '', stateTopic: '', commandTopic: '', unit: '' })
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }))
  return (
    <div className="formcard glass">
      <h3>Add an MQTT device</h3>
      <p className="note">One exact topic per device. Its state is whatever the last message on that topic said, and stays <b>no data</b> until a message arrives. A command topic is optional (EDEN publishes ON / OFF).</p>
      <div className="three">
        <label>Name<input value={f.name} onChange={(e) => set('name', e.target.value)} /></label>
        <label>State topic<input value={f.stateTopic} placeholder="shed/temperature" onChange={(e) => set('stateTopic', e.target.value)} /></label>
        <label>Command topic (optional)<input value={f.commandTopic} placeholder="shed/fan/set" onChange={(e) => set('commandTopic', e.target.value)} /></label>
      </div>
      <div className="inline">
        <input style={{ maxWidth: 110 }} placeholder="unit, e.g. °C" value={f.unit} onChange={(e) => set('unit', e.target.value)} />
        {integrations.length > 1 && <select value={f.integrationId} onChange={(e) => set('integrationId', e.target.value)}>{integrations.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>}
        <button className="primary" disabled={!f.name.trim() || !f.stateTopic.trim()} onClick={() => { onErr(''); smartApi.addMqttDevice({ ...f, commandTopic: f.commandTopic || undefined }).then(() => { setF({ ...f, name: '', stateTopic: '', commandTopic: '', unit: '' }); onDone() }).catch((e) => onErr((e as Error).message)) }}>Add device</button>
      </div>
    </div>
  )
}
