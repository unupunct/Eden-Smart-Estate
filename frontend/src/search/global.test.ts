import { describe, expect, it } from 'vitest'
import type { Library, Plant } from '../library/types'
import type { EdenObject } from '../model/types'
import type { Task } from '../manage/types'
import { fold, searchAll, type SearchContext } from './global'

const plant = (id: string, name: string, ro: string | null, extra: Partial<Plant> = {}): Plant => ({
  id, name, ro, sci: `${name} sci`, family: 'F', cats: ['vegetable'], native: 'introduced', edible: 'yes', sun: 'full', water: 'medium', height: 1, spacing: 30, flower: null, harvest: null,
  sow: null, soil: '', zone: null, canopy: null, prop: '', wildlife: '', root: 'medium', shadeTol: false, notes: '', med: null, tox: null, pollination: null, place: 'plant', leaf: 'deciduous', ...extra,
})
const lib = { plants: [plant('onion', 'Onion', 'Ceapă'), plant('tomato', 'Tomato', 'Roșie')], aquatic: [], fish: [], mushrooms: [{ id: 'amanita', name: 'Death cap', ro: 'Buretele viperei', sci: 'Amanita phalloides' }] } as unknown as Library
const obj = (id: string, kind: string, name: string, props: Record<string, unknown> = {}): EdenObject => ({ id, layerId: 'L', kind, name, geometry: { type: 'Point', coordinates: [24, 45] }, props })
const task = (o: Partial<Task>): Task => ({ id: 't', propertyId: 'p', title: 'x', notes: '', category: '', priority: 'normal', due: null, status: 'open', repeatEvery: null, repeatUnit: null, repeatFrom: 'due', objectId: null, createdAt: '', completedAt: null, ...o })
const ctx: SearchContext = {
  pages: [{ route: 'tasks', label: 'Tasks & Maintenance', keywords: 'reminders todo' }, { route: 'weather', label: 'Weather', keywords: 'forecast frost' }],
  objects: [obj('o1', 'tree', 'Apple 1', { species: 'Apple', variety: 'Jonathan' }), obj('o2', 'garden_bed', 'Bed 1')],
  lib, tasks: [task({ id: 't1', title: 'Prune the apple trees', due: '2025-02-15', notes: 'after frost' })],
  documents: [{ id: 'd1', propertyId: 'p', objectId: null, title: 'Pump warranty', originalName: 'pump.pdf', mime: 'application/pdf', size: 1, tags: ['pond', 'warranty'], note: '', takenAt: null, createdAt: '', isImage: false, url: '', textStatus: '', textNote: '' }],
  devices: [{ id: 'dev1', integrationId: 'i', externalId: 'switch.garden_pump', name: 'Garden pump', domain: 'switch', deviceClass: '', unit: '', state: 'off', stateUpdated: null, attrs: {}, objectId: null, risky: false, commandTopic: '', integrationStatus: 'online', controllable: true }],
  automations: [], cameras: [], integrations: [],
}
const titles = (q: string) => searchAll(q, ctx).map((h) => h.title)

describe('global search', () => {
  it('ignores case and accents, so Romanian names work without diacritics', () => {
    expect(fold('Ceapă ȘARPE Roșie')).toBe('ceapa sarpe rosie')
    expect(titles('ceapa')).toEqual(['Onion'])
    expect(titles('rosie')).toEqual(['Tomato'])
    expect(titles('BURETELE')).toEqual(['Death cap'])
  })
  it('finds things of every kind with a single query', () => {
    expect(searchAll('apple', ctx).map((h) => h.type).sort()).toEqual(['object', 'task'])
    expect(titles('pump')).toEqual(['Pump warranty', 'Garden pump'])
    expect(titles('warranty')).toEqual(['Pump warranty'])
    expect(titles('switch.garden')).toEqual(['Garden pump']) // device entity id
    expect(titles('jonathan')).toEqual(['Apple 1']) // variety of a tree
  })
  it('needs every word to match and ranks title matches first', () => {
    expect(titles('pump pond')).toEqual(['Pump warranty']) // "pond" only in the tags
    expect(titles('frost')).toEqual(['Weather', 'Prune the apple trees']) // page keyword and task note
    expect(searchAll('prune', ctx)[0]).toMatchObject({ type: 'task', id: 't1' })
    expect(titles('zzz')).toEqual([])
    expect(titles('   ')).toEqual([])
  })
  it('opens pages by name or keyword', () => {
    expect(searchAll('remind', ctx)[0]).toMatchObject({ type: 'page', route: 'tasks' })
    expect(searchAll('forecast', ctx)[0]).toMatchObject({ type: 'page', route: 'weather' })
  })
  it('limits each kind so one type cannot drown the rest', () => {
    const many: SearchContext = { ...ctx, objects: Array.from({ length: 30 }, (_, i) => obj(`o${i}`, 'tree', `Tree ${i}`)), tasks: [task({ title: 'Tree check' })] }
    const hits = searchAll('tree', many)
    expect(hits.filter((h) => h.type === 'object')).toHaveLength(6)
    expect(hits.some((h) => h.type === 'task')).toBe(true)
  })
  it('works before the library or any data has loaded', () => {
    expect(searchAll('onion', { ...ctx, lib: null })).toEqual([])
    expect(searchAll('tasks', { pages: ctx.pages, objects: [], lib: null, tasks: [], documents: [], devices: [], automations: [], cameras: [], integrations: [] })).toHaveLength(1)
  })
})
