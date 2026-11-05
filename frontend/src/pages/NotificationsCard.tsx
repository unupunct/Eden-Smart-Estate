import { useCallback, useEffect, useState } from 'react'
import { Bell, BellOff, Send } from 'lucide-react'
import { api, type PushStatus } from '../api/client'
import { currentSubscription, disablePush, enablePush, pushSupport } from '../manage/push'

/** Settings → Push notifications. */
export function NotificationsCard() {
  const [st, setSt] = useState<PushStatus | null>(null)
  const [here, setHere] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const support = pushSupport()

  const refresh = useCallback(async () => {
    setSt(await api.pushStatus())
    setHere(!!(await currentSubscription()))
  }, [])
  useEffect(() => { void refresh().catch((e) => setErr((e as Error).message)) }, [refresh])

  const run = async (fn: () => Promise<string | void>) => {
    setErr(''); setMsg(''); setBusy(true)
    try {
      const m = await fn()
      if (m) setMsg(m)
      await refresh()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (!st) return null
  return (
    <section className="glass formcard" aria-labelledby="push-h">
      <h2 id="push-h">Push notifications</h2>
      <p className="note">EDEN can notify this device about due and overdue tasks and about automations you set to “send a notification”, even when the EDEN tab is closed. Messages are encrypted for your browser and travel through your browser maker’s push service (Google, Mozilla, Microsoft or Apple), which sees that a message was sent but not its text. EDEN’s computer must be on and online. Nothing is sent until you turn this on.</p>
      {msg && <div className="notice ok" role="status">{msg}</div>}
      {err && <div className="notice err" role="alert">{err}</div>}
      {!support.ok && <div className="notice">{support.reason}</div>}
      <div className="btnrow">
        {here
          ? <button disabled={busy} onClick={() => void run(async () => { await disablePush(); return 'Notifications are off on this device.' })}><BellOff size={14} /> Turn off on this device</button>
          : <button className="primary" disabled={busy || !support.ok} onClick={() => void run(async () => { await enablePush(); return 'Notifications are on for this device.' })}><Bell size={14} /> Turn on notifications on this device</button>}
        <button disabled={busy || !st.subscriptions.length} onClick={() => void run(async () => {
          const r = await api.pushTest()
          return r.sent ? `Test sent to ${r.sent} device(s).` : `Not delivered: ${r.results.map((x) => x.message).join('; ') || 'no device accepted it'}.`
        })}><Send size={14} /> Send a test notification</button>
      </div>
      <label className="check"><input type="checkbox" checked={st.digest} onChange={(e) => void run(async () => { setSt(await api.pushSettings({ digest: e.target.checked })) })} /> Send a daily digest of overdue and due-today tasks</label>
      <label>Digest time (this computer’s clock)
        <select value={st.hour} disabled={!st.digest} onChange={(e) => void run(async () => { setSt(await api.pushSettings({ hour: Number(e.target.value) })) })}>
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
        </select>
      </label>
      <h3>Subscribed devices</h3>
      {!st.subscriptions.length ? <p className="note">None yet.</p> : (
        <ul className="plain">
          {st.subscriptions.map((s) => (
            <li key={s.id} className="inline">
              <span><strong>{s.label || 'Browser'}</strong> · since {new Date(s.createdAt).toLocaleDateString()}{s.lastOk ? ` · last delivered ${new Date(s.lastOk).toLocaleString()}` : ' · nothing delivered yet'}{s.failures ? ` · ${s.failures} failed attempt(s)` : ''}</span>
              <button className="danger" disabled={busy} onClick={() => void run(async () => { await api.pushRemove(s.id) })}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
