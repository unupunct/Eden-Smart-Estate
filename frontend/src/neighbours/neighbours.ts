// Neighbouring buildings from OpenStreetMap: what the server found, which of it to add, and how it becomes ordinary map objects.
import { centroid } from '../geo/measure'
import { createObject } from '../model/ops'
import type { Doc, EdenObject, Pos } from '../model/types'

export interface Candidate {
  osmId: number
  ring: Pos[] // closed lng/lat ring
  areaM2: number
  distanceM: number
  height: number
  heightBasis: 'tag' | 'floors' | 'assumed'
  roofType: 'flat' | 'gable' | 'hip' | 'mansard'
  eaveHeight: number | null
  name: string
  buildingTag: string
}

export interface NeighbourReply {
  buildings: Candidate[]
  radiusM: number
  center: Pos
  source: { name: string; licence: string; attribution: string; url: string }
  sent: string
}

export const NEIGHBOUR_LAYER_NAME = 'Neighbouring buildings (OpenStreetMap)'
export const SOURCE_TEXT = 'OpenStreetMap contributors (ODbL)'
export const BASIS_TEXT: Record<Candidate['heightBasis'], string> = {
  tag: 'height given in OpenStreetMap',
  floors: 'estimated from the number of floors (3 m each)',
  assumed: 'assumed typical height: check it',
}

export async function searchNeighbours(propertyId: string, radiusM: number): Promise<NeighbourReply> {
  const r = await fetch(`/api/properties/${propertyId}/neighbours/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ radiusM }) })
  if (r.status === 401) { location.reload(); throw new Error('Login required') }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}))
    throw new Error(typeof j.detail === 'string' ? j.detail : r.statusText)
  }
  return (await r.json()) as NeighbourReply
}

function inRing(p: Pos, ring: Pos[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * Which candidates are really neighbours: not on your own land (centre inside the property boundary) and not something you have
 * already drawn or imported (centre inside one of your buildings, or the same OpenStreetMap id).
 */
export function newNeighbours(doc: Doc, found: Candidate[]): { fresh: Candidate[]; own: number; already: number } {
  const own: Pos[][] = []
  const mine: Pos[][] = []
  const known = new Set<number>()
  for (const o of Object.values(doc.objects)) {
    if (o.kind === 'neighbour' && typeof o.props.osmId === 'number') known.add(o.props.osmId)
    if (o.geometry.type !== 'Polygon') continue
    const ring = o.geometry.coordinates[0]
    if (o.kind === 'boundary') own.push(ring)
    else if (o.kind === 'building' || o.kind === 'greenhouse' || o.kind === 'neighbour') mine.push(ring)
  }
  const fresh: Candidate[] = []
  let ownN = 0, already = 0
  for (const c of found) {
    const mid = centroid({ type: 'Polygon', coordinates: [c.ring] })
    if (known.has(c.osmId) || mine.some((r) => inRing(mid, r))) already++
    else if (own.some((r) => inRing(mid, r))) ownN++
    else fresh.push(c)
  }
  return { fresh, own: ownN, already }
}

/** Ordinary, editable map objects for the chosen candidates, on the given layer. */
export function toObjects(layers: Doc['layers'], layerId: string, picked: Candidate[]): EdenObject[] {
  return picked.map((c) => {
    const o = createObject(layers, 'neighbour', { type: 'Polygon', coordinates: [c.ring] }, undefined, {
      name: c.name || 'Neighbouring building', height: c.height, roofType: c.roofType, ...(c.eaveHeight !== null ? { eaveHeight: c.eaveHeight } : {}),
      osmId: c.osmId, heightBasis: BASIS_TEXT[c.heightBasis], source: SOURCE_TEXT,
    })
    return { ...o, layerId }
  })
}
