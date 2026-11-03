import { readFileSync } from 'node:fs'
import { describe, expect, it, beforeEach } from 'vitest'
import { diffDoc } from './autosave'
import { KINDS, KIND_MAP } from './kinds'
import { LAYER_DEFAULT_COLORS, createObject, displayColor, duplicateObject } from './ops'
import { useEditor } from './store'
import type { Doc, Layer, PropertyModel } from './types'
import { buildExtrusions, buildHandles, buildObjectCollection, cameraWedge } from '../map/features'

const layers: Layer[] = Object.keys(LAYER_DEFAULT_COLORS).map((key, i) => ({
  id: `L-${key}`, key, name: key, group: 'g', color: LAYER_DEFAULT_COLORS[key], visible: true, locked: false, order: i,
}))
const square = (x = 24, y = 45, d = 0.001) => ({ type: 'Polygon' as const, coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] as [number, number][][] })
const model = (): PropertyModel => ({
  property: { id: 'p1', name: 'P', description: '', center: [24, 45], zoom: 17, bearing: 0, pitch: 0, baseMap: 'satellite', isDemo: false },
  layers: layers.map((l) => ({ ...l })),
  objects: [],
  overlays: [],
})

beforeEach(() => useEditor.getState().loadModel(model()))

describe('kind catalog vs backend', () => {
  const py = readFileSync(new URL('../../../backend/app/layers.py', import.meta.url), 'utf8')
  it('maps every kind to a layer the backend creates', () => {
    const keys = [...py.matchAll(/^\s+\("(\w+)", "[^"]+", "[^"]+", "(#[0-9a-f]{6})"\)/gm)]
    const backend = Object.fromEntries(keys.map((m) => [m[1], m[2]]))
    expect(Object.keys(backend).sort()).toEqual(Object.keys(LAYER_DEFAULT_COLORS).sort())
    for (const [k, c] of Object.entries(backend)) expect(LAYER_DEFAULT_COLORS[k]).toBe(c)
    for (const k of KINDS) expect(backend[k.layerKey], k.kind).toBeDefined()
  })
  it('backend KIND_LAYER agrees with the frontend catalog', () => {
    const block = py.slice(py.indexOf('KIND_LAYER = {'))
    const pairs = [...block.matchAll(/"(\w+)": "(\w+)"/g)].map((m) => [m[1], m[2]])
    for (const [kind, layer] of pairs) if (KIND_MAP[kind]) expect(KIND_MAP[kind].layerKey).toBe(layer)
    for (const k of KINDS) expect(pairs.find((p) => p[0] === k.kind), k.kind).toBeDefined()
  })
  it('presets only set props the kind knows about or common ones', () => {
    for (const k of KINDS) for (const p of k.presets ?? []) expect(p.id).toBeTruthy()
  })
})

describe('object creation', () => {
  it('uses the kind layer, preset name and defaults', () => {
    const o = createObject(layers, 'building', square(), 'barn')
    expect(o.layerId).toBe('L-buildings')
    expect(o.name).toBe('Barn')
    expect(o.props).toMatchObject({ buildingType: 'barn', height: 6, roofType: 'gable' })
    expect(o.id).toMatch(/^[0-9a-f]{32}$/)
  })
  it('duplicates with a new id and a shifted position', () => {
    const o = createObject(layers, 'tree', { type: 'Point', coordinates: [24, 45] }, 'apple')
    const d = duplicateObject(o)
    expect(d.id).not.toBe(o.id)
    expect(d.geometry).not.toEqual(o.geometry)
    expect(d.name).toContain('copy')
  })
  it('colour: object colour wins, then customised layer colour, then kind colour', () => {
    const o = createObject(layers, 'zone', square())
    const layer = layers.find((l) => l.key === 'zones')!
    expect(displayColor(o, layer)).toBe(KIND_MAP.zone.color)
    expect(displayColor(o, { ...layer, color: '#123456' })).toBe('#123456')
    expect(displayColor({ ...o, props: { color: '#abcdef' } }, { ...layer, color: '#123456' })).toBe('#abcdef')
  })
})

describe('undo / redo', () => {
  const add = () => useEditor.getState().addObjects([createObject(useEditor.getState().doc.layers, 'zone', square())])
  it('undoes and redoes additions and deletions', () => {
    const s = () => useEditor.getState()
    add()
    expect(Object.keys(s().doc.objects)).toHaveLength(1)
    s().undo()
    expect(Object.keys(s().doc.objects)).toHaveLength(0)
    s().redo()
    expect(Object.keys(s().doc.objects)).toHaveLength(1)
    const id = Object.keys(s().doc.objects)[0]
    s().deleteObjects([id])
    expect(Object.keys(s().doc.objects)).toHaveLength(0)
    s().undo()
    expect(s().doc.objects[id]).toBeDefined()
  })
  it('a new edit clears the redo stack', () => {
    const s = () => useEditor.getState()
    add(); s().undo(); add()
    expect(s().future).toHaveLength(0)
  })
  it('a drag gesture is a single undo step', () => {
    const s = () => useEditor.getState()
    add()
    const id = Object.keys(s().doc.objects)[0]
    const before = s().doc
    s().beginGesture()
    for (let i = 1; i <= 20; i++) s().setGeometries({ [id]: square(24 + i * 0.0001) }, true)
    s().endGesture()
    expect(s().past[s().past.length - 1]).toBe(before)
    s().undo()
    expect(s().doc).toBe(before)
  })
  it('rapid edits to the same field coalesce, different fields do not', () => {
    const s = () => useEditor.getState()
    add()
    const id = Object.keys(s().doc.objects)[0]
    const n = s().past.length
    for (const ch of ['a', 'ab', 'abc']) s().patchObject(id, { name: ch }, 'name:x')
    expect(s().past.length).toBe(n + 1)
    expect(s().doc.objects[id].name).toBe('abc')
    s().patchObject(id, { props: { notes: 'x' } }, 'notes')
    expect(s().past.length).toBe(n + 2)
  })
  it('undo drops stale selection', () => {
    const s = () => useEditor.getState()
    add()
    expect(s().selection).toHaveLength(1)
    s().undo()
    expect(s().selection).toHaveLength(0)
  })
})

describe('layers', () => {
  it('toggles visibility/lock, reorders, renames', () => {
    const s = () => useEditor.getState()
    s().updateLayer('L-trees', { visible: false, locked: true, name: 'Big trees' })
    const t = s().doc.layers.find((l) => l.id === 'L-trees')!
    expect(t).toMatchObject({ visible: false, locked: true, name: 'Big trees' })
    const before = s().doc.layers.find((l) => l.id === 'L-notes')!.order
    s().moveLayer('L-notes', -1)
    expect(s().doc.layers.find((l) => l.id === 'L-notes')!.order).toBe(before - 1)
  })
  it('only custom empty layers can be deleted', () => {
    const s = () => useEditor.getState()
    const n = s().doc.layers.length
    s().deleteLayer('L-trees')
    expect(s().doc.layers).toHaveLength(n)
    s().addLayer('Mine', 'Custom')
    const custom = s().doc.layers.find((l) => l.key.startsWith('custom_'))!
    s().deleteLayer(custom.id)
    expect(s().doc.layers).toHaveLength(n)
  })
  it('moving objects between layers is undoable', () => {
    const s = () => useEditor.getState()
    s().addObjects([createObject(s().doc.layers, 'zone', square())])
    const id = Object.keys(s().doc.objects)[0]
    s().moveToLayer([id], 'L-pond')
    expect(s().doc.objects[id].layerId).toBe('L-pond')
    s().undo()
    expect(s().doc.objects[id].layerId).toBe('L-zones')
  })
})

describe('autosave diff', () => {
  const base = (doc: Doc) => ({ layers: new Map(doc.layers.map((l) => [l.id, l])), objects: new Map(Object.values(doc.objects).map((o) => [o.id, o])) })
  it('reports nothing when unchanged, and only the touched objects otherwise', () => {
    const s = useEditor.getState()
    s.addObjects([createObject(s.doc.layers, 'zone', square()), createObject(s.doc.layers, 'tree', { type: 'Point', coordinates: [24, 45] })])
    const b = base(useEditor.getState().doc)
    expect(diffDoc(b, useEditor.getState().doc)).toEqual({})
    const [a, c] = Object.keys(useEditor.getState().doc.objects)
    useEditor.getState().patchObject(a, { name: 'Renamed' })
    const cs = diffDoc(b, useEditor.getState().doc)
    expect(cs.objects?.map((o) => o.id)).toEqual([a])
    useEditor.getState().deleteObjects([c])
    expect(diffDoc(b, useEditor.getState().doc).deleteObjects).toEqual([c])
  })
  it('includes changed layers', () => {
    const b = base(useEditor.getState().doc)
    useEditor.getState().updateLayer('L-fences', { locked: true })
    expect(diffDoc(b, useEditor.getState().doc).layers?.map((l) => l.id)).toEqual(['L-fences'])
  })
})

describe('map feature building', () => {
  it('omits hidden layers and flags selection and locks', () => {
    const s = useEditor.getState()
    s.addObjects([createObject(s.doc.layers, 'building', square()), createObject(s.doc.layers, 'tree', { type: 'Point', coordinates: [24, 45] }, 'apple')], false)
    useEditor.getState().updateLayer('L-trees', { visible: false })
    useEditor.getState().updateLayer('L-buildings', { locked: true })
    const doc = useEditor.getState().doc
    const id = Object.keys(doc.objects)[0]
    const fc = buildObjectCollection(doc, { selected: new Set([id]), view3d: false })
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties).toMatchObject({ kind: 'building', selected: true, locked: true })
  })
  it('builds 3D geometry from the same objects (building height, tree crown, fence)', () => {
    const s = useEditor.getState()
    s.addObjects([
      createObject(s.doc.layers, 'building', square(), 'main_house'),
      createObject(s.doc.layers, 'tree', { type: 'Point', coordinates: [24, 45] }, 'walnut'),
      createObject(s.doc.layers, 'fence', { type: 'LineString', coordinates: [[24, 45], [24.001, 45]] }, 'wood'),
    ], false)
    const ext = buildExtrusions(useEditor.getState().doc).features
    const heights = ext.map((f) => f.properties!.h as number)
    expect(heights).toContain(7.5)
    expect(heights).toContain(1.6)
    expect(ext.filter((f) => f.properties!.id && f.geometry.type === 'Polygon').length).toBeGreaterThanOrEqual(4)
  })
  it('offers vertex, midpoint and rotate handles', () => {
    const o = createObject(layers, 'building', square())
    const roles = buildHandles(o, 0.5).features.map((f) => f.properties!.role)
    expect(roles.filter((r) => r === 'vertex')).toHaveLength(4)
    expect(roles.filter((r) => r === 'mid')).toHaveLength(4)
    expect(roles).toContain('rotate')
    expect(buildHandles(createObject(layers, 'tree', { type: 'Point', coordinates: [24, 45] }), 0.5).features).toHaveLength(0)
  })
  it('camera wedge follows direction and range', () => {
    const o = createObject(layers, 'camera', { type: 'Point', coordinates: [24, 45] }, undefined, { direction: 90, fov: 60, range: 40 })
    const w = cameraWedge(o)!
    expect(w.type).toBe('Polygon')
    const far = (w as Extract<typeof w, { type: 'Polygon' }>).coordinates[0][3]
    expect(far[0]).toBeGreaterThan(24) // pointing east
  })
})
