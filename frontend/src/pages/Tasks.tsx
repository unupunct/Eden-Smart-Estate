import { useEffect, useState } from 'react'
import { Check, Download, Pencil, Plus, Repeat, Trash2 } from 'lucide-react'
import { manageApi } from '../api/client'
import { dueLabel, repeatLabel, summariseTasks, todayISO, urgency, type Urgency } from '../manage/logic'
import { useManage } from '../manage/store'
import type { Priority, RepeatUnit, Task } from '../manage/types'
import { useApp } from '../model/app'
import { kindDef } from '../model/kinds'
import { useEditor } from '../model/store'

export function useManageLoad() {
  const pid = useEditor((s) => s.property?.id ?? null)
  const load = useManage((s) => s.load)
  useEffect(() => {
    void load(pid)
    const h = setInterval(() => void load(pid), 20000)
    return () => clearInterval(h)
  }, [pid, load])
  return pid
}

const GROUPS: { key: Urgency; title: string }[] = [
  { key: 'overdue', title: 'Overdue' }, { key: 'today', title: 'Today' }, { key: 'soon', title: 'Next 7 days' }, { key: 'later', title: 'Later' }, { key: 'undated', title: 'No date' },
]

interface Draft {
  id?: string
  title: string
  notes: string
  category: string
  priority: Priority
  due: string
  repeatEvery: string
  repeatUnit: RepeatUnit
  repeatFrom: 'due' | 'completion'
  objectId: string
}
const blank = (objectId = ''): Draft => ({ title: '', notes: '', category: '', priority: 'normal', due: '', repeatEvery: '', repeatUnit: 'week', repeatFrom: 'due', objectId })

export function TasksPage() {
  const pid = useManageLoad()
  const { tasks, history, loaded, error } = useManage()
  const load = useManage((s) => s.load)
  const objects = useEditor((s) => s.doc.objects)
  const property = useEditor((s) => s.property)
  const focus = useEditor((s) => s.requestFocus)
  const go = useApp((s) => s.go)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [show, setShow] = useState<'open' | 'done'>('open')
  const [cat, setCat] = useState('')
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const today = todayISO()

  if (!property || !pid) {
    return <div className="emptystate"><h2>No property open</h2><p>Open or create a property first: tasks belong to a property and can be linked to its trees, beds, fences and buildings.</p></div>
  }
  const wrap = async (f: () => Promise<unknown>) => {
    setErr('')
    try {
      await f()
      await load(pid)
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const complete = (t: Task) => wrap(async () => {
    const r = await manageApi.completeTask(t.id)
    setFlash(r.status === 'open' ? `Done. Next “${t.title}”: ${r.due}.` : `Done: “${t.title}”.`)
    setTimeout(() => setFlash(''), 4000)
  })
  const cats = [...new Set(tasks.map((t) => t.category).filter(Boolean))].sort()
  const visible = tasks.filter((t) => (show === 'open' ? t.status === 'open' : t.status === 'done') && (!cat || t.category === cat))
  const counts = summariseTasks(tasks, today)
  const objName = (id: string | null) => (id ? objects[id]?.name || (objects[id] ? kindDef(objects[id].kind).label : '(removed object)') : '')

  const row = (t: Task) => (
    <li key={t.id} className={`task u-${urgency(t, today)}`}>
      <button className="chip tick" title={t.status === 'open' ? 'Mark as done' : 'Done'} disabled={t.status === 'done'} onClick={() => void complete(t)}><Check size={14} /></button>
      <div className="tbody">
        <div className="trow"><b>{t.title}</b>{t.priority === 'high' && <span className="badge">high</span>}{t.category && <span className="pill">{t.category}</span>}</div>
        <small className="muted">
          {t.status === 'open' ? dueLabel(t, today) : `done ${t.completedAt ?? ''}`}
          {t.repeatEvery ? <> · <Repeat size={11} /> {repeatLabel(t)}</> : ''}
          {t.objectId ? <> · <button className="linklike" onClick={() => { focus(t.objectId!); go('editor') }}>{objName(t.objectId)}</button></> : ''}
        </small>
        {t.notes && <small className="muted notes">{t.notes}</small>}
      </div>
      <button className="icon" title="Edit" onClick={() => setDraft({ id: t.id, title: t.title, notes: t.notes, category: t.category, priority: t.priority, due: t.due ?? '', repeatEvery: t.repeatEvery ? String(t.repeatEvery) : '', repeatUnit: t.repeatUnit ?? 'week', repeatFrom: t.repeatFrom, objectId: t.objectId ?? '' })}><Pencil size={14} /></button>
      {t.status === 'done' && <button className="chip" onClick={() => void wrap(() => manageApi.patchTask(t.id, { status: 'open' }))}>Reopen</button>}
      <button className="icon danger" title="Delete" onClick={() => { if (confirm(`Delete “${t.title}”?`)) void wrap(() => manageApi.deleteTask(t.id)) }}><Trash2 size={14} /></button>
    </li>
  )

  return (
    <div className="page">
      <div className="pagehead">
        <div><h1>Tasks &amp; Maintenance</h1><p>Reminders for the land: prune, feed, service, inspect. Link a task to a tree, bed, fence or building, and let it repeat. Reminders live in EDEN only: nothing is sent to your phone.</p></div>
        <span className="badge">Phase 6</span>
      </div>
      {error && <div className="notice err">{error}</div>}
      {err && <div className="notice err">{err}</div>}
      {flash && <div className="notice ok">{flash}</div>}
      <div className="stats">
        <div className={`stat glass ${counts.overdue ? 'alert' : ''}`}><small>Overdue</small><strong>{counts.overdue}</strong></div>
        <div className="stat glass"><small>Due today</small><strong>{counts.today}</strong></div>
        <div className="stat glass"><small>Next 7 days</small><strong>{counts.soon}</strong></div>
        <div className="stat glass"><small>Open in total</small><strong>{counts.overdue + counts.today + counts.soon + counts.later + counts.undated}</strong><em>{counts.done} done</em></div>
      </div>
      <div className="btnrow">
        <button className="primary" onClick={() => setDraft(blank())}><Plus size={14} /> New task</button>
        <div className="seg"><button className={show === 'open' ? 'on' : ''} onClick={() => setShow('open')}>Open</button><button className={show === 'done' ? 'on' : ''} onClick={() => setShow('done')}>Done</button></div>
        {cats.length > 0 && <select style={{ width: 'auto' }} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>}
        <a className="btn" href={manageApi.tasksCsvUrl(pid)}><Download size={14} /> Export CSV</a>
      </div>
      {draft && <TaskForm draft={draft} onCancel={() => setDraft(null)} onSave={(d) => wrap(async () => {
        const b = { title: d.title, notes: d.notes, category: d.category, priority: d.priority, due: d.due || null, objectId: d.objectId || null, repeatFrom: d.repeatFrom,
          repeatEvery: d.repeatEvery ? Number(d.repeatEvery) : null, repeatUnit: d.repeatEvery ? d.repeatUnit : null }
        if (d.id) await manageApi.patchTask(d.id, b)
        else await manageApi.addTask({ ...b, propertyId: pid })
        setDraft(null)
      })} />}
      {show === 'open' ? (
        <>
          {GROUPS.map((g) => {
            const list = visible.filter((t) => urgency(t, today) === g.key)
            return list.length ? <section key={g.key}><h2 className="sect">{g.title} <small className="muted">{list.length}</small></h2><ul className="tasks glass">{list.map(row)}</ul></section> : null
          })}
          {!visible.length && loaded && <div className="notice">Nothing to do. Add a task above, for example <i>Prune the apple trees</i> every year in February.</div>}
        </>
      ) : <ul className="tasks glass">{visible.map(row)}{!visible.length && <li className="empty">No finished tasks yet.</li>}</ul>}

      <h2 className="sect">Maintenance history</h2>
      <div className="glass tablewrap">
        <table>
          <thead><tr><th>Done on</th><th>Task</th><th>Object</th><th>Note</th></tr></thead>
          <tbody>
            {history.slice(0, 40).map((h) => <tr key={h.id}><td className="mono">{h.completedOn}</td><td>{h.title}</td><td>{objName(h.objectId) || '—'}</td><td className="muted">{h.note}</td></tr>)}
            {!history.length && <tr><td colSpan={4} className="empty">Completed tasks are recorded here, so you can see when each tree or building was last looked after.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TaskForm({ draft, onSave, onCancel }: { draft: Draft; onSave: (d: Draft) => void; onCancel: () => void }) {
  const [d, setD] = useState(draft)
  const objects = useEditor((s) => s.doc.objects)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((s) => ({ ...s, [k]: v }))
  const list = Object.values(objects).filter((o) => o.kind !== 'boundary' && o.kind !== 'note').sort((a, b) => (a.name || a.kind).localeCompare(b.name || b.kind))
  return (
    <div className="formcard glass">
      <h3>{d.id ? 'Edit task' : 'New task'}</h3>
      <label>What needs doing<input autoFocus value={d.title} onChange={(e) => set('title', e.target.value)} placeholder="Prune the apple trees" /></label>
      <div className="three">
        <label>Due date<input type="date" value={d.due} onChange={(e) => set('due', e.target.value)} /></label>
        <label>Priority<select value={d.priority} onChange={(e) => set('priority', e.target.value as Priority)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
        <label>Category<input list="task-cats" value={d.category} onChange={(e) => set('category', e.target.value)} placeholder="orchard, house, garden…" /><datalist id="task-cats">{['garden', 'orchard', 'greenhouse', 'pond', 'house', 'fences', 'equipment'].map((c) => <option key={c} value={c} />)}</datalist></label>
      </div>
      <label>About (optional)<select value={d.objectId} onChange={(e) => set('objectId', e.target.value)}><option value="">the whole property</option>{list.map((o) => <option key={o.id} value={o.id}>{o.name || kindDef(o.kind).label} ({kindDef(o.kind).label})</option>)}</select></label>
      <div className="inline">
        <label className="check"><input type="checkbox" checked={!!d.repeatEvery} onChange={(e) => set('repeatEvery', e.target.checked ? '1' : '')} /> Repeats every</label>
        {d.repeatEvery !== '' && (
          <>
            <input type="number" min={1} max={365} style={{ maxWidth: 80 }} value={d.repeatEvery} onChange={(e) => set('repeatEvery', e.target.value)} />
            <select value={d.repeatUnit} onChange={(e) => set('repeatUnit', e.target.value as RepeatUnit)}><option value="day">days</option><option value="week">weeks</option><option value="month">months</option><option value="year">years</option></select>
            <select value={d.repeatFrom} onChange={(e) => set('repeatFrom', e.target.value as 'due' | 'completion')}><option value="due">keeping the original rhythm</option><option value="completion">counted from when I finish</option></select>
          </>
        )}
      </div>
      <label>Notes<textarea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} /></label>
      <div className="btnrow end"><button onClick={onCancel}>Cancel</button><button className="primary" disabled={!d.title.trim()} onClick={() => onSave(d)}>Save task</button></div>
    </div>
  )
}
