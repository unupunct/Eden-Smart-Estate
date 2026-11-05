// Pitched roofs for the 3D view. The map's extrusion layer can only draw flat-topped prisms, so a roof is drawn as a stack of thin
// prisms that follow the same roof the shadow model uses (sun/shadows.ts roofFrame): strips across the ridge for gable and shed
// roofs, nested rectangles for hip and mansard roofs. Each piece is the footprint cut to a rectangle, so L-shaped houses work too.
import polygonClipping from 'polygon-clipping'
import { roofFrame, type XY } from '../sun/shadows'

export interface RoofPiece {
  ring: XY[] // open ring, metres east / north of the same origin as the input
  base: number
  top: number
}

export const ROOF_STEPS = 14 // slices per roof half: the stair steps are a few centimetres to a few decimetres high

type Ring = [number, number][]
const closed = (r: XY[]): Ring => [...r, r[0]] as Ring

function cut(footprint: XY[], rect: XY[]): XY[][] {
  let out: [number, number][][][]
  try {
    out = polygonClipping.intersection([closed(footprint)], [closed(rect)]) as unknown as [number, number][][][]
  } catch {
    return []
  }
  return out.map((poly) => poly[0].slice(0, -1) as XY[]).filter((r) => r.length >= 3)
}

/** Wall height and the roof pieces on top of it, or null when the roof is flat or not modelled (the building is then a plain box). */
export function roofPieces(ring: XY[], height: number, props: Record<string, unknown>, steps = ROOF_STEPS): { eave: number; pieces: RoofPiece[] } | null {
  const f = roofFrame(ring, height, props)
  if (!f) return null
  const { ux, uy, vx, vy, umin, umax, vmin, vmax, span, eave, rise } = f
  const at = (u: number, v: number): XY => [u * ux + v * vx, u * uy + v * vy]
  const rect = (u0: number, u1: number, v0: number, v1: number): XY[] => [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)]
  const pieces: RoofPiece[] = []
  const add = (rect_: XY[], base: number, top: number) => {
    for (const r of cut(ring, rect_)) pieces.push({ ring: r, base, top })
  }
  if (f.type === 'gable' || f.type === 'shed') {
    const n = steps * 2
    const vm = (vmin + vmax) / 2
    for (let i = 0; i < n; i++) {
      const v0 = vmin + (span * i) / n, v1 = vmin + (span * (i + 1)) / n
      // each strip is as high as the roof is along its upper edge, so the ridge reaches exactly the building's height
      const t = f.type === 'gable' ? 1 - Math.min(Math.abs(v0 - vm), Math.abs(v1 - vm)) / (span / 2) : (Math.max(v0, v1) - vmin) / span
      add(rect(umin, umax, v0, v1), eave, eave + rise * t)
    }
  } else {
    // hip and mansard: nested rectangles, each one a step higher than the one around it
    const shape = (t: number) => (f.type === 'mansard' ? (t < 0.4 ? (0.8 * t) / 0.4 : 0.8 + (0.2 * (t - 0.4)) / 0.6) : t)
    for (let k = 0; k < steps; k++) {
      const d = ((span / 2) * k) / steps
      if (umax - umin - 2 * d < 0.05 || span - 2 * d < 0.05) break
      add(rect(umin + d, umax - d, vmin + d, vmax - d), eave + rise * shape(k / steps), eave + rise * shape((k + 1) / steps))
    }
  }
  return pieces.length ? { eave, pieces } : null
}
