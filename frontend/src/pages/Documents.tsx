import { useRef, useState } from 'react'
import { FileText, Image as ImageIcon, Paperclip, Search, Trash2, Upload } from 'lucide-react'
import { manageApi } from '../api/client'
import { fmtSize, useManage } from '../manage/store'
import type { DocumentInfo } from '../manage/types'
import { useApp } from '../model/app'
import { kindDef } from '../model/kinds'
import { useEditor } from '../model/store'
import { useManageLoad } from './Tasks'

export function DocumentsPage() {
  const pid = useManageLoad()
  const { documents, loaded, error } = useManage()
  const load = useManage((s) => s.load)
  const objects = useEditor((s) => s.doc.objects)
  const property = useEditor((s) => s.property)
  const focus = useEditor((s) => s.requestFocus)
  const go = useApp((s) => s.go)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'all' | 'photo' | 'document'>('all')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState<DocumentInfo | null>(null)
  const [view, setView] = useState<DocumentInfo | null>(null)
  const [objectId, setObjectId] = useState('')
  const input = useRef<HTMLInputElement>(null)
  if (!property || !pid) return <div className="emptystate"><h2>No property open</h2><p>Open or create a property first.</p></div>

  const notes = Object.values(objects).filter((o) => o.kind === 'note')
  const needle = q.trim().toLowerCase()
  const objName = (id: string | null) => (id ? objects[id]?.name || (objects[id] ? kindDef(objects[id].kind).label : '(removed object)') : 'whole property')
  const shown = documents.filter((d) => (kind === 'all' || (kind === 'photo') === d.isImage)
    && (!needle || [d.title, d.originalName, d.note, d.tags.join(' '), objName(d.objectId)].join(' ').toLowerCase().includes(needle)))
  const linkable = Object.values(objects).filter((o) => o.kind !== 'boundary').sort((a, b) => (a.name || a.kind).localeCompare(b.name || b.kind))

  const send = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    setErr('')
    for (const f of Array.from(files)) {
      try {
        await manageApi.upload(pid, f, { objectId })
      } catch (e) {
        setErr(`${f.name}: ${(e as Error).message}`)
      }
    }
    setBusy(false)
    await load(pid)
  }

  return (
    <div className="page">
      <div className="pagehead">
        <div><h1>Notes &amp; Documents</h1><p>Photos, manuals, warranties, plans and receipts, attached to the property or to a specific tree, bed, building or device. Files stay in the data folder on this computer and are part of every backup.</p></div>
        <span className="badge">Phase 6</span>
      </div>
      {error && <div className="notice err">{error}</div>}
      {err && <div className="notice err">{err}</div>}
      <div className="filters">
        <label style={{ flex: 2 }}>Search<div className="search" style={{ margin: 0 }}><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="title, tag, note, file name, object…" /></div></label>
        <label>Show<select value={kind} onChange={(e) => setKind(e.target.value as 'all')}><option value="all">Photos and documents</option><option value="photo">Photos only</option><option value="document">Documents only</option></select></label>
        <label>Attach new files to<select value={objectId} onChange={(e) => setObjectId(e.target.value)}><option value="">the whole property</option>{linkable.map((o) => <option key={o.id} value={o.id}>{o.name || kindDef(o.kind).label} ({kindDef(o.kind).label})</option>)}</select></label>
        <button className="primary" disabled={busy} onClick={() => input.current?.click()}><Upload size={14} /> {busy ? 'Uploading…' : 'Add files'}</button>
        <input ref={input} type="file" multiple hidden accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.csv,.md,.docx,.xlsx,.odt,.ods" onChange={(e) => { void send(e.target.files); e.target.value = '' }} />
      </div>
      <div className="docgrid">
        {shown.map((d) => (
          <div key={d.id} className="doccard glass">
            {d.isImage ? <button className="thumb" onClick={() => setView(d)}><img src={d.url} alt={d.title} loading="lazy" /></button> : <a className="thumb file" href={d.url} target="_blank" rel="noreferrer"><FileText size={34} /><small>{d.originalName.split('.').pop()?.toUpperCase()}</small></a>}
            <div className="dbody">
              <b>{d.title}</b>
              <small className="muted">{d.takenAt ?? d.createdAt.slice(0, 10)} · {fmtSize(d.size)} · {d.objectId ? <button className="linklike" onClick={() => { focus(d.objectId!); go('editor') }}>{objName(d.objectId)}</button> : 'whole property'}</small>
              {d.tags.length > 0 && <div>{d.tags.map((t) => <span key={t} className="pill">{t}</span>)}</div>}
              {d.note && <small className="muted">{d.note}</small>}
              <div className="btnrow" style={{ margin: '4px 0 0' }}>
                <button className="chip" onClick={() => setEdit(d)}>Edit</button>
                <a className="btn chip" href={`${d.url}?download=true`}>Download</a>
                <button className="icon danger" title="Delete" onClick={() => { if (confirm(`Delete “${d.title}” and its file permanently?`)) void manageApi.deleteDocument(d.id).then(() => load(pid)).catch((e) => setErr((e as Error).message)) }}><Trash2 size={14} /></button>
              </div>
            </div>
          </div>
        ))}
        {!shown.length && loaded && <div className="card glass dashed"><div className="cardtop"><Paperclip size={18} /><h3>{documents.length ? 'Nothing matches' : 'No files yet'}</h3></div><p className="muted">{documents.length ? 'Try a different search.' : 'Add photos of trees and beds over the seasons, the greenhouse manual, a pump warranty, a permit…'}</p></div>}
      </div>
      <small className="muted">Allowed: JPG, PNG, WebP, GIF, PDF, TXT, CSV, MD, DOCX, XLSX, ODT, ODS, up to 40 MB each. Photos keep their own metadata (including GPS position, if the camera recorded it): remove it before sharing a backup or file.</small>

      <h2 className="sect">Map notes</h2>
      <p className="muted">Notes pinned on the map in the Property Editor. Every object also has its own notes field.</p>
      <ul className="objlist">
        {notes.map((o) => <li key={o.id}><ImageIcon size={0} /><span className="swatch" style={{ background: kindDef('note').color }} /> <b>{o.name || 'Note'}</b> <small className="muted">{String(o.props.description ?? o.props.text ?? '').slice(0, 140)}</small> <button className="linklike" onClick={() => { focus(o.id); go('editor') }}>show on map</button></li>)}
        {!notes.length && <li className="empty">No notes on the map yet.</li>}
      </ul>
      {edit && <EditDoc d={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(pid) }} />}
      {view && <div className="modal-back" onClick={() => setView(null)}><div className="fullcam" onClick={(e) => e.stopPropagation()}><div className="camhead"><b>{view.title}</b></div><img src={view.url} alt={view.title} style={{ width: '100%', maxHeight: '80vh', objectFit: 'contain', background: '#05080a' }} /></div></div>}
    </div>
  )
}

function EditDoc({ d, onClose, onSaved }: { d: DocumentInfo; onClose: () => void; onSaved: () => void }) {
  const objects = useEditor((s) => s.doc.objects)
  const [f, setF] = useState({ title: d.title, tags: d.tags.join(', '), note: d.note, objectId: d.objectId ?? '', takenAt: d.takenAt ?? '' })
  const [err, setErr] = useState('')
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }))
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal glass" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Edit {d.originalName}</h3></div>
        <label>Title<input value={f.title} onChange={(e) => set('title', e.target.value)} /></label>
        <label>Tags (comma separated)<input value={f.tags} onChange={(e) => set('tags', e.target.value)} /></label>
        <div className="two">
          <label>Date (photo taken / document dated)<input type="date" value={f.takenAt} onChange={(e) => set('takenAt', e.target.value)} /></label>
          <label>About<select value={f.objectId} onChange={(e) => set('objectId', e.target.value)}><option value="">the whole property</option>{Object.values(objects).filter((o) => o.kind !== 'boundary').map((o) => <option key={o.id} value={o.id}>{o.name || kindDef(o.kind).label}</option>)}</select></label>
        </div>
        <label>Note<textarea rows={3} value={f.note} onChange={(e) => set('note', e.target.value)} /></label>
        {err && <p className="warn">{err}</p>}
        <div className="btnrow end"><button onClick={onClose}>Cancel</button><button className="primary" disabled={!f.title.trim()} onClick={() => void manageApi.patchDocument(d.id, { title: f.title, tags: f.tags, note: f.note, objectId: f.objectId || null, takenAt: f.takenAt || null }).then(onSaved).catch((e) => setErr((e as Error).message))}>Save</button></div>
      </div>
    </div>
  )
}
