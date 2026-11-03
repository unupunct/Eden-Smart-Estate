import { useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { manageApi } from '../api/client'
import { useLibrary } from '../library/store'
import { todayISO } from '../manage/logic'
import { useManage } from '../manage/store'
import { useEditor } from '../model/store'
import { buildReport, SECTION_TITLES, type SectionId } from '../reports/build'
import { useManageLoad } from './Tasks'

const ALL = Object.keys(SECTION_TITLES) as SectionId[]

export function ReportsPage() {
  const pid = useManageLoad()
  const property = useEditor((s) => s.property)
  const doc = useEditor((s) => s.doc)
  const ix = useLibrary((s) => s.ix)
  const { tasks, history, documents, weather, weatherEnabled } = useManage()
  const [include, setInclude] = useState<SectionId[]>(ALL.filter((s) => s !== 'documents'))
  const sections = useMemo(() => property ? buildReport({
    name: property.name, description: property.description, center: property.center, doc, ix, tasks, history, documents, weather, weatherEnabled, today: todayISO(), isDemo: property.isDemo,
  }, ALL.filter((s) => include.includes(s))) : [], [property, doc, ix, tasks, history, documents, weather, weatherEnabled, include])
  if (!property || !pid) return <div className="emptystate"><h2>No property open</h2><p>Open or create a property first.</p></div>
  const toggle = (s: SectionId) => setInclude((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))

  return (
    <div className="page reportpage">
      <div className="pagehead noprint">
        <div><h1>Reports</h1><p>A printable summary of the property built from your data. Choose what to include, then print or save it as PDF from the print dialog. Nothing is uploaded.</p></div>
        <span className="badge">Phase 6</span>
      </div>
      <div className="formcard glass noprint">
        <h3>Include</h3>
        <div className="checks inline">{ALL.map((s) => <label key={s} className="check"><input type="checkbox" checked={include.includes(s)} onChange={() => toggle(s)} /> {SECTION_TITLES[s]}</label>)}</div>
        <div className="btnrow">
          <button className="primary" onClick={() => window.print()}><Printer size={14} /> Print / save as PDF</button>
          <a className="btn" href={manageApi.tasksCsvUrl(pid)}><Download size={14} /> Tasks (CSV)</a>
          <a className="btn" href={`/api/properties/${pid}/export.csv`}><Download size={14} /> Objects (CSV)</a>
          <a className="btn" href={`/api/properties/${pid}/export.geojson`}><Download size={14} /> GeoJSON</a>
        </div>
        <small className="muted">Weather appears only if it is switched on and has been loaded; sun hours are on the Sun &amp; Shadows page.</small>
      </div>
      <article className="report">
        <header>
          <h1>{property.name}</h1>
          <p>Estate report · generated {new Date().toLocaleString()} · EDEN Smart Estate</p>
        </header>
        {sections.map((s) => (
          <section key={s.id} data-section={s.id}>
            <h2>{s.title}</h2>
            {s.blocks.map((b, i) => b.type === 'p' ? <p key={i}>{b.text}</p>
              : b.type === 'list' ? <ul key={i}>{b.items.map((t, j) => <li key={j}>{t}</li>)}</ul>
                : <table key={i}><thead><tr>{b.head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody></table>)}
          </section>
        ))}
        {!sections.length && <p className="empty">Select at least one section.</p>}
        <footer><small>Areas and distances are calculated on a sphere; volumes and sun/weather figures are planning estimates. Plant data comes from a curated starter library, not a citation-backed database.</small></footer>
      </article>
    </div>
  )
}
