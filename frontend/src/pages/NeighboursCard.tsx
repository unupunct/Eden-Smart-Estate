import { useState } from 'react'
import { useEditor } from '../model/store'
import { BASIS_TEXT, NEIGHBOUR_LAYER_NAME, newNeighbours, searchNeighbours, toObjects, type NeighbourReply } from '../neighbours/neighbours'

/** Sun page: find the buildings next door (OpenStreetMap) so their shade counts. Asks before sending anything, adds nothing without a click. */
export function NeighboursCard({ propertyId }: { propertyId: string }) {
  const doc = useEditor((s) => s.doc)
  const [radius, setRadius] = useState(120)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reply, setReply] = useState<NeighbourReply | null>(null)
  const [done, setDone] = useState('')
  const count = Object.values(doc.objects).filter((o) => o.kind === 'neighbour').length

  const find = async () => {
    setBusy(true); setError(''); setDone('')
    try { setReply(await searchNeighbours(propertyId, radius)) } catch (e) { setReply(null); setError((e as Error).message) } finally { setBusy(false) }
  }
  const sorted = reply ? newNeighbours(doc, reply.buildings) : null
  const add = () => {
    if (!sorted || !sorted.fresh.length) return
    const st = useEditor.getState()
    let layer = st.doc.layers.find((l) => l.name === NEIGHBOUR_LAYER_NAME)
    if (!layer) {
      st.addLayer(NEIGHBOUR_LAYER_NAME, 'Estate')
      layer = useEditor.getState().doc.layers.find((l) => l.name === NEIGHBOUR_LAYER_NAME)
    }
    if (!layer) { setError('Could not create the layer.'); return }
    useEditor.getState().addObjects(toObjects(useEditor.getState().doc.layers, layer.id, sorted.fresh), false)
    setDone(`${sorted.fresh.length} neighbouring buildings added on the layer “${NEIGHBOUR_LAYER_NAME}”. Hide or delete the layer any time.`)
    setReply(null)
  }
  const basis = sorted ? (['tag', 'floors', 'assumed'] as const).map((b) => [b, sorted.fresh.filter((c) => c.heightBasis === b).length] as const).filter(([, n]) => n > 0) : []

  return (
    <>
      <h4>Neighbouring buildings</h4>
      <p className="note">
        A neighbour’s house can shade your garden. EDEN can look up the building outlines around the property from OpenStreetMap, so their shade counts in the sun hours.
        Pressing the button sends the property’s location, rounded to about 100 m, and the search radius to a public OpenStreetMap (Overpass) server. Nothing is added until you confirm.
        {count > 0 && <> You have {count} neighbouring {count === 1 ? 'building' : 'buildings'} on the map.</>}
      </p>
      <label className="check">Search radius{' '}
        <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Search radius">
          {[60, 120, 200, 300].map((r) => <option key={r} value={r}>{r} m</option>)}
        </select>
      </label>
      <div className="btnrow"><button onClick={() => void find()} disabled={busy}>{busy ? 'Looking…' : 'Find neighbouring buildings'}</button></div>
      {error && <p className="warn" role="alert">{error}</p>}
      {done && <p className="ok" role="status">{done}</p>}
      {reply && sorted && (
        <div className="infobox">
          <b>{sorted.fresh.length} to add</b>
          <ul>
            <li>Found {reply.buildings.length} building outlines within {reply.radiusM} m ({reply.sent}).</li>
            {sorted.own > 0 && <li>{sorted.own} on your own land: left out.</li>}
            {sorted.already > 0 && <li>{sorted.already} you already have: left out.</li>}
            {basis.map(([b, n]) => <li key={b}>{n} with height {BASIS_TEXT[b]}.</li>)}
          </ul>
          <small className="muted">OpenStreetMap is made by volunteers: outlines are usually good, heights often are not there. Heights marked “assumed” are a plain guess for the building type: look at them and correct the ones next to your garden (select a building, then change <em>Height</em> and <em>Roof type</em>). {reply.source.attribution}.</small>
          <div className="btnrow">
            <button className="btn" onClick={add} disabled={!sorted.fresh.length}>Add {sorted.fresh.length} to the map</button>
            <button className="chip" onClick={() => setReply(null)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  )
}
