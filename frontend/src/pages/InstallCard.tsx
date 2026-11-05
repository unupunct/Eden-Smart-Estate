import { useState } from 'react'
import { Smartphone, WifiOff } from 'lucide-react'
import { usePwa } from '../pwa'

/** Shown above everything when the browser has no network: what still works and what does not. */
export function OfflineBanner() {
  const online = usePwa((s) => s.online)
  if (online) return null
  return (
    <div className="offlinebar" role="status">
      <WifiOff size={14} /> No connection. You can read what was loaded before; edits stay on this page and are saved when the connection returns, so keep this page open.
    </div>
  )
}

const ios = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)

export function InstallCard() {
  const s = usePwa()
  const [msg, setMsg] = useState('')
  const run = async () => {
    const r = await s.install()
    setMsg(r === 'accepted' ? 'Installed. Look for EDEN in your apps.' : r === 'dismissed' ? 'Not installed.' : 'This browser did not offer an install button; see the steps below.')
  }
  return (
    <section className="glass formcard" id="install-app">
      <h2><Smartphone size={16} /> Install as an app and use offline</h2>
      <p className="note">
        EDEN can be installed on a phone, tablet or computer so it opens in its own window with its own icon. Once opened with a connection, it also opens without one and
        shows what it last loaded: your property, plants, tasks and the map tiles you looked at. Controlling devices, camera pictures, weather and anything that
        needs the EDEN server still need a connection. Saved data is kept only in this browser and is wiped when you sign out.
      </p>
      {s.installed ? (
        <p className="ok">EDEN is running as an installed app on this device.</p>
      ) : !s.secure ? (
        <p className="warn">
          Browsers only allow installing and offline use over <strong>https</strong> with a certificate the device trusts (or on this same computer at <code>localhost</code>).
          This page is plain http on the network, so it can only be used in the browser. See the Install guide, “Install on a phone or tablet as an app”.
        </p>
      ) : (
        <div className="btnrow">
          {s.canPrompt && <button className="btn" onClick={() => void run()}><Smartphone size={14} /> Install EDEN</button>}
          {msg && <span className="note">{msg}</span>}
        </div>
      )}
      {s.secure && s.workerError && (
        <p className="warn" role="alert">
          The offline copy could not be prepared ({s.workerError}). Over https this usually means the browser does not trust the certificate: EDEN’s own certificate is self-signed, so
          the device must trust it first (see the Install guide) or EDEN must sit behind a real certificate. At <code>localhost</code> it works without.
        </p>
      )}
      {!s.installed && s.secure && !s.canPrompt && (
        <ul className="note">
          {ios ? <li>iPhone / iPad: open this page in Safari, tap <em>Share</em>, then <em>Add to Home Screen</em>.</li>
            : <li>Chrome / Edge: open the browser menu and choose <em>Install EDEN</em> (or the install icon in the address bar). Android: menu → <em>Install app</em>.</li>}
          <li>Status: {s.workerReady ? 'offline copy is ready on this device.' : 'the offline copy is prepared after the first full load; reload once if it does not show here.'}</li>
        </ul>
      )}
    </section>
  )
}
