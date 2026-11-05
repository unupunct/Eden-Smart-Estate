import { api } from '../api/client'

export type PushSupport = { ok: true } | { ok: false; reason: string }

export function pushSupport(): PushSupport {
  if (!window.isSecureContext) return { ok: false, reason: 'Browsers only allow notifications on https:// pages or on localhost. Start EDEN with -Https, or open it on this computer as http://127.0.0.1:8787.' }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { ok: false, reason: 'This browser does not support push notifications.' }
  return { ok: true }
}

function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function registration() {
  const reg = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  return reg
}

/** The subscription of this browser, if any. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupport().ok) return null
  const reg = await navigator.serviceWorker.getRegistration('/sw.js')
  return reg ? reg.pushManager.getSubscription() : null
}

export function deviceLabel(): string {
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''
  return `${browser}${os ? ' on ' + os : ''}`
}

const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export async function enablePush(): Promise<void> {
  const s = pushSupport()
  if (!s.ok) throw new Error(s.reason)
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Notifications were not allowed. Allow them for this site in the browser’s address-bar menu, then try again.')
  const reg = await registration()
  const { publicKey } = await api.pushStatus()
  let sub = await reg.pushManager.getSubscription()
  if (sub) {
    // a subscription made with another server key cannot be reused
    const cur = sub.options.applicationServerKey
    if (cur && b64url(cur) !== publicKey) { await sub.unsubscribe(); sub = null }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
  const j = sub.toJSON()
  if (!j.endpoint || !j.keys?.p256dh || !j.keys.auth) throw new Error('The browser returned an incomplete subscription.')
  await api.pushSubscribe({ endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } }, deviceLabel())
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await api.pushUnsubscribe(sub.endpoint)
  await sub.unsubscribe()
}
