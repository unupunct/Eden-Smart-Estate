import { fmtArea, fmtLength, measureGeom } from '../geo/measure'
import { analyseBed, orchardStats, pondVolume, type LibraryIndex } from '../library/logic'
import type { Planting } from '../library/types'
import { dueLabel, gardenNotes, repeatLabel, urgency, weatherText } from '../manage/logic'
import type { DocumentInfo, HistoryEntry, Task, WeatherReply } from '../manage/types'
import { kindDef } from '../model/kinds'
import type { Doc } from '../model/types'

export type Block = { type: 'p'; text: string } | { type: 'list'; items: string[] } | { type: 'table'; head: string[]; rows: string[][] }
export interface Section {
  id: SectionId
  title: string
  blocks: Block[]
}
export type SectionId = 'summary' | 'inventory' | 'beds' | 'orchard' | 'ponds' | 'tasks' | 'documents' | 'weather'
export const SECTION_TITLES: Record<SectionId, string> = {
  summary: 'Property summary', inventory: 'Inventory of objects', beds: 'Garden beds and plantings', orchard: 'Orchard and trees', ponds: 'Ponds',
  tasks: 'Tasks and maintenance', documents: 'Documents and photos', weather: 'Weather snapshot',
}

export interface ReportInput {
  name: string
  description: string
  center: [number, number]
  doc: Doc
  ix: LibraryIndex | null
  tasks: Task[]
  history: HistoryEntry[]
  documents: DocumentInfo[]
  weather: WeatherReply | null
  weatherEnabled: boolean
  today: string
  isDemo: boolean
}

export function buildReport(inp: ReportInput, include: SectionId[]): Section[] {
  const objs = Object.values(inp.doc.objects)
  const nameOf = (id: string | null) => (id ? inp.doc.objects[id]?.name || (inp.doc.objects[id] ? kindDef(inp.doc.objects[id].kind).label : '(removed)') : 'whole property')
  const out: Section[] = []
  const add = (id: SectionId, blocks: Block[]) => include.includes(id) && out.push({ id, title: SECTION_TITLES[id], blocks })

  // summary
  const sum = (kinds: string[]) => objs.filter((o) => kinds.includes(o.kind)).reduce((s, o) => s + measureGeom(o.geometry).area, 0)
  const len = (kinds: string[]) => objs.filter((o) => kinds.includes(o.kind)).reduce((s, o) => s + measureGeom(o.geometry).perimeter, 0)
  const boundary = objs.filter((o) => o.kind === 'boundary')
  add('summary', [
    ...(inp.description ? [{ type: 'p', text: inp.description } as Block] : []),
    ...(inp.isDemo ? [{ type: 'p', text: 'DEMO DATA: this is the fictional demo estate, not a real property.' } as Block] : []),
    {
      type: 'table', head: ['Item', 'Value'], rows: [
        ['Location', `${inp.center[1].toFixed(5)}°, ${inp.center[0].toFixed(5)}°`],
        ['Property area', boundary.length ? fmtArea(sum(['boundary'])) : 'no boundary drawn'],
        ['Boundary length', boundary.length ? fmtLength(len(['boundary'])) : '—'],
        ['Buildings and greenhouses (footprint)', fmtArea(sum(['building', 'greenhouse']))],
        ['Garden beds', `${objs.filter((o) => o.kind === 'garden_bed').length} beds, ${fmtArea(sum(['garden_bed']))}`],
        ['Fences and hedges', fmtLength(len(['fence', 'hedge']))],
        ['Roads and paths', fmtLength(len(['road', 'path']))],
        ['Pond surface', fmtArea(sum(['pond']))],
      ],
    },
  ])

  // inventory
  const counts = new Map<string, number>()
  for (const o of objs) counts.set(o.kind, (counts.get(o.kind) ?? 0) + 1)
  add('inventory', [{ type: 'table', head: ['Type', 'Count'], rows: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => [kindDef(k).label, String(n)]) }])

  // beds
  const beds = objs.filter((o) => o.kind === 'garden_bed').sort((a, b) => a.name.localeCompare(b.name))
  add('beds', beds.length ? [{
    type: 'table', head: ['Bed', 'Area', 'Plantings', 'Companion check'], rows: beds.map((b) => {
      const pl: Planting[] = Array.isArray(b.props.plantings) ? (b.props.plantings as Planting[]) : []
      const an = inp.ix ? analyseBed(inp.ix, measureGeom(b.geometry).area, pl) : null
      const names = pl.map((p) => `${inp.ix?.plants.get(p.speciesId)?.name ?? p.speciesId}${p.count ? ` ×${p.count}` : ''}`).join(', ') || 'none listed'
      const check = !an?.pairs.length ? 'no recorded relationships' : { green: 'documented-compatible', yellow: 'check notes (conditional / traditional)', red: 'CONFLICT: incompatible pair' }[an.worst ?? 'green']
      return [b.name, fmtArea(measureGeom(b.geometry).area), names, check + (an?.crowded ? '; overcrowded' : '')]
    }),
  }] : [{ type: 'p', text: 'No garden beds on the property.' }])

  // orchard
  if (inp.ix) {
    const st = orchardStats(inp.ix, inp.doc.objects)
    add('orchard', st.trees ? [
      { type: 'p', text: `${st.trees} trees${st.avgAge !== null ? `, average age ${st.avgAge.toFixed(1)} years` : ''}; projected mature canopy ${fmtArea(st.matureCanopyArea)}.` },
      { type: 'table', head: ['Species', 'Trees', 'Varieties'], rows: st.bySpecies.map((s) => [s.label, String(s.count), s.varieties.join(', ') || '—']) },
    ] : [{ type: 'p', text: 'No trees on the property.' }])
  } else add('orchard', [{ type: 'p', text: 'The plant library has not loaded.' }])

  // ponds
  const ponds = objs.filter((o) => o.kind === 'pond')
  add('ponds', ponds.length ? [{
    type: 'table', head: ['Pond', 'Surface', 'Estimated volume', 'Fish'], rows: ponds.map((p) => {
      const v = pondVolume(p, objs.filter((o) => o.kind === 'pond_zone'))
      const fish = Array.isArray(p.props.fish) ? (p.props.fish as { speciesId: string; count?: number }[]).map((f) => `${inp.ix?.fish.get(f.speciesId)?.name ?? f.speciesId}${f.count ? ` ×${f.count}` : ''}`).join(', ') : ''
      return [p.name, fmtArea(v.surface), `${Math.round(v.volume).toLocaleString('en-US')} m³ (planning estimate)`, fish || 'none']
    }),
  }] : [{ type: 'p', text: 'No ponds on the property.' }])

  // tasks
  const open = inp.tasks.filter((t) => t.status === 'open')
  add('tasks', [
    { type: 'p', text: `${open.filter((t) => urgency(t, inp.today) === 'overdue').length} overdue, ${open.length} open, ${inp.history.length} completions on record.` },
    open.length ? { type: 'table', head: ['Task', 'Due', 'About', 'Repeats'], rows: open.map((t) => [t.title, dueLabel(t, inp.today), nameOf(t.objectId), repeatLabel(t) || '—']) } : { type: 'p', text: 'No open tasks.' },
    ...(inp.history.length ? [{ type: 'table', head: ['Done on', 'Task', 'About'], rows: inp.history.slice(0, 15).map((h) => [h.completedOn, h.title, nameOf(h.objectId)]) } as Block] : []),
  ])

  // documents
  add('documents', inp.documents.length ? [{ type: 'table', head: ['Title', 'Date', 'About', 'Tags'], rows: inp.documents.map((d) => [d.title, d.takenAt ?? d.createdAt.slice(0, 10), nameOf(d.objectId), d.tags.join(', ')]) }] : [{ type: 'p', text: 'No documents or photos attached.' }])

  // weather: only what was really fetched
  if (inp.weather) {
    const w = inp.weather.data
    const c = weatherText(w.current.weather_code)
    add('weather', [
      { type: 'p', text: `Open-Meteo forecast fetched ${new Date(inp.weather.fetchedAt).toLocaleString()}${inp.weather.stale ? ' (OLD: the service could not be reached)' : ''}. Now: ${c.text}, ${w.current.temperature_2m.toFixed(1)} °C.` },
      { type: 'table', head: ['Day', 'Sky', 'Low', 'High', 'Rain'], rows: w.daily.time.map((d, i) => [d, weatherText(w.daily.weather_code[i]).text, `${w.daily.temperature_2m_min[i].toFixed(0)} °C`, `${w.daily.temperature_2m_max[i].toFixed(0)} °C`, `${w.daily.precipitation_sum[i].toFixed(1)} mm`]) },
      { type: 'list', items: gardenNotes(w).map((n) => n.text) },
    ])
  } else add('weather', [{ type: 'p', text: inp.weatherEnabled ? 'The forecast has not been loaded yet: open the Weather page first.' : 'Weather is switched off, so there is no forecast to include.' }])

  return include.map((id) => out.find((s) => s.id === id)).filter((s): s is Section => !!s)
}
