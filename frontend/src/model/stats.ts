import { measureGeom } from '../geo/measure'
import type { Doc } from './types'

export function estateStats(doc: Doc) {
  let boundaryArea = 0, boundaryPerimeter = 0, fenceLen = 0, roadLen = 0, pondArea = 0, bedArea = 0, buildingArea = 0
  const counts: Record<string, number> = {}
  for (const o of Object.values(doc.objects)) {
    counts[o.kind] = (counts[o.kind] ?? 0) + 1
    const m = measureGeom(o.geometry)
    if (o.kind === 'boundary') { boundaryArea += m.area; boundaryPerimeter += m.perimeter }
    else if (o.kind === 'fence' || o.kind === 'hedge') fenceLen += m.perimeter
    else if (o.kind === 'road' || o.kind === 'path') roadLen += m.perimeter
    else if (o.kind === 'pond') pondArea += m.area
    else if (o.kind === 'garden_bed') bedArea += m.area
    else if (o.kind === 'building' || o.kind === 'greenhouse') buildingArea += m.area
  }
  return { boundaryArea, boundaryPerimeter, fenceLen, roadLen, pondArea, bedArea, buildingArea, counts }
}
