import { describe, expect, it } from 'vitest'
import type { Doc, EdenObject, Geom, Pos } from '../model/types'
import { BASIS_TEXT, newNeighbours, SOURCE_TEXT, toObjects, type Candidate } from './neighbours'

const L = { id: 'L', key: 'buildings', name: 'Buildings', group: 'Structures', color: '#f4a261', visible: true, locked: false, order: 0 }
const N = { id: 'N', key: 'custom_1', name: 'Neighbouring buildings (OpenStreetMap)', group: 'Estate', color: '#c4b5fd', visible: true, locked: false, order: 1 }
const sq = (x: number, y: number, s: number): Pos[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]
const geom = (ring: Pos[]): Geom => ({ type: 'Polygon', coordinates: [ring] })
const obj = (id: string, kind: string, ring: Pos[], props: Record<string, unknown> = {}): EdenObject => ({ id, layerId: 'L', kind, name: id, geometry: geom(ring), props })
const doc = (...o: EdenObject[]): Doc => ({ layers: [L, N], objects: Object.fromEntries(o.map((x) => [x.id, x])) })
const cand = (id: number, x: number, y: number, over: Partial<Candidate> = {}): Candidate => ({
  osmId: id, ring: sq(x, y, 0.0001), areaM2: 80, distanceM: 40, height: 8, heightBasis: 'tag', roofType: 'gable', eaveHeight: null, name: '', buildingTag: 'house', ...over,
})

describe('which buildings are really neighbours', () => {
  const mine = doc(obj('boundary', 'boundary', sq(24, 46, 0.001)), obj('house', 'building', sq(24.0002, 46.0002, 0.0002)))
  it('keeps buildings outside the property and leaves out those on your own land', () => {
    const r = newNeighbours(mine, [cand(1, 24.002, 46.0), cand(2, 24.0006, 46.0006)])
    expect(r.fresh.map((c) => c.osmId)).toEqual([1])
    expect(r.own).toBe(1)
    expect(r.already).toBe(0)
  })
  it('leaves out a building that is already drawn (inside one of your buildings) or already imported', () => {
    const r = newNeighbours(mine, [cand(3, 24.00025, 46.00025, { ring: sq(24.00025, 46.00025, 0.00005) })])
    expect(r.already).toBe(1)
    const imported = doc(obj('x', 'neighbour', sq(24.002, 46, 0.0001), { osmId: 7 }))
    const r2 = newNeighbours(imported, [cand(7, 24.01, 46.01), cand(8, 24.011, 46.011)])
    expect(r2.fresh.map((c) => c.osmId)).toEqual([8])
    expect(r2.already).toBe(1)
  })
  it('without a boundary drawn it still works (nothing counts as your land)', () => {
    expect(newNeighbours(doc(), [cand(1, 24, 46)]).fresh).toHaveLength(1)
  })
})

describe('turning candidates into map objects', () => {
  const objs = toObjects(doc().layers, 'N', [cand(1, 24, 46, { name: 'Casa vecinului', height: 9 }), cand(2, 24.001, 46, { heightBasis: 'assumed', roofType: 'hip', eaveHeight: 6.5, height: 7 })])
  it('makes ordinary editable objects of the neighbour kind on the given layer', () => {
    expect(objs).toHaveLength(2)
    expect(objs.every((o) => o.kind === 'neighbour' && o.layerId === 'N' && o.geometry.type === 'Polygon')).toBe(true)
    expect(new Set(objs.map((o) => o.id)).size).toBe(2)
  })
  it('keeps the name, height, roof and where the height came from, and the source', () => {
    expect(objs[0].name).toBe('Casa vecinului')
    expect(objs[0].props).toMatchObject({ height: 9, roofType: 'gable', osmId: 1, source: SOURCE_TEXT, heightBasis: BASIS_TEXT.tag })
    expect(objs[1].name).toBe('Neighbouring building')
    expect(objs[1].props).toMatchObject({ roofType: 'hip', eaveHeight: 6.5, heightBasis: BASIS_TEXT.assumed })
    expect(objs[0].props.eaveHeight).toBeUndefined()
  })
})
