import { useEffect, useState } from 'react'
import { Pencil, Play, Plus, Trash2, Zap } from 'lucide-react'
import { smartApi } from '../api/client'
import { useSmart } from '../smart/store'
import { SERVICES, type Action, type Automation, type Condition, type Device, type LogEntry, type Trigger } from '../smart/types'
import { usePolling } from './SmartHome'

interface Draft {
  id?: string
  name: string
  trigger: Trigger
  conditions: Condition[]
  actions: Action[]
  enabled: boolean
  riskAck: boolean
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const blank = (d?: Device): Draft => ({ name: '', trigger: { type: 'state', deviceId: d?.id ?? '', below: '' }, conditions: [], actions: [], enabled: false, riskAck: false })

export function AutomationsPage() {
  usePolling(8000)
  const { automations, devices, status } = useSmart()
  const load = useSmart((s) => s.load)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState<Record<string, string[]>>({})
  const [log, setLog] = useState<LogEntry[]>([])
  const refreshLog = () => smartApi.log(80).then(setLog).catch(() => undefined)
  useEffect(() => {
    void refreshLog()
    const h = setInterval(() => void refreshLog(), 8000)
    return () => clearInterval(h)
  }, [])

  const wrap = async (f: () => Promise<unknown>) => {
    setErr('')
    try {
      await f()
      await load()
      await refreshLog()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const run = async (a: Automation, dry: boolean) => {
    if (!dry && !confirm(`Run “${a.name}” now? Its actions are sent to the real devices${a.riskyDevices.length ? ` (including risky: ${a.riskyDevices.join(', ')})` : ''}.`)) return
    await wrap(async () => {
      const r = await smartApi.runAutomation(a.id, dry, !dry)
      setInfo((m) => ({ ...m, [a.id]: r.messages }))
    })
  }
  return (
    <div className="page">
      <div className="pagehead">
        <div><h1>Automations</h1><p>Simple rules: <b>when</b> something happens, <b>if</b> conditions hold, <b>then</b> do something. They run on the EDEN server while it is running.</p></div>
        <span className="badge">Phase 5</span>
      </div>
      <div className="notice">Automations are a convenience, <b>not a safety system</b>. Never rely on them for anything where a failure could cause damage or harm (frost protection, flood prevention, heating, locks). A rule never acts on a device whose state is unknown or whose integration is offline.{status ? ` The engine checks every ${status.pollSeconds || '?'} s.` : ''}</div>
      {err && <div className="notice err">{err}</div>}
      <div className="btnrow"><button className="primary" disabled={!devices.length} onClick={() => setDraft(blank(devices.find((d) => d.domain === 'sensor' || d.domain === 'binary_sensor') ?? devices[0]))}><Plus size={14} /> New automation</button>
        {!devices.length && <small className="muted">Connect an integration with devices first (Smart Home).</small>}</div>
      {draft && <Editor draft={draft} devices={devices} onCancel={() => setDraft(null)} onSave={(d) => wrap(async () => {
        const body = { name: d.name, trigger: d.trigger, conditions: d.conditions, actions: d.actions, enabled: d.enabled, riskAck: d.riskAck }
        if (d.id) await smartApi.patchAutomation(d.id, body)
        else await smartApi.addAutomation(body)
        setDraft(null)
      })} />}
      <div className="cardgrid">
        {automations.map((a) => (
          <div key={a.id} className={`card glass ${a.enabled ? '' : 'off'}`}>
            <div className="cardtop"><Zap size={18} /><h3>{a.name}</h3>{a.riskyDevices.length > 0 && <span className="badge">risky</span>}</div>
            <p><b>{a.summary}</b>{a.conditions.length ? `, if ${a.conditions.length} condition${a.conditions.length > 1 ? 's' : ''} hold` : ''}</p>
            <ul className="assume">{a.actions.map((x, i) => <li key={i}>{describeAction(x, devices)}</li>)}</ul>
            <small className="muted">{a.enabled ? 'Enabled' : 'Disabled'} · last run: {a.lastRun ? new Date(a.lastRun).toLocaleString() : 'never'}{a.lastResult ? ` (${a.lastResult})` : ''}</small>
            {info[a.id] && <div className="infobox">{info[a.id].map((m, i) => <p key={i}>{m}</p>)}</div>}
            <div className="btnrow">
              <label className="check"><input type="checkbox" checked={a.enabled} onChange={(e) => void wrap(() => smartApi.patchAutomation(a.id, { enabled: e.target.checked }))} /> Enabled</label>
              <button onClick={() => void run(a, true)} title="Show what would happen without sending anything"><Play size={13} /> Dry run</button>
              <button onClick={() => void run(a, false)}>Run now</button>
              <button className="icon" title="Edit" onClick={() => setDraft({ id: a.id, name: a.name, trigger: a.trigger, conditions: a.conditions, actions: a.actions, enabled: a.enabled, riskAck: a.riskAck })}><Pencil size={14} /></button>
              <button className="danger icon" title="Delete" onClick={() => { if (confirm(`Delete “${a.name}”?`)) void wrap(() => smartApi.deleteAutomation(a.id)) }}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
        {!automations.length && <div className="card glass dashed"><div className="cardtop"><Zap size={18} /><h3>No automations</h3></div><p className="muted">Nothing runs automatically. Example: <i>when soil moisture falls below 25 %, turn the garden pump on</i>.</p></div>}
      </div>

      <h2 className="sect">Activity log</h2>
      <div className="glass tablewrap">
        <table>
          <thead><tr><th>Time</th><th>Rule</th><th>What happened</th></tr></thead>
          <tbody>
            {log.map((e) => (
              <tr key={e.id} className={`log ${e.level}`}><td className="mono">{new Date(e.at).toLocaleString()}</td><td>{e.automation ?? 'manual'}{e.dryRun ? ' (dry run)' : ''}</td><td>{e.message}</td></tr>
            ))}
            {!log.length && <tr><td colSpan={3} className="empty">Nothing has happened yet. Every command EDEN sends is recorded here.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function describeAction(a: Action, devices: Device[]): string {
  if (a.type === 'log') return `write “${a.message}” to the log`
  const d = devices.find((x) => x.id === a.deviceId)
  const label = SERVICES[d?.domain ?? '']?.find(([s]) => s === a.service)?.[1] ?? a.service
  return `${label} → ${d?.name ?? 'missing device'}`
}

function Editor({ draft, devices, onSave, onCancel }: { draft: Draft; devices: Device[]; onSave: (d: Draft) => void; onCancel: () => void }) {
  const [d, setD] = useState(draft)
  const byId = new Map(devices.map((x) => [x.id, x]))
  const commandable = devices.filter((x) => x.controllable)
  const risky = d.actions.filter((a) => a.type === 'device' && byId.get(a.deviceId)?.risky).map((a) => byId.get((a as { deviceId: string }).deviceId)!.name)
  const t = d.trigger
  const mode: 'to' | 'above' | 'below' | 'change' = t.type === 'state' ? (t.to !== undefined ? 'to' : t.above !== undefined ? 'above' : t.below !== undefined ? 'below' : 'change') : 'change'
  const setTrig = (x: Trigger) => setD((s) => ({ ...s, trigger: x }))
  const setMode = (m: string) => t.type === 'state' && setTrig({ type: 'state', deviceId: t.deviceId, ...(m === 'to' ? { to: '' } : m === 'above' ? { above: '' } : m === 'below' ? { below: '' } : {}) })
  const stateVal = t.type === 'state' ? (t.to ?? t.above ?? t.below ?? '') : ''
  const setVal = (v: string) => t.type === 'state' && setTrig({ type: 'state', deviceId: t.deviceId, ...(mode === 'to' ? { to: v } : mode === 'above' ? { above: v } : mode === 'below' ? { below: v } : {}) })
  const upd = <K extends 'conditions' | 'actions'>(k: K, i: number, v: Draft[K][number]) => setD((s) => ({ ...s, [k]: (s[k] as unknown[]).map((x, j) => (j === i ? v : x)) as Draft[K] }))
  const del = (k: 'conditions' | 'actions', i: number) => setD((s) => ({ ...s, [k]: (s[k] as unknown[]).filter((_, j) => j !== i) as never }))
  return (
    <div className="formcard glass">
      <h3>{d.id ? 'Edit automation' : 'New automation'}</h3>
      <label>Name<input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Water the beds when dry" /></label>

      <h4>When</h4>
      <div className="inline">
        <select value={t.type} onChange={(e) => setTrig(e.target.value === 'time' ? { type: 'time', at: '07:30' } : { type: 'state', deviceId: devices[0]?.id ?? '' })}>
          <option value="state">a device changes</option><option value="time">it is a time of day</option>
        </select>
        {t.type === 'state' && (
          <>
            <select value={t.deviceId} onChange={(e) => setTrig({ ...t, deviceId: e.target.value })}>{devices.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            <select value={mode} onChange={(e) => setMode(e.target.value)}><option value="to">becomes</option><option value="above">rises above</option><option value="below">falls below</option><option value="change">changes</option></select>
            {mode !== 'change' && <input style={{ maxWidth: 100 }} value={stateVal} placeholder={mode === 'to' ? 'on' : '25'} onChange={(e) => setVal(e.target.value)} />}
          </>
        )}
        {t.type === 'time' && <input type="time" style={{ maxWidth: 130 }} value={t.at} onChange={(e) => setTrig({ ...t, at: e.target.value })} />}
      </div>
      {t.type === 'time' && (
        <div className="inline">{DAYS.map((n, i) => <label key={n} className="check"><input type="checkbox" checked={!t.days || t.days.length === 0 || t.days.includes(i)} onChange={(e) => {
          const cur = t.days && t.days.length ? t.days : [0, 1, 2, 3, 4, 5, 6]
          const next = e.target.checked ? [...new Set([...cur, i])] : cur.filter((x) => x !== i)
          setTrig({ ...t, days: next.length === 7 ? [] : next })
        }} /> {n}</label>)}</div>
      )}
      {t.type === 'time' && <small className="muted">Time of day on the EDEN computer's clock.</small>}

      <h4>Only if (optional)</h4>
      {d.conditions.map((c, i) => (
        <div key={i} className="inline">
          {c.type === 'state' ? (
            <>
              <select value={c.deviceId} onChange={(e) => upd('conditions', i, { ...c, deviceId: e.target.value })}>{devices.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              <select value={c.op} onChange={(e) => upd('conditions', i, { ...c, op: e.target.value as 'eq' })}><option value="eq">is</option><option value="ne">is not</option><option value="gt">is above</option><option value="lt">is below</option></select>
              <input style={{ maxWidth: 100 }} value={c.value} onChange={(e) => upd('conditions', i, { ...c, value: e.target.value })} />
            </>
          ) : (
            <>
              <span>time is between</span><input type="time" style={{ maxWidth: 120 }} value={c.after} onChange={(e) => upd('conditions', i, { ...c, after: e.target.value })} />
              <span>and</span><input type="time" style={{ maxWidth: 120 }} value={c.before} onChange={(e) => upd('conditions', i, { ...c, before: e.target.value })} />
            </>
          )}
          <button className="icon danger" onClick={() => del('conditions', i)}><Trash2 size={14} /></button>
        </div>
      ))}
      <div className="btnrow">
        <button className="chip" onClick={() => setD({ ...d, conditions: [...d.conditions, { type: 'state', deviceId: devices[0]?.id ?? '', op: 'eq', value: '' }] })}>+ device condition</button>
        <button className="chip" onClick={() => setD({ ...d, conditions: [...d.conditions, { type: 'time', after: '08:00', before: '20:00' }] })}>+ time window</button>
      </div>

      <h4>Then</h4>
      {d.actions.map((a, i) => (
        <div key={i} className="inline">
          {a.type === 'device' ? (
            <>
              <select value={a.deviceId} onChange={(e) => { const dev = byId.get(e.target.value); upd('actions', i, { type: 'device', deviceId: e.target.value, service: SERVICES[dev?.domain ?? '']?.[0]?.[0] ?? 'turn_on' }) }}>
                {commandable.map((x) => <option key={x.id} value={x.id}>{x.name}{x.risky ? ' (risky)' : ''}</option>)}
              </select>
              <select value={a.service} onChange={(e) => upd('actions', i, { ...a, service: e.target.value })}>
                {(SERVICES[byId.get(a.deviceId)?.domain ?? ''] ?? []).map(([s, l]) => <option key={s} value={s}>{l}</option>)}
              </select>
            </>
          ) : <input value={a.message} placeholder="message for the log" onChange={(e) => upd('actions', i, { type: 'log', message: e.target.value })} />}
          <button className="icon danger" onClick={() => del('actions', i)}><Trash2 size={14} /></button>
        </div>
      ))}
      <div className="btnrow">
        <button className="chip" disabled={!commandable.length} onClick={() => { const dev = commandable[0]; setD({ ...d, actions: [...d.actions, { type: 'device', deviceId: dev.id, service: SERVICES[dev.domain]?.[0]?.[0] ?? 'turn_on' }] }) }}>+ control a device</button>
        <button className="chip" onClick={() => setD({ ...d, actions: [...d.actions, { type: 'log', message: '' }] })}>+ write to log</button>
      </div>

      {risky.length > 0 && (
        <div className="dangerbox">
          <b>This rule controls risky devices: {[...new Set(risky)].join(', ')}.</b>
          <label className="check"><input type="checkbox" checked={d.riskAck} onChange={(e) => setD({ ...d, riskAck: e.target.checked })} /> I understand it will operate them without asking me, and I accept the consequences if it misfires.</label>
        </div>
      )}
      <label className="check"><input type="checkbox" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} /> Enabled (leave off to save a draft and try a dry run first)</label>
      <div className="btnrow end"><button onClick={onCancel}>Cancel</button><button className="primary" disabled={!d.name.trim()} onClick={() => onSave(d)}>Save automation</button></div>
    </div>
  )
}
