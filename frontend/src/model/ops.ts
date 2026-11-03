import { KIND_MAP, kindDef, type KindDef } from './kinds'
import type { Doc, EdenObject, Geom, Layer, Pos, Props } from './types'
import { fromLocal, mapCoords, pivotOf, toLocal } from '../geo/transform'

/** Layer defaults mirror backend/app/layers.py (checked by a test). Used to decide if a layer colour is an override. */
export const LAYER_DEFAULT_COLORS: Record<string, string> = {
  boundary: '#ffd166', zones: '#9ad17a', buildings: '#f4a261', greenhouse: '#7bdff2', fences: '#c9a27a', roads: '#b8b8b0',
  trees: '#4cc38a', bushes: '#7ccf6e', garden_beds: '#8bd450', pond: '#4aa8ff', water_infra: '#3b82f6', electrical: '#facc15',
  cameras: '#f87171', outlets: '#fb923c', lighting: '#fde68a', solar: '#38bdf8', notes: '#e5e7eb',
}

export function newId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '')
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

export function layerForKind(layers: Layer[], kind: string): Layer | undefined {
  return layers.find((l) => l.key === kindDef(kind).layerKey)
}

export function createObject(layers: Layer[], kind: string, geometry: Geom, presetId?: string, extra: Props = {}): EdenObject {
  const def: KindDef = kindDef(kind)
  const preset = def.presets?.find((p) => p.id === presetId)
  const layer = layerForKind(layers, kind) ?? layers[0]
  return {
    id: newId(),
    layerId: layer.id,
    kind,
    name: preset?.name ?? def.label,
    geometry,
    props: { ...(def.defaults ?? {}), ...(preset?.props ?? {}), ...extra },
  }
}

/** Effective display colour: object colour, else a customised layer colour, else the kind colour. */
export function displayColor(o: EdenObject, layer: Layer | undefined): string {
  const c = o.props.color
  if (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) return c
  if (layer && LAYER_DEFAULT_COLORS[layer.key] !== undefined && layer.color.toLowerCase() !== LAYER_DEFAULT_COLORS[layer.key]) return layer.color
  if (layer && LAYER_DEFAULT_COLORS[layer.key] === undefined) return layer.color
  return KIND_MAP[o.kind]?.color ?? '#e5e7eb'
}

export function duplicateObject(o: EdenObject, offsetM = 3): EdenObject {
  const pivot = pivotOf(o.geometry)
  const geometry = mapCoords(o.geometry, (p: Pos) => {
    const [x, y] = toLocal(p, pivot)
    return fromLocal([x + offsetM, y - offsetM], pivot)
  })
  return { ...o, id: newId(), name: o.name ? `${o.name} (copy)` : '', geometry, props: { ...o.props } }
}

export const emptyDoc = (): Doc => ({ layers: [], objects: {} })

export function sortedLayers(layers: Layer[]): Layer[] {
  return [...layers].sort((a, b) => a.order - b.order)
}
