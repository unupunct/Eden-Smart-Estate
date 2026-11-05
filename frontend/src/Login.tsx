import { useState } from 'react'
import { Home } from 'lucide-react'

export function LoginScreen({ onDone }: { onDone: () => void }) {
  const [user, setUser] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: pw }) })
      if (r.ok) return onDone()
      const body = await r.json().catch(() => ({}))
      setErr(typeof body.detail === 'string' ? body.detail : 'Could not sign in.')
    } catch {
      setErr('Cannot reach the EDEN server.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="emptystate">
      <form className="formcard glass loginbox" onSubmit={(e) => void submit(e)}>
        <span className="logo"><Home size={18} /></span>
        <h1>EDEN Smart Estate</h1>
        <p className="muted">This estate is password protected.</p>
        <label>User name<input autoFocus autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {err && <p className="warn" role="alert">{err}</p>}
        <button className="primary wide" disabled={busy || !pw || !user.trim()}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  )
}
