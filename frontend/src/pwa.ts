// Installing EDEN as an app and using it offline: registers the service worker (public/sw.js), keeps the browser's
// "install" offer for the Settings page, and tracks whether the server can be reached.
import { create } from 'zustand'

interface InstallEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface PwaState {
  online: boolean // the browser's own idea of whether it has a network
  installed: boolean // running as an installed app (standalone window)
  canPrompt: boolean // the browser offered an install button
  secure: boolean // service workers (and so install and offline) need https or localhost
  workerReady: boolean
  workerError: string // why the offline copy could not be prepared (an untrusted https certificate is the usual reason)
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>
}

let deferred: InstallEvent | null = null

export const isStandalone = (): boolean =>
  typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true)

export const usePwa = create<PwaState>((set) => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  installed: isStandalone(),
  canPrompt: false,
  secure: typeof window === 'undefined' ? true : window.isSecureContext,
  workerReady: false,
  workerError: '',
  install: async () => {
    if (!deferred) return 'unavailable'
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    deferred = null
    set({ canPrompt: false, installed: outcome === 'accepted' })
    return outcome
  },
}))

/** Tell the service worker to forget the saved data and map tiles (on sign-out, so a shared device keeps nothing). */
export function forgetOfflineData(): void {
  try { navigator.serviceWorker?.controller?.postMessage('clear-user-data') } catch { /* no worker: nothing saved */ }
}

export function startPwa(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('online', () => usePwa.setState({ online: true }))
  window.addEventListener('offline', () => usePwa.setState({ online: false }))
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // keep the offer for the Settings page instead of the browser's own mini bar
    deferred = e as InstallEvent
    usePwa.setState({ canPrompt: true })
  })
  window.addEventListener('appinstalled', () => { deferred = null; usePwa.setState({ installed: true, canPrompt: false }) })
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', (e) => usePwa.setState({ installed: e.matches }))
  if ('serviceWorker' in navigator && window.isSecureContext && import.meta.env.PROD) {
    const wasControlled = !!navigator.serviceWorker.controller
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then(async () => {
        usePwa.setState({ workerReady: true })
        if (!wasControlled) await warmCache() // first visit: the data loaded before the worker took over was not kept, so ask for it again
      }).catch((e: Error) => usePwa.setState({ workerError: e?.message || 'registration failed' }))
    })
  }
}

/** Re-request the read-only data this page already loaded, so the worker keeps an answer for each (used once, on the first visit). */
async function warmCache(): Promise<void> {
  if (!navigator.serviceWorker.controller) await new Promise<void>((res) => { navigator.serviceWorker.addEventListener('controllerchange', () => res(), { once: true }); setTimeout(res, 3000) })
  const urls = [...new Set(performance.getEntriesByType('resource').map((e) => new URL(e.name, location.href)).filter((u) => u.origin === location.origin && u.pathname.startsWith('/api/')).map((u) => u.pathname + u.search))]
  await Promise.all(urls.slice(0, 40).map((u) => fetch(u).catch(() => undefined)))
}
