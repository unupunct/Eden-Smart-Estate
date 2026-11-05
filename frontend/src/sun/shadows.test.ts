import { describe, expect, it } from 'vitest'
import { polygonArea } from '../geo/measure'
import { fromLocal, toLocal } from '../geo/transform'
import type { Doc, EdenObject, Geom, Pos } from '../model/types'
import { buildCasters, foliageDensity, growingSeasonKeys, heatGrid, leafFactor, lightAt, lightClass, longAxisBearing, possibleHours, samplePolygon, shadowFeatures, sunHours, sunVector, sweepAll, type Caster, type XY } from './shadows'
import { fromWall } from './tz'

const O: Pos = [24.05, 46.05]
const layer = { id: 'L', key: 'x', name: 'x', group: 'x', color: '#fff', visible: true, locked: false, order: 0 }
const obj = (id: string, kind: string, geometry: Geom, props: Record<string, unknown> = {}): EdenObject => ({ id, layerId: 'L', kind, name: id, geometry, props })
const docOf = (...objs: EdenObject[]): Doc => ({ layers: [layer], objects: Object.fromEntries(objs.map((o) => [o.id, o])) })
const poly = (pts: XY[]): Geom => ({ type: 'Polygon', coordinates: [[...pts, pts[0]].map((p) => fromLocal(p, O))] })
const box = (cx: number, cy: number, w: number, h: number): XY[] => [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]]
const building = (props = { height: 10 }) => obj('b', 'building', poly(box(0, 0, 10, 10)), props)
const casters = (d: Doc, leaf = 1) => buildCasters(d, O, { leaf, ix: null })
const lit = (cs: Caster[], v: ReturnType<typeof sunVector>, p: XY) => lightAt(sweepAll(cs, v!), p)

describe('sun vector', () => {
  it('shadow length equals height / tan(elevation), pointing away from the sun', () => {
    const v = sunVector(180, 45)! // sun due south, 45 deg: shadow points due north, 1 m per metre
    expect(v.fx).toBeCloseTo(0, 9)
    expect(v.fy).toBeCloseTo(1, 9)
    const w = sunVector(90, 30)! // sun in the east: shadow points west
    expect(w.fx).toBeCloseTo(-1.732, 3)
    expect(w.fy).toBeCloseTo(0, 6)
  })
  it('has no shadows with the sun at or below the horizon, and caps grazing sun', () => {
    expect(sunVector(100, 0)).toBeNull()
    expect(sunVector(100, -10)).toBeNull()
    const v = sunVector(100, 0.6)!
    expect(Math.hypot(v.fx, v.fy)).toBeLessThanOrEqual(20.0001)
  })
})

describe('shadow of a building', () => {
  const cs = casters(docOf(building()))
  const v = sunVector(180, 45)
  it('falls on the north side for a southern sun, 10 m long for a 10 m wall at 45 deg', () => {
    expect(lit(cs, v, [0, 12])).toBe(0) // 7 m north of the wall: shaded
    expect(lit(cs, v, [0, 14.5])).toBe(0)
    expect(lit(cs, v, [0, 15.5])).toBe(1) // beyond the shadow tip
    expect(lit(cs, v, [0, -7])).toBe(1) // south of the house: sunny
    expect(lit(cs, v, [9, 10])).toBe(1) // sideways: sunny
  })
  it('has the area footprint + length x width = 200 m2 in the merged polygon', () => {
    const f = shadowFeatures(cs, v, O)
    expect(f.light).toHaveLength(0)
    const area = f.dense.reduce((s, x) => s + polygonArea((x.geometry as GeoJSON.Polygon).coordinates as Pos[][]), 0)
    expect(area).toBeGreaterThan(198)
    expect(area).toBeLessThan(202)
  })
  it('shadow is longer with a lower sun and moves with the sun azimuth', () => {
    expect(lit(cs, sunVector(180, 20), [0, 20])).toBe(0) // 10/tan20 = 27 m
    expect(lit(cs, sunVector(90, 30), [-20, 0])).toBe(0) // sun east: shadow to the west
    expect(lit(cs, sunVector(90, 30), [20, 0])).toBe(1)
  })
  it('produces nothing at night', () => {
    expect(shadowFeatures(cs, sunVector(0, -20), O).dense).toHaveLength(0)
  })
  it('matches a polygon-based check for a concave L-shaped house', () => {
    const L: XY[] = [[-6, -6], [6, -6], [6, 0], [0, 0], [0, 6], [-6, 6]]
    const lc = casters(docOf(obj('l', 'building', poly(L), { height: 6 })))
    const vec = sunVector(200, 30)!
    const swept = sweepAll(lc, vec)
    const f = shadowFeatures(lc, vec, O)
    const rings = f.dense.map((x) => (x.geometry as GeoJSON.Polygon).coordinates[0].map((p) => toLocal(p as Pos, O)))
    const inside = (p: XY) => rings.some((r) => {
      let ins = false
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i][1] > p[1] !== r[j][1] > p[1] && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) ins = !ins
      return ins
    })
    let mismatches = 0
    for (let x = -25; x <= 25; x += 1.3) for (let y = -25; y <= 25; y += 1.3) if (inside([x, y]) !== (lightAt(swept, [x, y]) < 0.5)) mismatches++
    expect(mismatches).toBeLessThan(6) // only boundary samples may disagree
  })
})

describe('trees, hedges, fences and glazing', () => {
  it('a tree shades a disk displaced along the sun vector; foliage lets light through', () => {
    const tree = obj('t', 'tree', { type: 'Point', coordinates: O }, { height: 10, canopy: 6 })
    const summer = casters(docOf(tree), 1)
    const winter = casters(docOf(tree), 0)
    const v = sunVector(180, 45)
    // crown spans 3..10 m up, so its shadow centre sits 3..10 m north; radius 3 m
    expect(lit(summer, v, [0, 7])).toBeCloseTo(1 - foliageDensity(false, 1), 6)
    expect(lit(winter, v, [0, 7])).toBeCloseTo(1 - foliageDensity(false, 0), 6)
    expect(lit(summer, v, [0, 20])).toBe(1)
    expect(lit(summer, v, [0, 7])).toBeLessThan(lit(winter, v, [0, 7]))
  })
  it('evergreens keep shading in winter', () => {
    expect(foliageDensity(true, 0)).toBeGreaterThan(0.8)
    expect(foliageDensity(false, 0)).toBeLessThan(0.3)
  })
  it('a 2 m fence casts a thin shadow of length height/tan(elevation)', () => {
    const fence = obj('f', 'fence', { type: 'LineString', coordinates: [fromLocal([-10, 0], O), fromLocal([10, 0], O)] }, { height: 2 })
    const cs = casters(docOf(fence))
    const v = sunVector(180, 30) // shadow 3.46 m north
    expect(lit(cs, v, [0, 2])).toBe(0)
    expect(lit(cs, v, [0, 4])).toBe(1)
    expect(lit(cs, v, [12, 2])).toBe(1)
  })
  it('a greenhouse lets part of the light through; overlapping shade multiplies', () => {
    const gh = obj('g', 'greenhouse', poly(box(0, 0, 4, 4)), { height: 3 })
    const house = obj('h', 'building', poly(box(0, 0, 4, 4)), { height: 3 })
    const v = sunVector(180, 45)
    expect(lit(casters(docOf(gh)), v, [0, 4])).toBeCloseTo(0.6, 6)
    expect(lit(casters(docOf(gh, house)), v, [0, 4])).toBe(0)
    const gh2 = obj('g2', 'greenhouse', poly(box(0, 0, 4, 4)), { height: 3 })
    expect(lit(casters(docOf(gh, gh2)), v, [0, 4])).toBeCloseTo(0.36, 6)
  })
  it('hidden layers cast no shadow', () => {
    const d = docOf(building())
    d.layers = [{ ...layer, visible: false }]
    expect(casters(d)).toHaveLength(0)
  })
})

describe('seasons and light classes', () => {
  it('leaves are on May-Sep in the north and Nov-Mar in the south', () => {
    expect(leafFactor(7, 46)).toBe(1)
    expect(leafFactor(1, 46)).toBe(0)
    expect(leafFactor(4, 46)).toBe(0.5)
    expect(leafFactor(1, -34)).toBe(1)
    expect(leafFactor(7, -34)).toBe(0)
  })
  it('classifies hours by the 6 / 4 / 2 rule', () => {
    expect(lightClass(7)).toBe('full')
    expect(lightClass(5)).toBe('part-sun')
    expect(lightClass(2.5)).toBe('part-shade')
    expect(lightClass(1)).toBe('shade')
  })
  it('growing season leaves out the winter solstice of the hemisphere', () => {
    expect(growingSeasonKeys(46)).not.toContain('dec')
    expect(growingSeasonKeys(-34)).not.toContain('jun')
  })
})

describe('sun hours', () => {
  const tz = 'Europe/Bucharest'
  const day = (m: number, d: number) => {
    const start = fromWall({ y: 2024, mo: m, d, h: 0, mi: 0 }, tz)
    return [start, fromWall({ y: 2024, mo: m, d: d + 1, h: 0, mi: 0 }, tz)] as const
  }
  it('open ground gets all the possible sun hours', () => {
    const [a, b] = day(6, 21)
    const h = sunHours([], [[0, 0]], a, b, O)[0]
    expect(h).toBeCloseTo(possibleHours(a, b, O), 6)
    expect(h).toBeGreaterThan(14)
  })
  it('midsummer gives far more than midwinter at this latitude', () => {
    const [a, b] = day(6, 21)
    const [c, d] = day(12, 21)
    expect(possibleHours(a, b, O)).toBeGreaterThan(possibleHours(c, d, O) + 5)
  })
  it('a point just north of a tall wall gets less sun than one just south', () => {
    const wall = obj('w', 'building', poly(box(0, 0, 20, 6)), { height: 9 })
    const cs = casters(docOf(wall))
    const [a, b] = day(3, 20)
    const [north, south] = sunHours(cs, [[0, 5], [0, -5]], a, b, O)
    expect(north).toBeLessThan(south - 3)
  })
  it('a sample grid lies inside the polygon and never comes back empty', () => {
    const ring = box(0, 0, 8, 3)
    const pts = samplePolygon(ring)
    expect(pts.length).toBeGreaterThan(10)
    for (const p of pts) {
      expect(Math.abs(p[0])).toBeLessThan(4)
      expect(Math.abs(p[1])).toBeLessThan(1.5)
    }
    expect(samplePolygon(box(0, 0, 0.1, 0.1))).toHaveLength(1)
  })
  it('heat grid covers the bounds with bounded cell counts', () => {
    const [a, b] = day(6, 21)
    const g = heatGrid(casters(docOf(building())), box(0, 0, 100, 80), O, a, b, 400)
    expect(g.cells.length).toBeLessThanOrEqual(500)
    expect(g.cells.length).toBeGreaterThan(100)
    const under = g.cells.reduce((m, c) => Math.min(m, c.hours), 99)
    expect(under).toBeLessThan(possibleHours(a, b, O))
  })
})

describe('pitched roofs', () => {
  const house = (props: Record<string, unknown>) => casters(docOf(obj('h', 'building', poly(box(0, 0, 10, 6)), { height: 7, ...props })))
  const v = sunVector(180, 30)! // sun due south, 30 deg: shadow factor 1.732 to the north

  it('a gable roof casts a shorter shadow than the same building as a box', () => {
    const flat = house({ roofType: 'flat' })
    const gable = house({ roofType: 'gable' }) // wall height defaults to 7 - 0.25 x 6 = 5.5; ridge along the long (east-west) side
    expect(lit(flat, v, [0, 14])).toBe(0) // box: 3 + 7 x 1.732 = 15.1 m
    expect(lit(gable, v, [0, 14])).toBe(1) // gable: tip at 3 + 5.5 x 1.732 = 12.5 m
    expect(lit(gable, v, [0, 11])).toBe(0)
    expect(lit(gable, v, [0, 3.5])).toBe(0)
  })
  it('splits into walls and a roof volume, and the merged shadow polygon is smaller than the box one', () => {
    const area = (cs: Caster[]) => shadowFeatures(cs, v, O).dense.reduce((s, x) => s + polygonArea((x.geometry as GeoJSON.Polygon).coordinates as Pos[][]), 0)
    const gable = house({ roofType: 'gable' })
    expect(gable.map((c) => c.shape.type).sort()).toEqual(['hull3', 'poly'])
    expect(area(gable)).toBeLessThan(area(house({ roofType: 'flat' })) - 10)
    expect(area(gable)).toBeGreaterThan(100)
  })
  it('uses the wall height when given', () => {
    const tall = house({ roofType: 'gable', eaveHeight: 6.5 }) // rise 0.5: nearly a box
    expect(lit(tall, v, [0, 14])).toBe(0)
    expect(house({ roofType: 'gable', eaveHeight: 7 })[0].shape.type).toBe('poly') // no rise: a box
  })
  it('hip roofs and ridge direction work; a shed roof needs its direction or stays a box', () => {
    expect(lit(house({ roofType: 'hip' }), v, [0, 14])).toBe(1)
    expect(house({ roofType: 'shed' }).map((c) => c.shape.type)).toEqual(['poly']) // direction unknown: safe overestimate
    const shed = house({ roofType: 'shed', roofOrientation: 90 })
    expect(shed.map((c) => c.shape.type).sort()).toEqual(['hull3', 'poly'])
    // ridge across the house (bearing 0, north-south): the shadow to the north is then the full short end, like a box edge
    const across = house({ roofType: 'gable', roofOrientation: 0 })
    expect(lit(across, v, [0, 14])).toBe(0)
  })
  it('long-axis detection follows the footprint', () => {
    expect(longAxisBearing(box(0, 0, 12, 4))).toBe(90) // long side east-west
    expect(longAxisBearing(box(0, 0, 4, 12))).toBe(0) // long side north-south
  })
  it('a pitched house gives the ground behind it more winter sun than a box would', () => {
    const start = fromWall({ y: 2025, mo: 12, d: 21, h: 0, mi: 0 }, 'Europe/Bucharest')
    const end = fromWall({ y: 2025, mo: 12, d: 22, h: 0, mi: 0 }, 'Europe/Bucharest')
    const [boxH] = sunHours(house({ roofType: 'flat' }), [[0, 19]], start, end, O)
    const [gableH] = sunHours(house({ roofType: 'gable' }), [[0, 19]], start, end, O)
    expect(gableH).toBeGreaterThan(boxH)
  })
})

describe('a neighbour next door', () => {
  const house = (kind: string) => obj('n', kind, poly(box(0, 12, 10, 8)), { height: 9, roofType: 'gable' }) // 12 m north of the origin, ridge east-west
  it('a neighbouring building shades a bed to its north exactly like one of your own buildings (same roof, same density)', () => {
    const bed = [0, 22] as XY // 6 m north of the neighbour's north wall
    const v = sunVector(180, 30)!
    const own = casters(docOf(house('building')))
    const theirs = casters(docOf(house('neighbour')))
    expect(theirs.map((c) => [c.shape.type, c.zb, c.zt, c.density])).toEqual(own.map((c) => [c.shape.type, c.zb, c.zt, c.density]))
    expect(theirs.length).toBe(2) // walls plus the roof volume
    expect(lit(theirs, v, bed)).toBe(lit(own, v, bed))
    expect(lit(theirs, v, bed)).toBe(0)
  })
  it('without the neighbour the same spot is in full sun, and a hidden neighbour layer casts nothing', () => {
    const v = sunVector(180, 30)!
    expect(lit(casters(docOf()), v, [0, 22])).toBe(1)
    const hidden: Doc = { layers: [{ ...layer, visible: false }], objects: { n: house('neighbour') } }
    expect(casters(hidden)).toHaveLength(0)
  })
})
