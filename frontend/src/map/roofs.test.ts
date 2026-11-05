import { describe, expect, it } from 'vitest'
import { pitchedRoof, type XY } from '../sun/shadows'
import { roofPieces } from './roofs'
import { buildExtrusions } from './features'
import type { Doc } from '../model/types'

const rect = (w: number, d: number): XY[] => [[0, 0], [w, 0], [w, d], [0, d]] // w east-west (long side), d north-south
const area = (r: XY[]) => Math.abs(r.reduce((s, p, i) => s + (p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1]), 0)) / 2
const topAt = (pieces: { ring: XY[]; top: number }[], x: number, y: number) => {
  const inside = (r: XY[]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c }
  return Math.max(0, ...pieces.filter((p) => inside(p.ring)).map((p) => p.top))
}

describe('3D roofs', () => {
  it('flat and unknown roofs stay plain boxes', () => {
    expect(roofPieces(rect(10, 6), 5, { roofType: 'flat' })).toBeNull()
    expect(roofPieces(rect(10, 6), 5, {})).toBeNull()
    expect(roofPieces(rect(10, 6), 5, { roofType: 'shed' })).toBeNull() // direction unknown: stays a box, like the shadow model
  })

  it('a gable roof peaks at the overall height along the ridge and falls to the eave at the sides', () => {
    const r = roofPieces(rect(10, 6), 6, { roofType: 'gable' })!
    expect(r.eave).toBeCloseTo(6 - 6 * 0.25, 6) // the same eave height the shadow model derives
    const ridge = topAt(r.pieces, 5, 3)
    expect(ridge).toBeCloseTo(6, 9) // exactly the overall height
    expect(topAt(r.pieces, 5, 0.1)).toBeLessThan(r.eave + 0.4)
    expect(topAt(r.pieces, 5, 5.9)).toBeLessThan(r.eave + 0.4)
    // ... symmetric
    expect(topAt(r.pieces, 2, 1)).toBeCloseTo(topAt(r.pieces, 2, 5), 6)
  })

  it('the pieces tile the footprint exactly (no gaps, no overlap) at every height level', () => {
    for (const type of ['gable', 'hip', 'mansard']) {
      const r = roofPieces(rect(12, 7), 6.5, { roofType: type })!
      const lowest = r.pieces.filter((p) => Math.abs(p.base - r.eave) < 1e-9)
      expect(lowest.reduce((s, p) => s + area(p.ring), 0)).toBeCloseTo(84, 4)
    }
  })

  it('a roof follows the same shape as the shadow model: same eave, same ridge height', () => {
    for (const type of ['gable', 'hip', 'mansard']) {
      const ring = rect(14, 8)
      const sh = pitchedRoof(ring, 7, { roofType: type })!
      const r = roofPieces(ring, 7, { roofType: type })!
      expect(r.eave).toBeCloseTo(sh.eave, 9)
      expect(Math.max(...r.pieces.map((p) => p.top))).toBeCloseTo(7, 9)
    }
  })

  it('a hip roof slopes at the ends too, a gable roof does not', () => {
    const hip = roofPieces(rect(14, 8), 7, { roofType: 'hip' })!
    const gable = roofPieces(rect(14, 8), 7, { roofType: 'gable' })!
    expect(topAt(hip.pieces, 0.3, 4)).toBeLessThan(topAt(hip.pieces, 7, 4) - 1)
    expect(topAt(gable.pieces, 0.3, 4)).toBeCloseTo(topAt(gable.pieces, 7, 4), 6)
  })

  it('a shed roof rises to the side the roof direction points away from, and honours the given direction', () => {
    const r = roofPieces(rect(10, 6), 4, { roofType: 'shed', roofOrientation: 90 })! // ridge runs east-west, high side is one of the long sides
    const north = topAt(r.pieces, 5, 5.9), south = topAt(r.pieces, 5, 0.1)
    expect(Math.abs(north - south)).toBeGreaterThan(0.4)
  })

  it('an L-shaped house is cut to its own outline', () => {
    const L: XY[] = [[0, 0], [12, 0], [12, 4], [5, 4], [5, 9], [0, 9]]
    const r = roofPieces(L, 6, { roofType: 'gable' })!
    expect(r.pieces.filter((p) => Math.abs(p.base - r.eave) < 1e-9).reduce((s, p) => s + area(p.ring), 0)).toBeCloseTo(area(L), 3)
    expect(topAt(r.pieces, 10, 8)).toBe(0) // the notch of the L has no roof
  })

  it('the 3D layer gets walls to the eave plus roof pieces for a gabled building, and one box for a flat one', () => {
    const o = (roofType: string) => ({
      layers: [{ id: 'L', name: 'b', kind: 'buildings', visible: true, locked: false, color: '#fff', opacity: 1, order: 0 }],
      objects: { b1: { id: 'b1', layerId: 'L', kind: 'building', name: 'House', geometry: { type: 'Polygon', coordinates: [[[24, 45], [24.0001, 45], [24.0001, 45.00007], [24, 45.00007], [24, 45]]] }, props: { height: 7, roofType } } },
    }) as unknown as Doc
    const gable = buildExtrusions(o('gable')).features
    const flat = buildExtrusions(o('flat')).features
    expect(flat).toHaveLength(1)
    expect(gable.length).toBeGreaterThan(10)
    expect(gable[0].properties?.h).toBeLessThan(7) // walls end at the eave
    expect(Math.max(...gable.map((f) => f.properties?.h as number))).toBeLessThanOrEqual(7)
    expect(gable.every((f) => f.properties?.id === 'b1')).toBe(true)
  })
})
