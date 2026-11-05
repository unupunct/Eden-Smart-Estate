import { useEffect, useState } from 'react'
import { api, type AuthStatus } from '../api/client'

/** Settings → Account: create the one admin account, or change its password. */
export function AccountCard() {
  const [st, setSt] = useState<AuthStatus | null>(null)
  const [f, setF] = useState({ username: 'admin', password: '', again: '', current: '' })
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.authStatus().then(setSt).catch(() => undefined) }, [])
  if (!st) return null

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setErr(''); setMsg(''); setBusy(true)
    try {
      await fn()
      setMsg(ok)
      setSt(await api.authStatus())
      setF((x) => ({ ...x, password: '', again: '', current: '' }))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const mismatch = f.again !== '' && f.again !== f.password

  if (!st.required) {
    return (
      <section className="glass formcard" aria-labelledby="acct-h">
        <h2 id="acct-h">Admin account</h2>
        <p className="note">EDEN is open: anyone who can reach this computer’s port can use it. Create the admin account to require a user name and password. There is exactly one account; it can change devices, cameras and everything else. Other browsers will have to sign in.</p>
        {msg && <div className="notice ok" role="status">{msg}</div>}
        {err && <div className="notice err" role="alert">{err}</div>}
        {!st.setupAvailable ? <div className="notice">The account can only be created from the computer EDEN runs on.</div> : (
          <form onSubmit={(e) => { e.preventDefault(); if (!mismatch) void run(() => api.authSetup(f.username, f.password), 'Admin account created. This browser is signed in.') }}>
            <label>User name<input autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></label>
            <label>Password (at least 10 characters)<input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
            <label>Repeat the password<input type="password" autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} /></label>
            {mismatch && <p className="warn" role="alert">The two passwords differ.</p>}
            <button className="primary" disabled={busy || mismatch || !f.password || !f.username.trim()}>Create admin account</button>
          </form>
        )}
        <p className="note">The password is stored only as a salted hash. If you forget it, <code>scripts\reset-admin.ps1</code> on this computer sets a new one; your data is not affected.</p>
      </section>
    )
  }

  return (
    <section className="glass formcard" aria-labelledby="acct-h">
      <h2 id="acct-h">Admin account</h2>
      <p className="note">Signed in as <strong>{st.username}</strong>. Changing the password signs every other browser out.</p>
      {msg && <div className="notice ok" role="status">{msg}</div>}
      {err && <div className="notice err" role="alert">{err}</div>}
      <form onSubmit={(e) => { e.preventDefault(); if (!mismatch) void run(() => api.authPassword(f.current, f.password), 'Password changed. Other browsers were signed out.') }}>
        <label>Current password<input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></label>
        <label>New password (at least 10 characters)<input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        <label>Repeat the new password<input type="password" autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} /></label>
        {mismatch && <p className="warn" role="alert">The two passwords differ.</p>}
        <button className="primary" disabled={busy || mismatch || !f.current || !f.password}>Change password</button>
      </form>
    </section>
  )
}
