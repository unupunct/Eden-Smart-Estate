export interface Pollination {
  selfFertile: 'yes' | 'no' | 'partial' | 'varies'
  note: string
}

/** What was checked against GBIF (open biodiversity data) by scripts/verify-taxonomy.py. */
export interface Taxon {
  gbif: number
  name: string // GBIF's name for the entry the library's name matched
  authorship: string
  family: string | null
  status: string // ACCEPTED, SYNONYM, ...
  acceptedName?: string // set when the library's name is a synonym in GBIF
  checked: string | null
  ro?: { verdict: 'native' | 'introduced' | 'conflict' | 'casual' | 'unknown'; native: string[]; introduced: string[] } // plants only
}

export interface Plant {
  id: string
  taxon?: Taxon | null
  name: string
  ro: string | null
  sci: string
  family: string
  cats: string[]
  native: 'native' | 'naturalised' | 'introduced'
  edible: 'yes' | 'parts' | 'no' | 'toxic'
  sun: 'full' | 'full-part' | 'part' | 'shade'
  water: 'low' | 'medium' | 'high'
  height: number
  spacing: number // cm
  flower: [number, number] | null
  harvest: [number, number] | null
  sow: [number, number] | null
  soil: string
  zone: number | null
  canopy: number | null
  prop: string
  wildlife: string
  root: string
  shadeTol: boolean
  notes: string
  med: string | null
  tox: string | null
  pollination: Pollination | null
  place: 'tree' | 'bush' | 'plant'
  leaf: 'deciduous' | 'evergreen' // for woody plants: whether they shade in winter
}

export interface AquaticPlant {
  id: string
  taxon?: Taxon | null
  name: string
  sci: string
  native: string
  zone: 'oxygenating' | 'floating' | 'marginal' | 'shallow' | 'deep'
  depthCm: [number, number]
  vigour: 'low' | 'medium' | 'high'
  flower: [number, number] | null
  sun: string
  notes: string
  avoid: string | null
  wildlife: string
  tox: string | null
}

export type NspSuitability = 'suitable' | 'conditional' | 'not_recommended' | 'unsuitable'

export interface Fish {
  id: string
  taxon?: Taxon | null
  name: string
  sci: string
  native: string
  nsp: NspSuitability
  lengthCm: number
  tempC: [number, number]
  diet: string
  notes: string
  warning: string | null
}

export type MushroomStatus = 'edible' | 'edible_cooked' | 'inedible' | 'poisonous' | 'deadly'

export interface Mushroom {
  id: string
  taxon?: Taxon | null
  name: string
  ro: string | null
  sci: string
  status: MushroomStatus
  season: [number, number]
  habitat: string
  substrate: string
  lookalikes: string
  warning: string
  cultivation: 'none' | 'easy' | 'moderate' | 'difficult'
  cultivationNote: string
}

export type RelationType = 'beneficial' | 'pest' | 'nutrient' | 'compatible' | 'conditional' | 'incompatible'
export type Evidence = 'documented' | 'mixed' | 'traditional'

export interface Relation {
  a: string
  b: string
  type: RelationType
  evidence: Evidence
  note: string
}

export interface WaterRange {
  label: string
  unit: string
  min?: number
  max?: number
  warnAbove?: number
  note?: string
}

export interface Library {
  version: string
  disclaimers: { data: string; evidence: Record<Evidence, string>; medicinal: string; mushrooms: string }
  plants: Plant[]
  aquatic: AquaticPlant[]
  fish: Fish[]
  mushrooms: Mushroom[]
  companions: Relation[]
  waterQuality: { note: string; ranges: Record<string, WaterRange> }
  taxaSource?: { taxonomy: string; distribution: string; checkedOn: string } | null
}

export type Level = 'green' | 'yellow' | 'red'

/** One planting inside a garden bed, stored in the bed's props.plantings. */
export interface Planting {
  speciesId: string
  count?: number
  spacing?: number // cm, defaults to the species value
  sown?: string // ISO date
}

export interface LogEntry {
  date: string
  note: string
}

export interface WaterReading {
  date: string
  tempC?: number
  ph?: number
  oxygen?: number
  ammonia?: number
  nitrite?: number
  nitrate?: number
  note?: string
}

export interface StockedFish {
  speciesId: string
  qty: number
  introduced?: string
  note?: string
}
