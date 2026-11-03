import { describe, expect, it } from 'vitest'
import { circlePolygon, rectPolygon } from '../geo/transform'
import { buildIndex } from '../library/logic'
import type { Library, Plant, Relation } from '../library/types'
import type { EdenObject } from '../model/types'
import type { Task } from '../manage/types'
import { buildReport, SECTION_TITLES, type ReportInput, type SectionId } from './build'

const plant = (id: string, name: string, extra: Partial<Plant> = {}): Plant => ({
  id, name, ro: null, sci: id, family: 'F', cats: [], native: 'introduced', edible: 'yes', sun: 'full', water: 'medium', height: 1, spacing: 30, flower: null, harvest: null,
  sow: null, soil: '', zone: null, canopy: null, prop: '', wildlife: '', root: 'medium', shadeTol: false, notes: '', med: null, tox: null, pollination: null, place: 'plant', leaf: 'deciduous', ...extra,
})
const rel: Relation = { a: 'tomato', b: 'potato', type: 'incompatible', evidence: 'documented', note: 'x'.repeat(30) }
const lib: Library = {
  version: 't', disclaimers: { data: '', evidence: { documented: '', mixed: '', traditional: '' }, medicinal: '', mushrooms: '' },
  plants: [plant('tomato', 'Tomato'), plant('potato', 'Potato'), plant('apple', 'Apple', { place: 'tree', canopy: 4 })], aquatic: [], fish: [], mushrooms: [], companions: [rel],
  waterQuality: { note: '', ranges: { ph: { label: 'pH', unit: '', min: 6, max: 9 }, oxygen: { label: 'O', unit: '', min: 5 }, tempC: { label: 'T', unit: '', warnAbove: 28 }, ammonia: { label: 'A', unit: '', max: 1 }, nitrite: { label: 'N', unit: '', max: 1 }, nitrate: { label: 'N', unit: '', max: 1 } } },
}
const O: [number, number] = [24, 45]
const obj = (id: string, kind: string, name: string, geometry: EdenObject['geometry'], props: Record<string, unknown> = {}): EdenObject => ({ id, layerId: 'L', kind, name, geometry, props })
const objects = [
  obj('b', 'garden_bed', 'Bed 1', rectPolygon([24, 45], [24.0001, 45.0001]), { plantings: [{ speciesId: 'tomato', count: 4 }, { speciesId: 'potato', count: 4 }] }),
  obj('t', 'tree', 'Apple 1', { type: 'Point', coordinates: O }, { speciesId: 'apple', plantedYear: 2020 }),
  obj('p', 'pond', 'Pond', circlePolygon([24.0005, 45.0005], 5), { maxDepth: 1.5 }),
]
const task = (o: Partial<Task>): Task => ({ id: 'a', propertyId: 'p', title: 't', notes: '', category: '', priority: 'normal', due: null, status: 'open', repeatEvery: null, repeatUnit: null, repeatFrom: 'due', objectId: null, createdAt: '', completedAt: null, ...o })
const input = (o: Partial<ReportInput> = {}): ReportInput => ({
  name: 'Test', description: 'A test estate', center: O, doc: { layers: [], objects: Object.fromEntries(objects.map((x) => [x.id, x])) }, ix: buildIndex(lib),
  tasks: [task({ title: 'Prune', due: '2025-01-01', objectId: 't' }), task({ id: 'b', title: 'Mow', due: '2025-12-01' })], history: [], documents: [], weather: null, weatherEnabled: false, today: '2025-06-10', isDemo: false, ...o,
})
const ALL = Object.keys(SECTION_TITLES) as SectionId[]
const text = (s: ReturnType<typeof buildReport>) => JSON.stringify(s)

describe('report builder', () => {
  it('builds exactly the requested sections in order', () => {
    expect(buildReport(input(), ['tasks', 'summary']).map((s) => s.id)).toEqual(['tasks', 'summary'])
    expect(buildReport(input(), ALL)).toHaveLength(ALL.length)
  })
  it('reports real facts from the data: bed conflict, tree count, pond volume, overdue tasks', () => {
    const t = text(buildReport(input(), ALL))
    expect(t).toMatch(/CONFLICT: incompatible pair/)
    expect(t).toMatch(/Tomato ×4, Potato ×4/)
    expect(t).toMatch(/1 trees/)
    expect(t).toMatch(/planning estimate/)
    expect(t).toMatch(/1 overdue, 2 open/)
  })
  it('flags demo data and never invents weather', () => {
    expect(text(buildReport(input({ isDemo: true }), ['summary']))).toMatch(/DEMO DATA/)
    expect(text(buildReport(input(), ['weather']))).toMatch(/Weather is switched off/)
    expect(text(buildReport(input({ weatherEnabled: true }), ['weather']))).toMatch(/has not been loaded yet/)
  })
  it('says so when there is nothing to report instead of leaving a blank', () => {
    const t = text(buildReport(input({ doc: { layers: [], objects: {} }, tasks: [] }), ALL))
    expect(t).toMatch(/No garden beds/)
    expect(t).toMatch(/No trees/)
    expect(t).toMatch(/No ponds/)
    expect(t).toMatch(/No open tasks/)
    expect(t).toMatch(/No documents or photos/)
  })
  it('marks an old forecast as old', () => {
    const w = { source: 'Open-Meteo', fetchedAt: '2025-06-10T08:00:00+03:00', stale: true, data: { timezone: 'x', current: { time: '2025-06-10T08:00', temperature_2m: 12, weather_code: 3 }, daily: { time: ['2025-06-10'], weather_code: [3], temperature_2m_max: [15], temperature_2m_min: [-1], precipitation_sum: [0] }, hourly: { time: [], temperature_2m: [] } } }
    const t = text(buildReport(input({ weather: w, weatherEnabled: true }), ['weather']))
    expect(t).toMatch(/OLD: the service could not be reached/)
    expect(t).toMatch(/frost is likely/)
  })
})
