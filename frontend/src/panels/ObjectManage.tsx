import { useRef, useState } from 'react'
import { Check, Paperclip } from 'lucide-react'
import { manageApi } from '../api/client'
import { dueLabel, lastDone, urgency } from '../manage/logic'
import { useManage } from '../manage/store'
import { useApp } from '../model/app'

/** Tasks and attachments of one map object, inside its properties panel. */
export function ObjectManage({ objectId, propertyId }: { objectId: string; propertyId: string }) {
  const { tasks, history, documents } = useManage()
  const load = useManage((s) => s.load)
  const go = useApp((s) => s.go)
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [err, setErr] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const mine = tasks.filter((t) => t.objectId === objectId && t.status === 'open')
  const docs = documents.filter((d) => d.objectId === objectId)
  const last = lastDone(history, objectId)
  const wrap = async (f: () => Promise<unknown>) => {
    setErr('')
    try {
      await f()
      await load(propertyId)
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <div>
      <h4>Tasks &amp; maintenance</h4>
      {last && <small className="muted">Last maintained {last}</small>}
      <ul className="objlist">
        {mine.map((t) => (
          <li key={t.id} className={`mini u-${urgency(t)}`}>
            <button className="chip tick" title="Mark as done" onClick={() => void wrap(() => manageApi.completeTask(t.id))}><Check size={12} /></button>
            <span>{t.title}</span> <small className="muted">{dueLabel(t)}</small>
          </li>
        ))}
        {!mine.length && <li className="empty">No open tasks for this object.</li>}
      </ul>
      <div className="inline">
        <input placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) document.getElementById('obj-add-task')?.click() }} />
        <input type="date" style={{ maxWidth: 130 }} value={due} onChange={(e) => setDue(e.target.value)} />
        <button id="obj-add-task" disabled={!title.trim()} onClick={() => void wrap(async () => { await manageApi.addTask({ propertyId, title, due: due || null, objectId }); setTitle(''); setDue('') })}>Add</button>
      </div>
      <h4>Attachments</h4>
      <div className="thumbs">
        {docs.map((d) => (d.isImage ? <a key={d.id} href={d.url} target="_blank" rel="noreferrer" title={d.title}><img src={d.url} alt={d.title} /></a> : <a key={d.id} className="filechip" href={`${d.url}?download=true`} title={d.originalName}>{d.title}</a>))}
        {!docs.length && <small className="muted">No photos or documents attached.</small>}
      </div>
      <div className="btnrow" style={{ margin: '6px 0' }}>
        <button className="chip" onClick={() => file.current?.click()}><Paperclip size={13} /> Attach file</button>
        <button className="linklike" onClick={() => go('notes')}>All documents</button>
        <input ref={file} type="file" hidden multiple accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.csv,.md,.docx,.xlsx,.odt,.ods" onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; void wrap(async () => { for (const f of fs) await manageApi.upload(propertyId, f, { objectId }) }) }} />
      </div>
      {err && <p className="warn">{err}</p>}
    </div>
  )
}
