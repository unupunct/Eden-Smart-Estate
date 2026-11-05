import type { Library } from '../library/types'
import type { DocumentInfo, Task } from '../manage/types'
import type { Route } from '../model/app'
import { kindDef } from '../model/kinds'
import type { EdenObject } from '../model/types'
import type { Automation, Camera, Device, Integration } from '../smart/types'

export type HitType = 'page' | 'object' | 'plant' | 'aquatic' | 'fish' | 'mushroom' | 'task' | 'document' | 'device' | 'automation' | 'camera' | 'integration'

export interface Hit {
  type: HitType
  id: string
  title: string
  subtitle: string
  route?: Route
}

export interface SearchContext {
  pages: { route: Route; label: string; keywords?: string }[]
  objects: EdenObject[]
  lib: Library | null
  tasks: Task[]
  documents: DocumentInfo[]
  devices: Device[]
  automations: Automation[]
  cameras: Camera[]
  integrations: Integration[]
}

/** Lower-case, accents removed (so "sarpe" finds "șarpe", "ceapa" finds "ceapă"). */
export const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export const TYPE_LABEL: Record<HitType, string> = {
  page: 'Pages', object: 'On the map', plant: 'Plants & trees', aquatic: 'Aquatic plants', fish: 'Pond fish', mushroom: 'Mushrooms', task: 'Tasks', document: 'Documents and photos',
  device: 'Devices', automation: 'Automations', camera: 'Cameras', integration: 'Integrations',
}
const ORDER: HitType[] = ['page', 'object', 'task', 'document', 'device', 'automation', 'camera', 'integration', 'plant', 'aquatic', 'fish', 'mushroom']

interface Candidate extends Hit {
  extra: string
}

function candidates(c: SearchContext): Candidate[] {
  const out: Candidate[] = []
  for (const p of c.pages) out.push({ type: 'page', id: p.route, title: p.label, subtitle: 'Open page', extra: p.keywords ?? '', route: p.route })
  for (const o of c.objects) {
    const def = kindDef(o.kind)
    out.push({ type: 'object', id: o.id, title: o.name || def.label, subtitle: def.label, extra: `${String(o.props.species ?? '')} ${String(o.props.variety ?? '')} ${String(o.props.description ?? '')}` })
  }
  for (const t of c.tasks) out.push({ type: 'task', id: t.id, title: t.title, subtitle: t.status === 'done' ? 'Task (done)' : `Task${t.due ? `, due ${t.due}` : ''}`, extra: `${t.notes} ${t.category}` })
  for (const d of c.documents) out.push({ type: 'document', id: d.id, title: d.title, subtitle: d.originalName, extra: `${d.tags.join(' ')} ${d.note}` })
  for (const d of c.devices) out.push({ type: 'device', id: d.id, title: d.name, subtitle: `${d.domain}${d.state !== null ? `: ${d.state}${d.unit ? ' ' + d.unit : ''}` : ': no data'}`, extra: d.externalId })
  for (const a of c.automations) out.push({ type: 'automation', id: a.id, title: a.name, subtitle: a.summary, extra: '' })
  for (const k of c.cameras) out.push({ type: 'camera', id: k.id, title: k.name, subtitle: `${k.kind} camera`, extra: k.entityId })
  for (const i of c.integrations) out.push({ type: 'integration', id: i.id, title: i.name, subtitle: i.kind === 'homeassistant' ? 'Home Assistant' : 'MQTT broker', extra: i.url })
  if (c.lib) {
    for (const p of c.lib.plants) out.push({ type: 'plant', id: p.id, title: p.name, subtitle: p.sci, extra: `${p.ro ?? ''} ${p.family} ${p.cats.join(' ')}` })
    for (const p of c.lib.aquatic) out.push({ type: 'aquatic', id: p.id, title: p.name, subtitle: p.sci, extra: p.zone })
    for (const f of c.lib.fish) out.push({ type: 'fish', id: f.id, title: f.name, subtitle: f.sci, extra: '' })
    for (const m of c.lib.mushrooms) out.push({ type: 'mushroom', id: m.id, title: m.name, subtitle: m.sci, extra: `${m.ro ?? ''}` })
  }
  return out
}

/**
 * One search over everything EDEN knows: pages, map objects, library entries, tasks, documents, devices, automations,
 * cameras and integrations. Every word of the query has to match (accents and case ignored); title matches rank first.
 */
export function searchAll(query: string, ctx: SearchContext, perType = 6, total = 40): Hit[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const scored: { c: Candidate; score: number }[] = []
  for (const c of candidates(ctx)) {
    const title = fold(c.title)
    const hay = `${title} ${fold(c.subtitle)} ${fold(c.extra)}`
    if (!words.every((w) => hay.includes(w))) continue
    let score = 3
    if (words.every((w) => title.startsWith(w) || title.includes(` ${w}`))) score = 0
    else if (words.every((w) => title.includes(w))) score = 1
    else if (words.some((w) => title.includes(w))) score = 2
    scored.push({ c, score })
  }
  const count: Partial<Record<HitType, number>> = {}
  return scored
    .sort((a, b) => a.score - b.score || ORDER.indexOf(a.c.type) - ORDER.indexOf(b.c.type) || a.c.title.localeCompare(b.c.title))
    .filter(({ c }) => {
      count[c.type] = (count[c.type] ?? 0) + 1
      return count[c.type]! <= perType
    })
    .slice(0, total)
    .map(({ c }) => ({ type: c.type, id: c.id, title: c.title, subtitle: c.subtitle, route: c.route }))
}
