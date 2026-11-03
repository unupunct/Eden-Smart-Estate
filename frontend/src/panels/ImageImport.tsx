import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../api/client'
import { destination, similarityCorners, worldFileCorners } from '../geo/calibrate'
import { mapRef } from '../map/controller'
import { useApp } from '../model/app'
import { useEditor } from '../model/store'
import type { Pos } from '../model/types'

type Mode = 'points' | 'distance' | 'world'

/** Modal: choose an image, pick control points on it, then hand over to the map to place it. */
export function ImageImportDialog() {
  const setDialog = useApp((s) => s.setDialog)
  const property = useEditor((s) => s.property)
  const setOverlays = useEditor((s) => s.setOverlays)
  const setCal = useEditor((s) => s.setCalibration)
  const setTool = useEditor((s) => s.setTool)
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [dims, setDims] = useState<[number, number]>([0, 0])
  const [mode, setMode] = useState<Mode>('points')
  const [pts, setPts] = useState<[number, number][]>([])
  const [dist, setDist] = useState(50)
  const [brg, setBrg] = useState(90)
  const [world, setWorld] = useState('')
  const [crs, setCrs] = useState<'EPSG:4326' | 'EPSG:3857'>('EPSG:4326')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const img = useRef<HTMLImageElement>(null)
  useEffect(() => () => undefined, [])

  const need = mode === 'distance' ? 2 : 2
  const choose = (f: File | undefined) => {
    if (!f) return
    setErr('')
    setPts([])
    setFile(f)
    setUrl(URL.createObjectURL(f))
  }
  const click = (e: React.MouseEvent<HTMLImageElement>) => {
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    const p: [number, number] = [((e.clientX - r.left) / r.width) * el.naturalWidth, ((e.clientY - r.top) / r.height) * el.naturalHeight]
    setPts((cur) => (cur.length >= need ? [p] : [...cur, p]))
  }

  const placeOnMap = () => {
    if (!file) return
    setCal({ file, imageUrl: url, name: file.name, width: dims[0], height: dims[1], imgPts: pts, geoPts: [], phase: 'pick-map', mode: mode === 'distance' ? 'distance' : 'points', distanceM: dist, bearingDeg: brg })
    setTool({ type: 'calibrate' })
    setDialog(null)
  }

  const importWorld = async () => {
    if (!file || !property) return
    setBusy(true)
    setErr('')
    try {
      const corners = worldFileCorners(world, dims[0], dims[1], crs)
      const ov = await api.addOverlay(property.id, file, corners, file.name, { method: 'worldfile', crs })
      setOverlays([...useEditor.getState().overlays, ov])
      const lngs = corners.map((c) => c[0]), lats = corners.map((c) => c[1])
      mapRef.current?.map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 60 })
      setDialog(null)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const ready = mode === 'world' ? !!world.trim() : pts.length >= 2 && (mode === 'points' || (dist > 0 && Number.isFinite(brg)))
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setDialog(null)}>
      <div className="modal glass wide">
        <div className="modal-head"><h3>Import and calibrate an image</h3><button className="icon" onClick={() => setDialog(null)}><X size={16} /></button></div>
        <p className="note">The image is stored in your local data folder and placed on the map using real coordinates. It is never uploaded anywhere else.</p>
        <label>Image (PNG, JPEG or WebP)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => choose(e.target.files?.[0])} /></label>
        {file && (
          <>
            <div className="seg full">
              <button className={mode === 'points' ? 'on' : ''} onClick={() => setMode('points')}>Two known points</button>
              <button className={mode === 'distance' ? 'on' : ''} onClick={() => setMode('distance')}>Known distance</button>
              <button className={mode === 'world' ? 'on' : ''} onClick={() => setMode('world')}>World file</button>
            </div>
            {mode !== 'world' && (
              <>
                <p className="note">
                  {mode === 'points'
                    ? 'Click two recognisable points on the picture (for example two house corners). Next you will click the same two spots on the map.'
                    : 'Click two points on the picture whose real distance you know, enter that distance and the compass bearing from point 1 to 2 (0° = north, 90° = east). Next you click where point 1 is on the map.'}
                </p>
                <div className="calimg">
                  <img ref={img} src={url} alt="to calibrate" onClick={click} onLoad={(e) => setDims([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])} />
                  {pts.map((p, i) => dims[0] > 0 && <span key={i} className="calpin" style={{ left: `${(p[0] / dims[0]) * 100}%`, top: `${(p[1] / dims[1]) * 100}%` }}>{i + 1}</span>)}
                </div>
                {mode === 'distance' && (
                  <div className="two">
                    <label>Distance between points (m)<input type="number" min={0.1} value={dist} onChange={(e) => setDist(Number(e.target.value))} /></label>
                    <label>Bearing 1 → 2 (°)<input type="number" min={0} max={360} value={brg} onChange={(e) => setBrg(Number(e.target.value))} /></label>
                  </div>
                )}
              </>
            )}
            {mode === 'world' && (
              <>
                <p className="note">A world file (.jgw, .pgw, .wld) holds the geographic placement of a picture. Paste its six lines here.</p>
                <textarea rows={6} className="mono" placeholder={'0.0000010\n0\n0\n-0.0000010\n24.2300\n45.7100'} value={world} onChange={(e) => setWorld(e.target.value)} />
                <label>Coordinate system
                  <select value={crs} onChange={(e) => setCrs(e.target.value as typeof crs)}>
                    <option value="EPSG:4326">EPSG:4326 — longitude / latitude (degrees)</option>
                    <option value="EPSG:3857">EPSG:3857 — Web Mercator (metres)</option>
                  </select>
                </label>
                <input type="file" accept=".jgw,.pgw,.wld,.txt" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setWorld(await f.text()) }} />
                <img src={url} alt="" hidden onLoad={(e) => setDims([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])} />
              </>
            )}
          </>
        )}
        {err && <div className="notice err">{err}</div>}
        <div className="btnrow end">
          <button onClick={() => setDialog(null)}>Cancel</button>
          {mode === 'world' ? <button className="primary" disabled={!file || !ready || busy} onClick={importWorld}>Place image</button>
            : <button className="primary" disabled={!ready} onClick={placeOnMap}>Next: pick on the map</button>}
        </div>
      </div>
    </div>
  )
}

/** Always mounted in the editor: finishes calibration as soon as the map clicks arrive. */
export function CalibrationFinisher() {
  const cal = useEditor((s) => s.calibration)
  const property = useEditor((s) => s.property)
  const setCal = useEditor((s) => s.setCalibration)
  const setTool = useEditor((s) => s.setTool)
  const setOverlays = useEditor((s) => s.setOverlays)
  const notify = useEditor((s) => s.notify)
  const busy = useRef(false)
  useEffect(() => {
    if (!cal || cal.phase !== 'pick-map' || !property || busy.current) return
    const needed = cal.mode === 'distance' ? 1 : 2
    if (cal.geoPts.length < needed) return
    busy.current = true
    const geo: Pos[] = cal.mode === 'distance' ? [cal.geoPts[0], destination(cal.geoPts[0], cal.bearingDeg, cal.distanceM)] : cal.geoPts
    // for 'distance' mode the real distance belongs to the picked image points: scale is derived from it
    ;(async () => {
      try {
        const corners = similarityCorners(cal.imgPts, geo, cal.width, cal.height)
        const ov = await api.addOverlay(property.id, cal.file, corners, cal.name, { method: cal.mode, imgPts: cal.imgPts, geoPts: geo })
        setOverlays([...useEditor.getState().overlays, ov])
        const lngs = corners.map((c) => c[0]), lats = corners.map((c) => c[1])
        mapRef.current?.map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 80 })
        notify('Image placed. Adjust its opacity in the Images tab.')
      } catch (e) {
        notify(`Could not place image: ${(e as Error).message}`)
      } finally {
        URL.revokeObjectURL(cal.imageUrl)
        setCal(null)
        setTool({ type: 'select' })
        busy.current = false
      }
    })()
  }, [cal, property, setCal, setTool, setOverlays, notify])
  return null
}
