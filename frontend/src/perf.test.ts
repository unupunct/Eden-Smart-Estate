// Performance guard: a big estate (about 3000 objects) must stay responsive. Limits are generous (roughly 5-10x what a
// laptop needs) so the test only fails on a real regression, not on a slow CI machine.
import { describe, expect, it } from 'vitest'
import { fromLocal } from './geo/transform'
import { buildExtrusions, buildObjectCollection } from './map/features'
import { diffDoc } from './model/autosave'
import { duplicateObject, emptyDoc } from './model/ops'
import type { Doc, EdenObject, Pos } from './model/types'
import { analyseAreas, buildCasters, heatGrid, shadowFeatures, sunVector } from './sun/shadows'
import { sunPosition } from './sun/astro'

const O: Pos = [24.05, 46.05]
const layers = ['trees', 'buildings', 'fences', 'garden_beds'].map((key, i) => ({ id: `L${i}`, key, name: key, group: 'x', color: '#4cc38a', visible: true, locked: false, order: i }))

function bigDoc(n: number): Doc {
  const objects: Record<string, EdenObject> = {}
  const add = (o: EdenObject) => { objects[o.id] = o }
  const side = Math.ceil(Math.sqrt(n))
  for (let i = 0; i < n; i++) {
    const x = (i % side) * 12 - (side * 6)
    const y = Math.floor(i / side) * 12 - (side * 6)
    const kind = i % 10 === 0 ? 'building' : i % 10 === 1 ? 'fence' : i % 10 === 2 ? 'garden_bed' : 'tree'
    const p = (dx: number, dy: number) => fromLocal([x + dx, y + dy], O)
    if (kind === 'tree') add({ id: `o${i}`, layerId: 'L0', kind, name: `Tree ${i}`, geometry: { type: 'Point', coordinates: p(0, 0) }, props: { canopy: 4, height: 6 } })
    else if (kind === 'fence') add({ id: `o${i}`, layerId: 'L2', kind, name: `Fence ${i}`, geometry: { type: 'LineString', coordinates: [p(0, 0), p(8, 0), p(8, 5)] }, props: { height: 1.6 } })
    else add({ id: `o${i}`, layerId: kind === 'building' ? 'L1' : 'L3', kind, name: `${kind} ${i}`, geometry: { type: 'Polygon', coordinates: [[p(0, 0), p(8, 0), p(8, 6), p(0, 6), p(0, 0)]] }, props: { height: 6 } })
  }
  return { ...emptyDoc(), layers, objects }
}

const time = <T,>(f: () => T): [T, number] => {
  const t = performance.now()
  const r = f()
  return [r, performance.now() - t]
}

describe('large property', () => {
  const doc = bigDoc(3000)
  it('builds the map collection and 3D extrusions quickly', () => {
    const [fc, ms] = time(() => buildObjectCollection(doc, { selected: new Set(), view3d: false }))
    expect(fc.features.length).toBe(3000)
    expect(ms).toBeLessThan(1500)
    const [ext, ms3] = time(() => buildExtrusions(doc))
    expect(ext.features.length).toBeGreaterThan(3000)
    expect(ms3).toBeLessThan(1500)
  })
  it('diffs a change against the saved baseline without touching unchanged objects', () => {
    const base = new Map(Object.entries(doc.objects))
    const first = Object.keys(doc.objects)[0]
    const next: Doc = { ...doc, objects: { ...doc.objects, [first]: { ...doc.objects[first], name: 'renamed' } } }
    const [cs, ms] = time(() => diffDoc({ objects: base, layers: new Map(doc.layers.map((l) => [l.id, l])) }, next))
    expect(cs.objects?.length).toBe(1)
    expect(ms).toBeLessThan(250)
  })
  it('duplicates an object cheaply', () => {
    const [, ms] = time(() => { for (let i = 0; i < 500; i++) duplicateObject(doc.objects.o0) })
    expect(ms).toBeLessThan(500)
  })
  it('projects and merges shadows of the whole estate in well under a few seconds', () => {
    const pos = sunPosition(Date.UTC(2025, 5, 21, 14), O[1], O[0])
    const [casters, msC] = time(() => buildCasters(doc, O, { leaf: 1, ix: null }))
    expect(casters.length).toBeGreaterThan(2500)
    expect(msC).toBeLessThan(1500)
    const [f, ms] = time(() => shadowFeatures(casters, sunVector(pos.az, pos.alt), O))
    expect(f.dense.length).toBeGreaterThan(0)
    expect(ms).toBeLessThan(6000)
  })
  it('computes sun hours for many beds and a heat map of a large site', () => {
    const casters = buildCasters(doc, O, { leaf: 1, ix: null })
    const ids = Object.values(doc.objects).filter((o) => o.kind === 'garden_bed').slice(0, 30).map((o) => o.id)
    const start = Date.UTC(2025, 5, 21, 0)
    const [res, ms] = time(() => analyseAreas(doc, ids, casters, start, start + 86400000, O, { stepMin: 30 }))
    expect(res).toHaveLength(30)
    expect(ms).toBeLessThan(15000)
    const box: [number, number][] = [[-400, -400], [400, -400], [400, 400], [-400, 400]]
    const [g, ms2] = time(() => heatGrid(casters, box, O, start, start + 86400000, 800, { stepMin: 60 }))
    expect(g.cells.length).toBeGreaterThan(100)
    expect(ms2).toBeLessThan(15000)
  })
})
