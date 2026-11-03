export type Pos = [number, number] // [lng, lat], WGS84

export type Geom =
  | { type: 'Point'; coordinates: Pos }
  | { type: 'LineString'; coordinates: Pos[] }
  | { type: 'Polygon'; coordinates: Pos[][] }

export type GeomType = Geom['type']
export type Props = Record<string, unknown>

/** One editable thing on the property. The single source of truth for both 2D and 3D. */
export interface EdenObject {
  id: string
  layerId: string
  kind: string
  name: string
  geometry: Geom
  props: Props
}

export interface Layer {
  id: string
  key: string
  name: string
  group: string
  color: string
  visible: boolean
  locked: boolean
  order: number
}

export interface Overlay {
  id: string
  name: string
  mime: string
  corners: Pos[] // TL, TR, BR, BL
  opacity: number
  visible: boolean
  url: string
}

export interface PropertyMeta {
  id: string
  name: string
  description: string
  center: Pos
  zoom: number
  bearing: number
  pitch: number
  baseMap: string
  isDemo: boolean
  objectCount?: number
}

export interface PropertyModel {
  property: PropertyMeta
  layers: Layer[]
  objects: EdenObject[]
  overlays: Overlay[]
}

/** Undoable part of the model. Immutable updates make snapshots cheap (structural sharing). */
export interface Doc {
  layers: Layer[]
  objects: Record<string, EdenObject>
}

export interface ProviderEntry {
  id: string
  name: string
  tiles: string
  attribution: string
  maxzoom: number
  available: boolean
}

export interface ProviderCatalog {
  providers: Record<string, ProviderEntry>
  satellite: string
  basemaps: Record<string, { label: string; layers: string[] }>
}
