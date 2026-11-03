import { describe, expect, it } from 'vitest'
import type { EdenObject, Pos } from '../model/types'
import { circlePolygon, rectPolygon, rotate } from '../geo/transform'
import { polygonArea } from '../geo/measure'
import { analyseBed, buildIndex, companionsOf, fishVerdict, gridInPolygon, levelOf, monthRange, neighbourLinks, orchardStats, orientedBox, pollinationCheck, pondVolume, relationBetween, roomFor, treeAge, waterIssues } from './logic'
import type { Fish, Library, Plant, Relation } from './types'

const plant = (id: string, extra: Partial<Plant> = {}): Plant => ({
  id, name: id, ro: null, sci: id, family: 'F', cats: [], native: 'introduced', edible: 'yes', sun: 'full', water: 'medium', height: 1, spacing: 30,
  flower: null, harvest: null, sow: null, soil: '', zone: null, canopy: null, prop: '', wildlife: '', root: 'medium', shadeTol: false, notes: '',
  med: null, tox: null, pollination: null, place: 'plant', leaf: 'deciduous', ...extra,
})
const rel = (a: string, b: string, type: Relation['type'], evidence: Relation['evidence']): Relation => ({ a, b, type, evidence, note: 'x'.repeat(30) })

const lib: Library = {
  version: 't', disclaimers: { data: '', evidence: { documented: '', mixed: '', traditional: '' }, medicinal: '', mushrooms: '' },
  plants: [
    plant('tomato'), plant('basil'), plant('marigold'), plant('potato'), plant('walnut', { place: 'tree', canopy: 12 }), plant('carrot'),
    plant('apple', { place: 'tree', canopy: 4.5, spacing: 500, pollination: { selfFertile: 'no', note: 'needs partner' } }),
    plant('apricot', { place: 'tree', canopy: 4, pollination: { selfFertile: 'yes', note: 'self' } }),
  ],
  aquatic: [], fish: [], mushrooms: [],
  companions: [rel('tomato', 'basil', 'compatible', 'traditional'), rel('tomato', 'marigold', 'pest', 'documented'), rel('tomato', 'potato', 'incompatible', 'documented'),
    rel('tomato', 'walnut', 'incompatible', 'documented'), rel('tomato', 'carrot', 'conditional', 'mixed')],
  waterQuality: { note: '', ranges: { ph: { label: 'pH', unit: '', min: 6.5, max: 8.5 }, oxygen: { label: 'Oxygen', unit: 'mg/L', min: 5 }, tempC: { label: 'Temp', unit: '°C', warnAbove: 28 }, ammonia: { label: 'Ammonia', unit: 'mg/L', max: 0.25 }, nitrite: { label: 'Nitrite', unit: 'mg/L', max: 0.1 }, nitrate: { label: 'Nitrate', unit: 'mg/L', max: 25 } } },
}
const ix = buildIndex(lib)
const at = (id: string, kind: string, props: Record<string, unknown>, pos: Pos): EdenObject => ({ id, layerId: 'L', kind, name: id, geometry: { type: 'Point', coordinates: pos }, props })
const east = (m: number): Pos => [24 + m / (111195 * Math.cos((45 * Math.PI) / 180)), 45]

describe('companion levels', () => {
  it('maps relationships to green/yellow/red honestly', () => {
    expect(levelOf(relationBetween(ix, 'tomato', 'marigold')!)).toBe('green') // documented
    expect(levelOf(relationBetween(ix, 'basil', 'tomato')!)).toBe('yellow') // traditional only: "potentially compatible"
    expect(levelOf(relationBetween(ix, 'tomato', 'carrot')!)).toBe('yellow') // conditional
    expect(levelOf(relationBetween(ix, 'potato', 'tomato')!)).toBe('red')
    expect(relationBetween(ix, 'tomato', 'tomato')).toBeUndefined()
  })
  it('lists a plant\'s companions best first and conflicts last', () => {
    const list = companionsOf(ix, 'tomato')
    expect(list[0].level).toBe('green')
    expect(list[list.length - 1].level).toBe('red')
    expect(list.map((c) => c.other)).toContain('basil')
  })
})

describe('garden bed analysis', () => {
  it('computes room from area and spacing', () => {
    expect(roomFor(10, 50)).toBe(40)
    expect(roomFor(10, 10)).toBe(1000)
  })
  it('flags conflicting crops, worst level and crowding', () => {
    const a = analyseBed(ix, 10, [{ speciesId: 'tomato', count: 20 }, { speciesId: 'potato', count: 5 }, { speciesId: 'basil', count: 5 }])
    expect(a.pairs).toHaveLength(2)
    expect(a.worst).toBe('red')
    expect(a.total).toBe(30)
    const crowded = analyseBed(ix, 1, [{ speciesId: 'tomato', count: 20, spacing: 50 }])
    expect(crowded.crowded).toBe(true)
    expect(analyseBed(ix, 10, [{ speciesId: 'tomato', count: 4, spacing: 50 }]).crowded).toBe(false)
  })
})

describe('neighbour checks on the map', () => {
  const objs = (m: number) => ({ a: at('a', 'plant', { speciesId: 'tomato' }, east(0)), b: at('b', 'plant', { speciesId: 'basil' }, east(m)) })
  it('links plants within reach and ignores far ones', () => {
    expect(neighbourLinks(ix, objs(3), 'a')).toHaveLength(1)
    expect(neighbourLinks(ix, objs(3), 'a')[0].level).toBe('yellow')
    expect(neighbourLinks(ix, objs(20), 'a')).toHaveLength(0)
  })
  it('gives walnut a long reach because of juglone', () => {
    const o = { a: at('a', 'plant', { speciesId: 'tomato' }, east(0)), w: at('w', 'tree', { speciesId: 'walnut' }, east(12)) }
    const l = neighbourLinks(ix, o, 'a')
    expect(l).toHaveLength(1)
    expect(l[0].level).toBe('red')
    expect(neighbourLinks(ix, { ...o, w: at('w', 'tree', { speciesId: 'walnut' }, east(30)) }, 'a')).toHaveLength(0)
  })
  it('works against garden beds with several plantings', () => {
    const bed: EdenObject = { id: 'bed', layerId: 'L', kind: 'garden_bed', name: 'bed', props: { plantings: [{ speciesId: 'potato' }, { speciesId: 'basil' }] }, geometry: rectPolygon(east(2), [east(6)[0], 45.00003]) }
    const l = neighbourLinks(ix, { t: at('t', 'plant', { speciesId: 'tomato' }, east(0)), bed }, 't')
    expect(l.map((x) => x.level).sort()).toEqual(['red', 'yellow'])
  })
  it('ignores objects without a species', () => {
    expect(neighbourLinks(ix, { a: at('a', 'plant', {}, east(0)), b: at('b', 'plant', { speciesId: 'basil' }, east(1)) }, 'a')).toEqual([])
  })
})

describe('orchard', () => {
  const tree = (id: string, variety: string, m: number, sp = 'apple', year?: number): EdenObject => at(id, 'tree', { speciesId: sp, variety, plantedYear: year, canopy: 3 }, east(m))
  it('finds pollination partners of another variety within range', () => {
    const o = { a: tree('a', 'Jonathan', 0), b: tree('b', 'Golden', 20), c: tree('c', 'Jonathan', 5) }
    const r = pollinationCheck(ix, o, 'a')
    expect(r.status).toBe('partner-found')
    expect(r.partners.map((p) => p.tree.id)).toEqual(['b'])
    expect(r.note).toContain('pollination group')
  })
  it('reports missing partners, out of range partners, missing variety and self-fertile species', () => {
    expect(pollinationCheck(ix, { a: tree('a', 'Jonathan', 0), b: tree('b', 'Golden', 80) }, 'a').status).toBe('partner-missing')
    expect(pollinationCheck(ix, { a: tree('a', 'Jonathan', 0), c: tree('c', 'Jonathan', 5) }, 'a').status).toBe('partner-missing')
    expect(pollinationCheck(ix, { a: tree('a', '', 0), b: tree('b', 'Golden', 5) }, 'a').status).toBe('unknown-variety')
    expect(pollinationCheck(ix, { a: tree('a', 'x', 0, 'apricot') }, 'a').status).toBe('self-fertile')
    expect(pollinationCheck(ix, { a: at('a', 'tree', {}, east(0)) }, 'a').status).toBe('no-data')
  })
  it('computes ages and statistics', () => {
    expect(treeAge(2020, 2026)).toBe(6)
    expect(treeAge(undefined, 2026)).toBeNull()
    expect(treeAge(2100, 2026)).toBeNull()
    const s = orchardStats(ix, { a: tree('a', 'J', 0, 'apple', 2016), b: tree('b', 'G', 9, 'apple', 2020), c: tree('c', '', 18, 'apricot', 2018), d: at('d', 'tree', { species: 'Mystery' }, east(30)) }, 2026)
    expect(s.trees).toBe(4)
    expect(s.bySpecies[0]).toMatchObject({ label: 'apple', count: 2 })
    expect(s.bySpecies[0].varieties).toEqual(['G', 'J'])
    expect(s.avgAge).toBeCloseTo((10 + 6 + 8) / 3)
    expect(s.unknownSpecies).toBe(1)
    expect(s.matureCanopyArea).toBeGreaterThan(Math.PI * 2.25 * 2) // library canopies beat the tree's own 3 m
  })
})

describe('orchard grid', () => {
  const field = rectPolygon([24, 45], [24.001, 45.0005]) as Extract<ReturnType<typeof rectPolygon>, { type: 'Polygon' }> // ~79 x 56 m
  it('fills a polygon with correctly spaced points', () => {
    const pts = gridInPolygon(field.coordinates[0], 8, 8, 0, 4, false)
    expect(pts.length).toBeGreaterThan(40)
    expect(pts.length).toBeLessThan(80)
    // spacing between neighbours in one row is 8 m
    const row = pts.filter((p) => Math.abs(p[1] - pts[0][1]) < 1e-9)
    const d = Math.hypot((row[1][0] - row[0][0]) * 111195 * Math.cos((45 * Math.PI) / 180), 0)
    expect(d).toBeCloseTo(8, 1)
  })
  it('keeps every point inside and away from the edge by the margin', () => {
    const margin = 5
    const pts = gridInPolygon(field.coordinates[0], 6, 6, 20, margin, true)
    expect(pts.length).toBeGreaterThan(0)
    const [w, s, e, n] = [24, 45, 24.001, 45.0005]
    const mLng = (margin / (111195 * Math.cos((45 * Math.PI) / 180))) * 0.98
    const mLat = (margin / 111195) * 0.98
    for (const p of pts) {
      expect(p[0]).toBeGreaterThanOrEqual(w + mLng)
      expect(p[0]).toBeLessThanOrEqual(e - mLng)
      expect(p[1]).toBeGreaterThanOrEqual(s + mLat)
      expect(p[1]).toBeLessThanOrEqual(n - mLat)
    }
  })
  it('stagger yields more offset rows and respects the cap', () => {
    expect(gridInPolygon(field.coordinates[0], 6, 6, 0, 3, false, 10)).toHaveLength(10)
    const plain = gridInPolygon(field.coordinates[0], 6, 6, 0, 3, false)
    const stag = gridInPolygon(field.coordinates[0], 6, 6, 0, 3, true)
    expect(Math.abs(stag.length - plain.length)).toBeLessThan(plain.length * 0.2)
    expect(stag).not.toEqual(plain)
  })
  it('does not place points outside a concave polygon', () => {
    const L: Pos[] = [[24, 45], [24.001, 45], [24.001, 45.0002], [24.0002, 45.0002], [24.0002, 45.001], [24, 45.001], [24, 45]]
    for (const p of gridInPolygon(L, 5, 5, 0, 2, false)) expect(p[0] > 24.0002 && p[1] > 45.0002).toBe(false)
  })
})

describe('greenhouse geometry', () => {
  it('finds length, width and long-axis bearing of a rotated rectangle', () => {
    const base = rectPolygon([24, 45], [24.00013, 45.00005]) // ~10 m (E-W) x 5.5 m
    const g = base as Extract<typeof base, { type: 'Polygon' }>
    const flat = orientedBox(g.coordinates[0])
    expect(flat.length).toBeCloseTo(10.2, 0)
    expect(flat.width).toBeCloseTo(5.6, 0)
    expect(Math.abs(flat.bearing - 90)).toBeLessThan(1) // long side runs east-west
    const rot = rotate(base, 30) as Extract<typeof base, { type: 'Polygon' }>
    const r = orientedBox(rot.coordinates[0])
    expect(r.length).toBeCloseTo(flat.length, 0)
    expect(r.width).toBeCloseTo(flat.width, 0)
    expect(Math.abs(r.bearing - 120)).toBeLessThan(1.5) // rotated clockwise by 30 degrees
  })
})

describe('pond estimates', () => {
  const pond: EdenObject = { id: 'p', layerId: 'L', kind: 'pond', name: 'p', props: { maxDepth: 2 }, geometry: circlePolygon([24, 45], 10) }
  const zone = (r: number, depth: number, at2: Pos = [24, 45]): EdenObject => ({ id: `z${r}`, layerId: 'L', kind: 'pond_zone', name: 'z', props: { depth }, geometry: circlePolygon(at2, r) })
  it('combines depth zones with a half-depth assumption for the rest', () => {
    const v = pondVolume(pond, [zone(5, 2)])
    const total = polygonArea((pond.geometry as Extract<typeof pond.geometry, { type: 'Polygon' }>).coordinates)
    const z = Math.PI * 25
    expect(v.surface).toBeCloseTo(total, 3)
    expect(v.volume).toBeCloseTo(z * 2 + (total - z) * 1, -1)
  })
  it('without zones uses half of maximum depth over the surface; ignores zones outside the pond', () => {
    const v = pondVolume(pond, [])
    expect(v.volume).toBeCloseTo(v.surface * 1, 3)
    expect(pondVolume(pond, [zone(3, 5, [24.01, 45])]).zoned).toBe(0)
  })
})

describe('fish and water quality', () => {
  const fish = (nsp: Fish['nsp'], extra: Partial<Fish> = {}): Fish => ({ id: 'f', name: 'Fish', sci: '', native: 'native', nsp, lengthCm: 10, tempC: [4, 25], diet: '', notes: '', warning: 'w', ...extra })
  it('never calls unsuitable species fine', () => {
    expect(fishVerdict(fish('unsuitable', { native: 'introduced' }), 500, 3).level).toBe('bad')
    expect(fishVerdict(fish('not_recommended'), 500, 3).level).toBe('bad')
    expect(fishVerdict(fish('conditional'), 500, 3).level).toBe('caution')
    expect(fishVerdict(fish('suitable'), 500, 3).level).toBe('ok')
  })
  it('adds size, non-native and overstocking cautions', () => {
    expect(fishVerdict(fish('suitable', { lengthCm: 40 }), 50, 2).level).toBe('caution')
    expect(fishVerdict(fish('suitable', { native: 'introduced' }), 500, 2).messages.join(' ')).toContain('Non-native')
    expect(fishVerdict(fish('suitable', { lengthCm: 20 }), 500, 30).level).toBe('caution')
  })
  it('flags readings outside the general ranges', () => {
    const issues = waterIssues({ date: 'd', ph: 9.1, oxygen: 3, tempC: 30, ammonia: 0.5, nitrite: 0, nitrate: 10 }, lib.waterQuality.ranges)
    expect(issues.map((i) => i.field).sort()).toEqual(['ammonia', 'oxygen', 'ph', 'tempC'])
    expect(waterIssues({ date: 'd', ph: 7.5, oxygen: 8, tempC: 20 }, lib.waterQuality.ranges)).toEqual([])
  })
})

describe('formatting', () => {
  it('formats month ranges', () => {
    expect(monthRange([6, 9])).toBe('Jun–Sep')
    expect(monthRange([5, 5])).toBe('May')
    expect(monthRange(null)).toBe('—')
  })
})
