import { centroid, distance, polygonArea } from '../geo/measure'
import { fromLocal, toLocal } from '../geo/transform'
import type { EdenObject, Geom, Pos } from '../model/types'
import type { AquaticPlant, Evidence, Fish, Level, Library, Planting, Plant, Relation, WaterReading } from './types'

// ------------------------------------------------------------------ index
export interface LibraryIndex {
  plants: Map<string, Plant>
  aquatic: Map<string, AquaticPlant>
  fish: Map<string, Fish>
  pair: Map<string, Relation>
  byPlant: Map<string, Relation[]>
}

const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export function buildIndex(lib: Library): LibraryIndex {
  const byPlant = new Map<string, Relation[]>()
  const pair = new Map<string, Relation>()
  for (const r of lib.companions) {
    pair.set(key(r.a, r.b), r)
    for (const id of [r.a, r.b]) byPlant.set(id, [...(byPlant.get(id) ?? []), r])
  }
  return {
    plants: new Map(lib.plants.map((p) => [p.id, p])),
    aquatic: new Map(lib.aquatic.map((p) => [p.id, p])),
    fish: new Map(lib.fish.map((f) => [f.id, f])),
    pair,
    byPlant,
  }
}

export function relationBetween(ix: LibraryIndex, a: string, b: string): Relation | undefined {
  return a === b ? undefined : ix.pair.get(key(a, b))
}

/**
 * green  = documented benefit/compatibility
 * yellow = conditional, or a benefit that is only mixed/traditional evidence ("potentially compatible")
 * red    = known incompatibility
 */
export function levelOf(r: Relation): Level {
  if (r.type === 'incompatible') return 'red'
  if (r.type === 'conditional') return 'yellow'
  return r.evidence === 'documented' ? 'green' : 'yellow'
}

export const LEVEL_COLOR: Record<Level, string> = { green: '#34d399', yellow: '#fbbf24', red: '#f87171' }
export const EVIDENCE_LABEL: Record<Evidence, string> = { documented: 'Documented', mixed: 'Mixed evidence', traditional: 'Traditional' }

export interface CompanionSuggestion {
  other: string
  rel: Relation
  level: Level
}

/** Everything the library says about one plant, best news first. */
export function companionsOf(ix: LibraryIndex, id: string): CompanionSuggestion[] {
  const order: Record<Level, number> = { green: 0, yellow: 1, red: 2 }
  return (ix.byPlant.get(id) ?? [])
    .map((rel) => ({ other: rel.a === id ? rel.b : rel.a, rel, level: levelOf(rel) }))
    .sort((x, y) => order[x.level] - order[y.level] || x.other.localeCompare(y.other))
}

// ------------------------------------------------------------------ garden beds
export interface BedAnalysis {
  total: number
  perPlanting: { planting: Planting; plant: Plant | undefined; room: number; spacing: number }[]
  pairs: { a: string; b: string; rel: Relation; level: Level }[]
  worst: Level | null
  crowded: boolean
}

/** Rough room for one species alone at its spacing, from bed area. A planting plan, not a guarantee. */
export function roomFor(areaM2: number, spacingCm: number): number {
  const s = Math.max(5, spacingCm) / 100
  return Math.floor(areaM2 / (s * s) + 1e-9) // epsilon: 10 / 0.1² is 999.999… in floating point
}

export function analyseBed(ix: LibraryIndex, areaM2: number, plantings: Planting[]): BedAnalysis {
  const perPlanting = plantings.map((p) => {
    const plant = ix.plants.get(p.speciesId)
    const spacing = p.spacing ?? plant?.spacing ?? 30
    return { planting: p, plant, spacing, room: roomFor(areaM2, spacing) }
  })
  const pairs: BedAnalysis['pairs'] = []
  for (let i = 0; i < plantings.length; i++) {
    for (let j = i + 1; j < plantings.length; j++) {
      const rel = relationBetween(ix, plantings[i].speciesId, plantings[j].speciesId)
      if (rel) pairs.push({ a: plantings[i].speciesId, b: plantings[j].speciesId, rel, level: levelOf(rel) })
    }
  }
  const rank: Record<Level, number> = { green: 0, yellow: 1, red: 2 }
  const worst = pairs.length ? pairs.reduce<Level>((w, p) => (rank[p.level] > rank[w] ? p.level : w), 'green') : null
  const total = plantings.reduce((s, p) => s + (p.count ?? 0), 0)
  // plants share the bed: the sum of each crop's share of the room should not exceed 1
  const used = perPlanting.reduce((s, p) => s + (p.room > 0 ? (p.planting.count ?? 0) / p.room : 0), 0)
  return { total, perPlanting, pairs, worst, crowded: used > 1.05 }
}

// ------------------------------------------------------------------ neighbours on the map
const PLANT_KINDS = new Set(['tree', 'bush', 'plant'])
/** Root/leaf-litter reach in metres for species that affect neighbours beyond the default distance. */
const REACH: Record<string, number> = { walnut: 15 }
export const DEFAULT_REACH = 6

export const reachOf = (speciesId: string) => REACH[speciesId] ?? DEFAULT_REACH

export function distanceToGeom(p: Pos, g: Geom): number {
  if (g.type === 'Point') return distance(p, g.coordinates)
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates
  if (g.type === 'Polygon' && pointInRing(p, ring)) return 0
  const [px, py] = [0, 0]
  let best = Infinity
  for (let i = 0; i < ring.length - 1; i++) {
    const a = toLocal(ring[i], p)
    const b = toLocal(ring[i + 1], p)
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l2 = dx * dx + dy * dy
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2))
    best = Math.min(best, Math.hypot(a[0] + t * dx - px, a[1] + t * dy - py))
  }
  return best
}

export function pointInRing(p: Pos, ring: Pos[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Species planted in an object: a single species for plants/trees/bushes, several for beds. */
export function speciesOf(o: EdenObject): string[] {
  if (PLANT_KINDS.has(o.kind)) return typeof o.props.speciesId === 'string' && o.props.speciesId ? [o.props.speciesId] : []
  if (o.kind === 'garden_bed' && Array.isArray(o.props.plantings)) return (o.props.plantings as Planting[]).map((p) => p.speciesId).filter(Boolean)
  return []
}

export interface NeighbourLink {
  other: EdenObject
  from: Pos
  to: Pos
  distance: number
  a: string
  b: string
  rel: Relation
  level: Level
}

/** Known relationships between the selected plant object and everything planted near it. */
export function neighbourLinks(ix: LibraryIndex, objects: Record<string, EdenObject>, id: string): NeighbourLink[] {
  const me = objects[id]
  if (!me) return []
  const mine = speciesOf(me)
  if (!mine.length) return []
  const myPos = centroid(me.geometry)
  const links: NeighbourLink[] = []
  for (const o of Object.values(objects)) {
    if (o.id === id) continue
    const theirs = speciesOf(o)
    if (!theirs.length) continue
    const d = o.kind === 'garden_bed' || me.kind === 'garden_bed' ? distanceToGeom(myPos, o.geometry) : distance(myPos, centroid(o.geometry))
    for (const a of mine) {
      for (const b of theirs) {
        const rel = relationBetween(ix, a, b)
        if (!rel) continue
        if (d > Math.max(reachOf(a), reachOf(b))) continue
        links.push({ other: o, from: myPos, to: centroid(o.geometry), distance: d, a, b, rel, level: levelOf(rel) })
      }
    }
  }
  return links.sort((x, y) => x.distance - y.distance)
}

// ------------------------------------------------------------------ orchard
export const treeAge = (plantedYear: unknown, now = new Date().getFullYear()): number | null =>
  typeof plantedYear === 'number' && plantedYear > 1800 && plantedYear <= now ? now - plantedYear : null

export type PollinationStatus = 'self-fertile' | 'partner-found' | 'partner-missing' | 'unknown-variety' | 'no-data'

export interface PollinationCheck {
  status: PollinationStatus
  partners: { tree: EdenObject; distance: number }[]
  note: string
}

export const POLLINATOR_RANGE_M = 50

/**
 * Same species, different named variety, within bee range. For species that do not need a partner we say so.
 * (Real compatibility depends on each cultivar's pollination group and flowering time - the note says so.)
 */
export function pollinationCheck(ix: LibraryIndex, objects: Record<string, EdenObject>, treeId: string): PollinationCheck {
  const t = objects[treeId]
  const sp = t && typeof t.props.speciesId === 'string' ? ix.plants.get(t.props.speciesId) : undefined
  if (!t || !sp || !sp.pollination) return { status: 'no-data', partners: [], note: 'Choose a library species to see pollination needs.' }
  const need = sp.pollination.selfFertile
  if (need === 'yes') return { status: 'self-fertile', partners: [], note: sp.pollination.note }
  const variety = String(t.props.variety ?? '').trim().toLowerCase()
  const here = centroid(t.geometry)
  const partners = Object.values(objects)
    .filter((o) => o.id !== treeId && o.kind === 'tree' && o.props.speciesId === sp.id)
    .map((o) => ({ tree: o, distance: distance(here, centroid(o.geometry)) }))
    .filter((p) => p.distance <= POLLINATOR_RANGE_M && String(p.tree.props.variety ?? '').trim().toLowerCase() !== variety)
    .sort((a, b) => a.distance - b.distance)
  if (!variety) return { status: 'unknown-variety', partners, note: 'Enter the variety to check for pollination partners. ' + sp.pollination.note }
  const known = partners.filter((p) => String(p.tree.props.variety ?? '').trim())
  if (known.length) return { status: 'partner-found', partners: known, note: 'Different variety nearby. Confirm that both flower at the same time (same pollination group). ' + sp.pollination.note }
  return { status: 'partner-missing', partners: [], note: sp.pollination.note }
}

export interface OrchardStats {
  trees: number
  bySpecies: { key: string; label: string; count: number; varieties: string[] }[]
  matureCanopyArea: number
  avgAge: number | null
  unknownSpecies: number
}

export function orchardStats(ix: LibraryIndex, objects: Record<string, EdenObject>, now = new Date().getFullYear()): OrchardStats {
  const trees = Object.values(objects).filter((o) => o.kind === 'tree')
  const map = new Map<string, { label: string; count: number; varieties: Set<string> }>()
  let canopy = 0
  let ages = 0
  let ageN = 0
  let unknown = 0
  for (const t of trees) {
    const sp = typeof t.props.speciesId === 'string' ? ix.plants.get(t.props.speciesId) : undefined
    const label = sp?.name ?? (String(t.props.species ?? '').trim() || 'Unknown')
    if (!sp) unknown++
    const k = sp?.id ?? `?${label.toLowerCase()}`
    const e = map.get(k) ?? { label, count: 0, varieties: new Set<string>() }
    e.count++
    const v = String(t.props.variety ?? '').trim()
    if (v) e.varieties.add(v)
    map.set(k, e)
    const c = matureCanopy(t, sp)
    canopy += Math.PI * (c / 2) ** 2
    const age = treeAge(t.props.plantedYear, now)
    if (age !== null) {
      ages += age
      ageN++
    }
  }
  return {
    trees: trees.length,
    bySpecies: [...map.entries()].map(([key2, e]) => ({ key: key2, label: e.label, count: e.count, varieties: [...e.varieties].sort() })).sort((a, b) => b.count - a.count),
    matureCanopyArea: canopy,
    avgAge: ageN ? ages / ageN : null,
    unknownSpecies: unknown,
  }
}

/** Canopy diameter at maturity (m): library value for the species, else the tree's own canopy. */
export function matureCanopy(t: EdenObject, sp?: Plant): number {
  const own = typeof t.props.canopy === 'number' ? t.props.canopy : 0
  return Math.max(sp?.canopy ?? 0, own)
}

/** Grid of positions inside a polygon (local metric frame, optional rotation and staggered rows). */
export function gridInPolygon(ring: Pos[], spacingAlong: number, spacingAcross: number, angleDeg: number, margin: number, stagger: boolean, cap = 1000): Pos[] {
  const origin = centroid({ type: 'Polygon', coordinates: [ring] })
  const local = ring.map((p) => toLocal(p, origin))
  const a = (angleDeg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const rot = local.map(([x, y]) => [x * c + y * s, -x * s + y * c] as [number, number])
  const xs = rot.map((p) => p[0])
  const ys = rot.map((p) => p[1])
  const out: Pos[] = []
  let row = 0
  for (let y = Math.min(...ys) + margin; y <= Math.max(...ys) - margin + 1e-9; y += spacingAcross, row++) {
    const offset = stagger && row % 2 === 1 ? spacingAlong / 2 : 0
    for (let x = Math.min(...xs) + margin + offset; x <= Math.max(...xs) - margin + 1e-9; x += spacingAlong) {
      const wx = x * c - y * s
      const wy = x * s + y * c
      const pos = fromLocal([wx, wy], origin)
      if (pointInRing(pos, ring) && edgeDistance([wx, wy], local) >= margin - 1e-6) out.push(pos)
      if (out.length >= cap) return out
    }
  }
  return out
}

function edgeDistance(p: [number, number], ring: [number, number][]): number {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l2 = dx * dx + dy * dy
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
    best = Math.min(best, Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]))
  }
  return best
}

// ------------------------------------------------------------------ greenhouse
export interface OrientedBox {
  length: number
  width: number
  bearing: number // compass bearing (0-180) of the long axis
  area: number
}

/** Smallest-area rotated rectangle around the polygon: its length, width and the compass direction of the long side. */
export function orientedBox(ring: Pos[]): OrientedBox {
  const origin = centroid({ type: 'Polygon', coordinates: [ring] })
  const pts = ring.slice(0, -1).map((p) => toLocal(p, origin))
  let best: OrientedBox = { length: 0, width: 0, bearing: 0, area: Infinity }
  for (let deg = 0; deg < 180; deg += 0.5) {
    const a = (deg * Math.PI) / 180
    const c = Math.cos(a)
    const s = Math.sin(a)
    const u = pts.map(([x, y]) => x * c + y * s)
    const v = pts.map(([x, y]) => -x * s + y * c)
    const w = Math.max(...u) - Math.min(...u)
    const h = Math.max(...v) - Math.min(...v)
    if (w * h < best.area - 1e-9) {
      // u axis direction in compass terms: x east, y north => bearing = atan2(east, north)
      const long = w >= h ? { ang: deg, len: w, wid: h } : { ang: deg + 90, len: h, wid: w }
      const bearing = (((90 - long.ang) % 180) + 180) % 180
      best = { length: long.len, width: long.wid, bearing, area: w * h }
    }
  }
  return best
}

export function compass(bearing: number): string {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return names[Math.round((((bearing % 360) + 360) % 360) / 45) % 8]
}

// ------------------------------------------------------------------ pond
export interface PondVolume {
  surface: number
  volume: number
  zoned: number
}

/**
 * Rough volume estimate for planning: each depth zone contributes area x depth; the remaining surface is assumed to
 * be a sloping bank averaging half the maximum depth. NOT a survey - use real measurements for liner and pump sizing.
 */
export function pondVolume(pond: EdenObject, zones: EdenObject[]): PondVolume {
  const surface = pond.geometry.type === 'Polygon' ? polygonArea(pond.geometry.coordinates) : 0
  const maxDepth = typeof pond.props.maxDepth === 'number' ? pond.props.maxDepth : 0
  let zoned = 0
  let vol = 0
  for (const z of zones) {
    if (z.geometry.type !== 'Polygon' || typeof z.props.depth !== 'number') continue
    const c = centroid(z.geometry)
    if (pond.geometry.type !== 'Polygon' || !pointInRing(c, pond.geometry.coordinates[0])) continue
    const a = polygonArea(z.geometry.coordinates)
    zoned += a
    vol += a * z.props.depth
  }
  zoned = Math.min(zoned, surface)
  vol += Math.max(0, surface - zoned) * (maxDepth / 2)
  return { surface, volume: vol, zoned }
}

export interface FishVerdict {
  level: 'ok' | 'caution' | 'bad'
  messages: string[]
}

export function fishVerdict(f: Fish, surfaceM2: number, qty: number): FishVerdict {
  const messages: string[] = []
  let level: FishVerdict['level'] = f.nsp === 'suitable' ? 'ok' : f.nsp === 'conditional' ? 'caution' : 'bad'
  if (f.nsp === 'unsuitable') messages.push(`${f.name} is unsuitable for a natural swimming pond. ${f.warning ?? ''}`.trim())
  else if (f.nsp === 'not_recommended') messages.push(`${f.name} is not recommended for a natural swimming pond. ${f.warning ?? ''}`.trim())
  else if (f.nsp === 'conditional') messages.push(f.warning ?? 'Only suitable under the conditions described in the species notes.')
  if (surfaceM2 > 0 && f.lengthCm >= 30 && surfaceM2 < 100) {
    messages.push(`Adults reach about ${f.lengthCm} cm; a pond of ${Math.round(surfaceM2)} m² is small for them.`)
    if (level === 'ok') level = 'caution'
  }
  if (f.native !== 'native') messages.push('Non-native species: check local regulations and never release it into natural waters.')
  if (qty > 20 && f.lengthCm >= 15) {
    messages.push('Large numbers of fish raise nutrient levels and encourage algae.')
    if (level === 'ok') level = 'caution'
  }
  return { level, messages }
}

export interface WaterIssue {
  field: string
  label: string
  message: string
}

export function waterIssues(r: WaterReading, ranges: Library['waterQuality']['ranges']): WaterIssue[] {
  const out: WaterIssue[] = []
  const check = (field: keyof WaterReading, key: string) => {
    const v = r[field]
    const rg = ranges[key]
    if (typeof v !== 'number' || !rg) return
    if (rg.min !== undefined && v < rg.min) out.push({ field, label: rg.label, message: `${rg.label} ${v}${rg.unit ? ' ' + rg.unit : ''} is below ${rg.min}. ${rg.note ?? ''}`.trim() })
    if (rg.max !== undefined && v > rg.max) out.push({ field, label: rg.label, message: `${rg.label} ${v}${rg.unit ? ' ' + rg.unit : ''} is above ${rg.max}. ${rg.note ?? ''}`.trim() })
    if (rg.warnAbove !== undefined && v > rg.warnAbove) out.push({ field, label: rg.label, message: `${rg.label} ${v}${rg.unit ? ' ' + rg.unit : ''} is above ${rg.warnAbove}. ${rg.note ?? ''}`.trim() })
  }
  check('tempC', 'tempC')
  check('ph', 'ph')
  check('oxygen', 'oxygen')
  check('ammonia', 'ammonia')
  check('nitrite', 'nitrite')
  check('nitrate', 'nitrate')
  return out
}

// ------------------------------------------------------------------ calendar helpers
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function monthRange(r: [number, number] | null | undefined): string {
  if (!r) return '—'
  return r[0] === r[1] ? MONTHS[r[0] - 1] : `${MONTHS[r[0] - 1]}–${MONTHS[r[1] - 1]}`
}
