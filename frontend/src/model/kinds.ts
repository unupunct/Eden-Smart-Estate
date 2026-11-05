import type { GeomType, Props } from './types'

export type FieldType = 'text' | 'textarea' | 'number' | 'select' | 'boolean' | 'color' | 'date' | 'species'
export interface FieldDef {
  key: string
  label: string
  type: FieldType
  /** species picker: which library entries to offer */
  place?: 'tree' | 'bush' | 'plant'
  unit?: string
  options?: { value: string; label: string }[]
  min?: number
  max?: number
  step?: number
  section?: string
}

export interface Preset {
  id: string
  label: string
  name?: string // default object name
  props: Props
}

export type Shape = 'polygon' | 'rectangle' | 'circle'

export interface KindDef {
  kind: string
  label: string
  geom: GeomType
  layerKey: string
  group: string
  color: string
  fillOpacity?: number // polygons
  lineWidth?: number // px outline / line
  dashed?: boolean
  icon?: string // emoji drawn on the map for points
  widthProp?: string // metres: line drawn at true width (roads, paths)
  radiusProp?: string // metres: point drawn with true canopy
  extrude?: { heightProp: string; fallback: number; base?: number; color?: string }
  lineExtrude?: { heightProp: string; fallback: number; widthM: number }
  hitFill?: boolean // false: polygon is selected by its outline only (boundary, big zones)
  smart?: boolean // device placeholder: shows "not connected" notice
  presets?: Preset[]
  fields: FieldDef[]
  defaults?: Props
}

const opts = (...v: [string, string?][]) => v.map(([value, label]) => ({ value, label: label ?? cap(value) }))
function cap(s: string) {
  const t = s.replace(/_/g, ' ')
  return t[0].toUpperCase() + t.slice(1)
}

export const STATUS_OPTIONS = opts(['good', 'Good'], ['fair', 'Fair'], ['needs_attention', 'Needs attention'], ['planned', 'Planned'], ['decommissioned', 'Decommissioned'])

const ROOFS = opts(['flat'], ['gable'], ['hip'], ['shed', 'Shed (mono-pitch)'], ['mansard'])

export const KINDS: KindDef[] = [
  // ------------------------------------------------------------ estate
  {
    kind: 'boundary', label: 'Property boundary', geom: 'Polygon', layerKey: 'boundary', group: 'Estate', color: '#ffd166',
    fillOpacity: 0.06, lineWidth: 3, hitFill: false,
    fields: [{ key: 'cadastralId', label: 'Cadastral / land-book no.', type: 'text' }],
    defaults: { status: 'good' },
  },
  {
    kind: 'zone', label: 'Zone', geom: 'Polygon', layerKey: 'zones', group: 'Estate', color: '#9ad17a', fillOpacity: 0.22, lineWidth: 2,
    presets: [
      { id: 'zone', label: 'General zone', props: {} },
      { id: 'vegetable_garden', label: 'Vegetable garden', name: 'Vegetable garden', props: { zoneType: 'vegetable_garden', color: '#8bd450' } },
      { id: 'herb_garden', label: 'Herb garden', name: 'Herb garden', props: { zoneType: 'herb_garden', color: '#a3e635' } },
      { id: 'flower_garden', label: 'Flower garden', name: 'Flower garden', props: { zoneType: 'flower_garden', color: '#f472b6' } },
      { id: 'food_forest', label: 'Food forest', name: 'Food forest', props: { zoneType: 'food_forest', color: '#4ade80' } },
      { id: 'compost', label: 'Composting area', name: 'Compost', props: { zoneType: 'compost', color: '#a16207' } },
      { id: 'seedling', label: 'Seedling / nursery', name: 'Nursery', props: { zoneType: 'seedling', color: '#bef264' } },
      { id: 'mushroom', label: 'Mushroom area', name: 'Mushroom area', props: { zoneType: 'mushroom', color: '#d6b38a' } },
      { id: 'animal_area', label: 'Animal area', name: 'Animal area', props: { zoneType: 'animal_area', color: '#fdba74' } },
      { id: 'storage', label: 'Storage area', name: 'Storage area', props: { zoneType: 'storage', color: '#94a3b8' } },
    ],
    fields: [
      {
        key: 'zoneType', label: 'Zone type', type: 'select',
        options: opts(['zone', 'General'], ['vegetable_garden'], ['herb_garden'], ['flower_garden'], ['food_forest'], ['compost'], ['seedling', 'Seedling / nursery'], ['mushroom'], ['animal_area'], ['storage']),
      },
      { key: 'permacultureZone', label: 'Permaculture zone (0–5)', type: 'number', min: 0, max: 5, step: 1 },
      { key: 'color', label: 'Colour', type: 'color' },
    ],
  },
  {
    kind: 'orchard_area', label: 'Orchard area', geom: 'Polygon', layerKey: 'zones', group: 'Estate', color: '#7bc96f', fillOpacity: 0.16, lineWidth: 2, dashed: true,
    fields: [{ key: 'spacing', label: 'Planned tree spacing', type: 'number', unit: 'm', min: 0 }, { key: 'color', label: 'Colour', type: 'color' }],
  },
  {
    kind: 'forest', label: 'Forest area', geom: 'Polygon', layerKey: 'zones', group: 'Estate', color: '#2f9e5b', fillOpacity: 0.3, lineWidth: 2,
    fields: [{ key: 'dominantSpecies', label: 'Dominant species', type: 'text' }, { key: 'color', label: 'Colour', type: 'color' }],
  },
  {
    kind: 'utility_area', label: 'Utility area', geom: 'Polygon', layerKey: 'zones', group: 'Estate', color: '#94a3b8', fillOpacity: 0.25, lineWidth: 2,
    fields: [{ key: 'utilityType', label: 'Utility type', type: 'text' }, { key: 'color', label: 'Colour', type: 'color' }],
  },

  // ------------------------------------------------------------ structures
  {
    kind: 'building', label: 'Building', geom: 'Polygon', layerKey: 'buildings', group: 'Structures', color: '#f4a261', fillOpacity: 0.55, lineWidth: 2,
    extrude: { heightProp: 'height', fallback: 6 },
    presets: [
      { id: 'main_house', label: 'Main house', name: 'Main house', props: { buildingType: 'main_house', floors: 2, height: 7.5, roofType: 'gable', electricity: true, water: true, heating: true, internet: true } },
      { id: 'old_house', label: 'Old house', name: 'Old house', props: { buildingType: 'old_house', floors: 1, height: 5, roofType: 'gable', electricity: true } },
      { id: 'guest_house', label: 'Guest house', name: 'Guest house', props: { buildingType: 'guest_house', floors: 1, height: 4.2, roofType: 'hip', electricity: true, water: true } },
      { id: 'workshop', label: 'Workshop', name: 'Workshop', props: { buildingType: 'workshop', floors: 1, height: 4, roofType: 'shed', electricity: true } },
      { id: 'garage', label: 'Garage', name: 'Garage', props: { buildingType: 'garage', floors: 1, height: 3.2, roofType: 'flat' } },
      { id: 'storage', label: 'Storage building', name: 'Storage', props: { buildingType: 'storage', floors: 1, height: 3, roofType: 'gable' } },
      { id: 'barn', label: 'Barn', name: 'Barn', props: { buildingType: 'barn', floors: 1, height: 6, roofType: 'gable' } },
      { id: 'chicken_coop', label: 'Chicken coop', name: 'Chicken coop', props: { buildingType: 'chicken_coop', floors: 1, height: 2.2, roofType: 'shed' } },
      { id: 'animal_shelter', label: 'Animal shelter', name: 'Animal shelter', props: { buildingType: 'animal_shelter', floors: 1, height: 3, roofType: 'shed' } },
      { id: 'tool_shed', label: 'Tool shed', name: 'Tool shed', props: { buildingType: 'tool_shed', floors: 1, height: 2.5, roofType: 'shed' } },
      { id: 'utility', label: 'Utility building', name: 'Utility building', props: { buildingType: 'utility', floors: 1, height: 3, roofType: 'flat', electricity: true } },
      { id: 'custom', label: 'Custom structure', name: 'Structure', props: { buildingType: 'custom', floors: 1, height: 4, roofType: 'flat' } },
    ],
    fields: [
      { key: 'buildingType', label: 'Type', type: 'select', section: 'Building', options: opts(['main_house'], ['old_house'], ['guest_house'], ['workshop'], ['garage'], ['storage'], ['barn'], ['chicken_coop'], ['animal_shelter'], ['tool_shed'], ['utility'], ['custom']) },
      { key: 'floors', label: 'Floors', type: 'number', min: 1, max: 10, step: 1, section: 'Building' },
      { key: 'height', label: 'Height (to the ridge / top)', type: 'number', unit: 'm', min: 0.5, step: 0.1, section: 'Building' },
      { key: 'eaveHeight', label: 'Wall (eave) height, optional', type: 'number', unit: 'm', min: 0.3, step: 0.1, section: 'Building' },
      { key: 'roofType', label: 'Roof type', type: 'select', options: ROOFS, section: 'Building' },
      { key: 'roofOrientation', label: 'Roof ridge bearing', type: 'number', unit: '°', min: 0, max: 360, section: 'Building' },
      { key: 'material', label: 'Exterior material', type: 'text', section: 'Building' },
      { key: 'constructionYear', label: 'Built (year)', type: 'number', step: 1, section: 'Building' },
      { key: 'doors', label: 'Doors', type: 'number', min: 0, step: 1, section: 'Openings' },
      { key: 'windows', label: 'Windows', type: 'number', min: 0, step: 1, section: 'Openings' },
      { key: 'entrances', label: 'Entrance locations', type: 'text', section: 'Openings' },
      { key: 'electricity', label: 'Electricity', type: 'boolean', section: 'Services' },
      { key: 'water', label: 'Water', type: 'boolean', section: 'Services' },
      { key: 'heating', label: 'Heating', type: 'boolean', section: 'Services' },
      { key: 'internet', label: 'Internet', type: 'boolean', section: 'Services' },
    ],
    defaults: { floors: 1, height: 4, roofType: 'gable', buildingType: 'custom', status: 'good' },
  },
  {
    kind: 'greenhouse', label: 'Greenhouse', geom: 'Polygon', layerKey: 'greenhouse', group: 'Structures', color: '#7bdff2', fillOpacity: 0.4, lineWidth: 2,
    extrude: { heightProp: 'height', fallback: 3, color: '#a5f3fc' },
    fields: [
      { key: 'height', label: 'Ridge height', type: 'number', unit: 'm', min: 0.5, step: 0.1 },
      { key: 'roofType', label: 'Roof type', type: 'select', options: ROOFS },
      { key: 'covering', label: 'Covering', type: 'text' },
      { key: 'doors', label: 'Doors', type: 'number', min: 0, step: 1 },
      { key: 'vents', label: 'Ventilation windows', type: 'number', min: 0, step: 1 },
      { key: 'tempMin', label: 'Target temperature min', type: 'number', unit: '°C', section: 'Target ranges' },
      { key: 'tempMax', label: 'Target temperature max', type: 'number', unit: '°C', section: 'Target ranges' },
      { key: 'humMin', label: 'Target humidity min', type: 'number', unit: '%', min: 0, max: 100, section: 'Target ranges' },
      { key: 'humMax', label: 'Target humidity max', type: 'number', unit: '%', min: 0, max: 100, section: 'Target ranges' },
      { key: 'soilMin', label: 'Target soil moisture min', type: 'number', unit: '%', min: 0, max: 100, section: 'Target ranges' },
      { key: 'soilMax', label: 'Target soil moisture max', type: 'number', unit: '%', min: 0, max: 100, section: 'Target ranges' },
    ],
    defaults: { height: 3, roofType: 'gable', doors: 1, vents: 2, status: 'good' },
  },
  {
    kind: 'fence', label: 'Fence', geom: 'LineString', layerKey: 'fences', group: 'Structures', color: '#c9a27a', lineWidth: 3,
    lineExtrude: { heightProp: 'height', fallback: 1.6, widthM: 0.12 },
    presets: [
      { id: 'wood', label: 'Wooden fence', name: 'Wooden fence', props: { fenceType: 'wood', height: 1.6, color: '#c9a27a' } },
      { id: 'concrete', label: 'Concrete panels', name: 'Concrete fence', props: { fenceType: 'concrete', height: 2, color: '#cbd5e1' } },
      { id: 'metal', label: 'Metal fence', name: 'Metal fence', props: { fenceType: 'metal', height: 1.5, color: '#64748b' } },
      { id: 'wire_mesh', label: 'Wire mesh', name: 'Wire mesh fence', props: { fenceType: 'wire_mesh', height: 1.5, color: '#a1a1aa' } },
      { id: 'stone_wall', label: 'Stone wall', name: 'Stone wall', props: { fenceType: 'stone_wall', height: 1.2, color: '#9ca3af' } },
      { id: 'custom', label: 'Custom fence', name: 'Fence', props: { fenceType: 'custom', height: 1.5, color: '#e5c07b' } },
    ],
    fields: [
      { key: 'fenceType', label: 'Type', type: 'select', options: opts(['wood', 'Wooden'], ['concrete', 'Concrete panels'], ['metal'], ['wire_mesh', 'Wire mesh'], ['stone_wall', 'Stone wall'], ['custom']) },
      { key: 'height', label: 'Height', type: 'number', unit: 'm', min: 0.2, step: 0.1 },
      { key: 'color', label: 'Colour', type: 'color' },
      { key: 'sectionLength', label: 'Section length', type: 'number', unit: 'm', min: 0.5, step: 0.1 },
      { key: 'construction', label: 'Construction notes', type: 'textarea' },
    ],
    defaults: { fenceType: 'wood', height: 1.6, color: '#c9a27a', sectionLength: 2.5, status: 'good' },
  },
  {
    kind: 'hedge', label: 'Hedge', geom: 'LineString', layerKey: 'fences', group: 'Structures', color: '#3f9e5a', lineWidth: 5,
    lineExtrude: { heightProp: 'height', fallback: 1.8, widthM: 0.8 },
    fields: [{ key: 'species', label: 'Species', type: 'text' }, { key: 'height', label: 'Height', type: 'number', unit: 'm', step: 0.1 }],
    defaults: { height: 1.8, status: 'good' },
  },
  {
    kind: 'gate', label: 'Gate / access point', geom: 'Point', layerKey: 'fences', group: 'Structures', color: '#e9c46a', icon: '🚪',
    fields: [
      { key: 'width', label: 'Gate width', type: 'number', unit: 'm', min: 0.4, step: 0.1 },
      { key: 'gateType', label: 'Gate type', type: 'select', options: opts(['single'], ['double'], ['sliding'], ['pedestrian']) },
      { key: 'material', label: 'Material', type: 'text' },
    ],
    defaults: { width: 4, gateType: 'double', status: 'good' },
  },
  {
    kind: 'road', label: 'Road', geom: 'LineString', layerKey: 'roads', group: 'Structures', color: '#b8b8b0', lineWidth: 2, widthProp: 'width',
    fields: [
      { key: 'surface', label: 'Surface', type: 'select', options: opts(['gravel'], ['asphalt'], ['concrete'], ['paving'], ['dirt']) },
      { key: 'width', label: 'Width', type: 'number', unit: 'm', min: 0.3, step: 0.1 },
    ],
    defaults: { surface: 'gravel', width: 4, status: 'good' },
  },
  {
    kind: 'path', label: 'Path / walkway', geom: 'LineString', layerKey: 'roads', group: 'Structures', color: '#d6cfa8', lineWidth: 2, widthProp: 'width',
    fields: [
      { key: 'surface', label: 'Surface', type: 'select', options: opts(['gravel'], ['concrete'], ['paving'], ['wood_chips', 'Wood chips'], ['grass'], ['dirt']) },
      { key: 'width', label: 'Width', type: 'number', unit: 'm', min: 0.2, step: 0.1 },
    ],
    defaults: { surface: 'gravel', width: 1.2, status: 'good' },
  },

  // ------------------------------------------------------------ garden & plants
  {
    kind: 'garden_bed', label: 'Garden bed', geom: 'Polygon', layerKey: 'garden_beds', group: 'Garden & plants', color: '#8bd450', fillOpacity: 0.5, lineWidth: 2,
    presets: [
      { id: 'raised', label: 'Raised bed', name: 'Raised bed', props: { bedType: 'raised' } },
      { id: 'in_ground', label: 'In-ground bed', name: 'Bed', props: { bedType: 'in_ground' } },
      { id: 'herb', label: 'Herb bed', name: 'Herb bed', props: { bedType: 'herb' } },
      { id: 'flower', label: 'Flower bed', name: 'Flower bed', props: { bedType: 'flower', color: '#f472b6' } },
    ],
    fields: [
      { key: 'bedType', label: 'Bed type', type: 'select', options: opts(['raised'], ['in_ground', 'In-ground'], ['herb'], ['flower'], ['circular']) },
      { key: 'soil', label: 'Soil', type: 'text' },
      { key: 'rows', label: 'Rows', type: 'number', min: 0, step: 1 },
      { key: 'spacing', label: 'Plant spacing', type: 'number', unit: 'cm', min: 0 },
      { key: 'plantCount', label: 'Plant quantity', type: 'number', min: 0, step: 1 },
      { key: 'crops', label: 'Crops / plants', type: 'text' },
      { key: 'orientation', label: 'Orientation', type: 'number', unit: '°', min: 0, max: 360 },
      { key: 'mulch', label: 'Mulched', type: 'boolean' },
      { key: 'irrigation', label: 'Irrigation', type: 'select', options: opts(['none'], ['drip'], ['sprinkler'], ['manual']) },
      { key: 'plantingDate', label: 'Planting date', type: 'date' },
      { key: 'harvest', label: 'Expected harvest', type: 'text' },
      { key: 'color', label: 'Colour', type: 'color' },
    ],
    defaults: { bedType: 'raised', status: 'good' },
  },
  {
    kind: 'tree', label: 'Tree', geom: 'Point', layerKey: 'trees', group: 'Garden & plants', color: '#4cc38a', icon: '🌳', radiusProp: 'canopy',
    extrude: { heightProp: 'height', fallback: 5 },
    presets: [
      { id: 'tree', label: 'Tree (generic)', name: 'Tree', props: { category: 'tree', canopy: 4, height: 6 } },
      { id: 'apple', label: 'Apple', name: 'Apple tree', props: { category: 'fruit_tree', species: 'Apple', canopy: 4.5, height: 4 } },
      { id: 'pear', label: 'Pear', name: 'Pear tree', props: { category: 'fruit_tree', species: 'Pear', canopy: 4, height: 4.5 } },
      { id: 'plum', label: 'Plum', name: 'Plum tree', props: { category: 'fruit_tree', species: 'Plum', canopy: 3.5, height: 3.5 } },
      { id: 'cherry', label: 'Cherry', name: 'Cherry tree', props: { category: 'fruit_tree', species: 'Cherry', canopy: 4.5, height: 5 } },
      { id: 'sour_cherry', label: 'Sour cherry', name: 'Sour cherry', props: { category: 'fruit_tree', species: 'Sour cherry', canopy: 3.5, height: 3.5 } },
      { id: 'peach', label: 'Peach', name: 'Peach tree', props: { category: 'fruit_tree', species: 'Peach', canopy: 3.5, height: 3.5 } },
      { id: 'apricot', label: 'Apricot', name: 'Apricot tree', props: { category: 'fruit_tree', species: 'Apricot', canopy: 4, height: 4 } },
      { id: 'walnut', label: 'Walnut', name: 'Walnut tree', props: { category: 'nut_tree', species: 'Walnut', canopy: 8, height: 9 } },
      { id: 'hazelnut', label: 'Hazelnut', name: 'Hazelnut', props: { category: 'nut_tree', species: 'Hazelnut', canopy: 3, height: 3.5 } },
      { id: 'quince', label: 'Quince', name: 'Quince', props: { category: 'fruit_tree', species: 'Quince', canopy: 3, height: 3 } },
      { id: 'mulberry', label: 'Mulberry', name: 'Mulberry', props: { category: 'fruit_tree', species: 'Mulberry', canopy: 6, height: 7 } },
      { id: 'fig', label: 'Fig', name: 'Fig', props: { category: 'fruit_tree', species: 'Fig', canopy: 4, height: 3.5 } },
    ],
    fields: [
      { key: 'speciesId', label: 'Species (plant library)', type: 'species', place: 'tree' },
      { key: 'species', label: 'Species name (if not in the library)', type: 'text' },
      { key: 'variety', label: 'Variety', type: 'text' },
      { key: 'category', label: 'Category', type: 'select', options: opts(['tree', 'Tree'], ['fruit_tree'], ['nut_tree'], ['ornamental_tree'], ['forest_tree']) },
      { key: 'plantedYear', label: 'Planted (year)', type: 'number', step: 1 },
      { key: 'height', label: 'Height now', type: 'number', unit: 'm', min: 0.1, step: 0.1 },
      { key: 'canopy', label: 'Canopy diameter now', type: 'number', unit: 'm', min: 0.2, step: 0.1 },
      { key: 'rootstock', label: 'Rootstock', type: 'text' },
      { key: 'harvestSeason', label: 'Harvest season', type: 'text' },
      { key: 'expectedYield', label: 'Expected yield', type: 'number', unit: 'kg / year', min: 0 },
    ],
    defaults: { category: 'tree', canopy: 4, height: 6, status: 'good' },
  },
  {
    kind: 'bush', label: 'Bush / shrub', geom: 'Point', layerKey: 'bushes', group: 'Garden & plants', color: '#7ccf6e', icon: '🌿', radiusProp: 'canopy',
    extrude: { heightProp: 'height', fallback: 1.5 },
    fields: [
      { key: 'speciesId', label: 'Species (plant library)', type: 'species', place: 'bush' },
      { key: 'species', label: 'Species name (if not in the library)', type: 'text' },
      { key: 'height', label: 'Height', type: 'number', unit: 'm', min: 0.1, step: 0.1 },
      { key: 'canopy', label: 'Spread', type: 'number', unit: 'm', min: 0.2, step: 0.1 },
      { key: 'plantedYear', label: 'Planted (year)', type: 'number', step: 1 },
    ],
    defaults: { canopy: 1.5, height: 1.5, status: 'good' },
  },
  {
    kind: 'plant', label: 'Plant', geom: 'Point', layerKey: 'garden_beds', group: 'Garden & plants', color: '#a3e635', icon: '🌱', radiusProp: 'canopy',
    fields: [
      { key: 'speciesId', label: 'Species (plant library)', type: 'species', place: 'plant' },
      { key: 'species', label: 'Species name (if not in the library)', type: 'text' },
      { key: 'canopy', label: 'Spread', type: 'number', unit: 'm', min: 0.05, step: 0.05 },
      { key: 'quantity', label: 'Quantity', type: 'number', min: 1, step: 1 },
      { key: 'plantingDate', label: 'Planting date', type: 'date' },
    ],
    defaults: { quantity: 1 },
  },

  // ------------------------------------------------------------ water
  {
    kind: 'pond', label: 'Pond', geom: 'Polygon', layerKey: 'pond', group: 'Water', color: '#4aa8ff', fillOpacity: 0.55, lineWidth: 2,
    fields: [
      { key: 'maxDepth', label: 'Maximum depth', type: 'number', unit: 'm', min: 0, step: 0.1 },
      { key: 'natural', label: 'Natural swimming pond', type: 'boolean' },
    ],
    defaults: { maxDepth: 2, natural: true, status: 'good' },
  },
  {
    kind: 'pond_zone', label: 'Pond zone', geom: 'Polygon', layerKey: 'pond', group: 'Water', color: '#2563eb', fillOpacity: 0.4, lineWidth: 1.5, dashed: true,
    presets: [
      { id: 'swimming', label: 'Swimming zone', name: 'Swimming zone', props: { zoneType: 'swimming', depth: 2 } },
      { id: 'regeneration', label: 'Regeneration zone', name: 'Regeneration zone', props: { zoneType: 'regeneration', depth: 0.4 } },
      { id: 'plant_filter', label: 'Plant filtration zone', name: 'Plant filter', props: { zoneType: 'plant_filter', depth: 0.3 } },
      { id: 'deep', label: 'Deep zone', name: 'Deep zone', props: { zoneType: 'deep', depth: 2.5 } },
    ],
    fields: [
      { key: 'zoneType', label: 'Zone type', type: 'select', options: opts(['swimming'], ['regeneration'], ['plant_filter', 'Plant filtration'], ['deep'], ['shallow']) },
      { key: 'depth', label: 'Depth', type: 'number', unit: 'm', min: 0, step: 0.1 },
    ],
  },
  {
    kind: 'water_pipe', label: 'Water pipe', geom: 'LineString', layerKey: 'water_infra', group: 'Water', color: '#3b82f6', lineWidth: 2.5,
    fields: [{ key: 'diameterMm', label: 'Diameter', type: 'number', unit: 'mm', min: 0 }, { key: 'material', label: 'Material', type: 'text' }],
  },
  {
    kind: 'irrigation', label: 'Irrigation pipe', geom: 'LineString', layerKey: 'water_infra', group: 'Water', color: '#22d3ee', lineWidth: 2, dashed: true,
    fields: [{ key: 'diameterMm', label: 'Diameter', type: 'number', unit: 'mm', min: 0 }, { key: 'material', label: 'Material', type: 'text' }],
  },
  {
    kind: 'drainage', label: 'Drainage channel', geom: 'LineString', layerKey: 'water_infra', group: 'Water', color: '#60a5fa', lineWidth: 3, dashed: true,
    fields: [{ key: 'width', label: 'Width', type: 'number', unit: 'm', min: 0, step: 0.05 }],
  },
  {
    kind: 'well', label: 'Well / water point', geom: 'Point', layerKey: 'water_infra', group: 'Water', color: '#38bdf8', icon: '💧',
    fields: [{ key: 'depth', label: 'Depth', type: 'number', unit: 'm', min: 0 }],
  },

  {
    kind: 'pond_pump', label: 'Pump', geom: 'Point', layerKey: 'pond', group: 'Water', color: '#60a5fa', icon: '🔄', smart: true,
    fields: [{ key: 'flowLph', label: 'Flow', type: 'number', unit: 'L/h', min: 0 }, { key: 'powerW', label: 'Power', type: 'number', unit: 'W', min: 0 }],
  },
  { kind: 'pond_filter', label: 'Filter', geom: 'Point', layerKey: 'pond', group: 'Water', color: '#38bdf8', icon: '🧽', fields: [{ key: 'filterType', label: 'Type', type: 'text' }] },
  { kind: 'pond_skimmer', label: 'Skimmer', geom: 'Point', layerKey: 'pond', group: 'Water', color: '#7dd3fc', icon: '🧹', fields: [] },
  { kind: 'pond_waterfall', label: 'Waterfall', geom: 'Point', layerKey: 'pond', group: 'Water', color: '#93c5fd', icon: '🌊', fields: [{ key: 'drop', label: 'Drop height', type: 'number', unit: 'm', min: 0, step: 0.1 }] },
  { kind: 'pond_stone', label: 'Stone / boulder', geom: 'Point', layerKey: 'pond', group: 'Water', color: '#a8a29e', icon: '🪨', fields: [] },
  { kind: 'pond_steps', label: 'Entry steps', geom: 'Point', layerKey: 'pond', group: 'Water', color: '#d6d3d1', icon: '🪜', fields: [{ key: 'treads', label: 'Number of steps', type: 'number', min: 1, step: 1 }] },
  {
    kind: 'pond_stream', label: 'Stream', geom: 'LineString', layerKey: 'pond', group: 'Water', color: '#38bdf8', lineWidth: 3, widthProp: 'width',
    fields: [{ key: 'width', label: 'Width', type: 'number', unit: 'm', min: 0.1, step: 0.1 }], defaults: { width: 0.6 },
  },

  // ------------------------------------------------------------ greenhouse interior
  {
    kind: 'gh_bed', label: 'Growing bed', geom: 'Polygon', layerKey: 'greenhouse', group: 'Greenhouse', color: '#86efac', fillOpacity: 0.5, lineWidth: 1.5,
    fields: [{ key: 'crops', label: 'Crops', type: 'text' }, { key: 'soil', label: 'Soil / substrate', type: 'text' }],
  },
  {
    kind: 'gh_shelf', label: 'Shelving', geom: 'Polygon', layerKey: 'greenhouse', group: 'Greenhouse', color: '#d6b38a', fillOpacity: 0.5, lineWidth: 1.5,
    fields: [{ key: 'tiers', label: 'Tiers', type: 'number', min: 1, step: 1 }],
  },
  { kind: 'gh_door', label: 'Door', geom: 'Point', layerKey: 'greenhouse', group: 'Greenhouse', color: '#e9c46a', icon: '🚪', fields: [{ key: 'width', label: 'Width', type: 'number', unit: 'm', step: 0.1 }] },
  { kind: 'gh_vent', label: 'Ventilation window', geom: 'Point', layerKey: 'greenhouse', group: 'Greenhouse', color: '#a5f3fc', icon: '🌬️', fields: [{ key: 'ventType', label: 'Type', type: 'select', options: opts(['roof'], ['side']) }, { key: 'width', label: 'Opening width', type: 'number', unit: 'm', step: 0.1 }] },
  { kind: 'gh_heater', label: 'Heater', geom: 'Point', layerKey: 'greenhouse', group: 'Greenhouse', color: '#fb923c', icon: '🔥', smart: true, fields: [{ key: 'powerKw', label: 'Power', type: 'number', unit: 'kW', step: 0.1 }, { key: 'fuel', label: 'Energy source', type: 'text' }] },
  { kind: 'gh_fan', label: 'Fan / cooling', geom: 'Point', layerKey: 'greenhouse', group: 'Greenhouse', color: '#67e8f9', icon: '🌀', smart: true, fields: [{ key: 'airflow', label: 'Airflow', type: 'number', unit: 'm³/h' }] },
  { kind: 'gh_light', label: 'Grow light', geom: 'Point', layerKey: 'greenhouse', group: 'Greenhouse', color: '#fde68a', icon: '💡', smart: true, fields: [{ key: 'watts', label: 'Power', type: 'number', unit: 'W' }] },
  { kind: 'gh_irrigation', label: 'Irrigation outlet', geom: 'Point', layerKey: 'greenhouse', group: 'Greenhouse', color: '#22d3ee', icon: '🚿', smart: true, fields: [{ key: 'irrigationType', label: 'Type', type: 'select', options: opts(['drip'], ['mist'], ['sprinkler'], ['manual']) }] },
  { kind: 'gh_tank', label: 'Water tank', geom: 'Point', layerKey: 'greenhouse', group: 'Greenhouse', color: '#3b82f6', icon: '🛢️', fields: [{ key: 'litres', label: 'Capacity', type: 'number', unit: 'L', min: 0 }] },

  // ------------------------------------------------------------ utilities & smart
  {
    kind: 'cable', label: 'Electrical cable', geom: 'LineString', layerKey: 'electrical', group: 'Utilities & smart', color: '#facc15', lineWidth: 2, dashed: true,
    fields: [{ key: 'cableType', label: 'Type', type: 'select', options: opts(['underground'], ['overhead']) }, { key: 'voltage', label: 'Voltage', type: 'text' }],
  },
  {
    kind: 'outlet', label: 'Smart outlet', geom: 'Point', layerKey: 'outlets', group: 'Utilities & smart', color: '#fb923c', icon: '🔌', smart: true,
    fields: [{ key: 'deviceId', label: 'Device identifier', type: 'text' }, { key: 'building', label: 'Building / zone', type: 'text' }],
  },
  {
    kind: 'camera', label: 'Camera', geom: 'Point', layerKey: 'cameras', group: 'Utilities & smart', color: '#f87171', icon: '📷', smart: true,
    fields: [
      { key: 'direction', label: 'Viewing direction', type: 'number', unit: '°', min: 0, max: 360 },
      { key: 'fov', label: 'Field of view', type: 'number', unit: '°', min: 5, max: 360 },
      { key: 'range', label: 'Range', type: 'number', unit: 'm', min: 1 },
      { key: 'building', label: 'Building / zone', type: 'text' },
    ],
    defaults: { direction: 0, fov: 90, range: 30 },
  },
  {
    kind: 'light', label: 'Light', geom: 'Point', layerKey: 'lighting', group: 'Utilities & smart', color: '#fde68a', icon: '💡', smart: true,
    fields: [{ key: 'lightType', label: 'Light type', type: 'text' }],
  },
  {
    kind: 'sensor', label: 'Sensor', geom: 'Point', layerKey: 'electrical', group: 'Utilities & smart', color: '#c4b5fd', icon: '📡', smart: true,
    fields: [{ key: 'sensorType', label: 'Sensor type', type: 'select', options: opts(['temperature_humidity', 'Temperature / humidity'], ['soil_moisture', 'Soil moisture'], ['water_leak', 'Water leak'], ['motion'], ['door_window', 'Door / window'], ['energy_meter', 'Energy meter']) }],
  },
  {
    kind: 'solar', label: 'Solar installation', geom: 'Polygon', layerKey: 'solar', group: 'Utilities & smart', color: '#38bdf8', fillOpacity: 0.55, lineWidth: 2,
    extrude: { heightProp: 'height', fallback: 0.3, base: 0 },
    fields: [
      { key: 'kwp', label: 'Peak power', type: 'number', unit: 'kWp', min: 0, step: 0.1 },
      { key: 'tilt', label: 'Tilt', type: 'number', unit: '°', min: 0, max: 90 },
      { key: 'azimuth', label: 'Azimuth', type: 'number', unit: '°', min: 0, max: 360 },
    ],
  },

  // ------------------------------------------------------------ annotations
  {
    kind: 'note', label: 'Note', geom: 'Point', layerKey: 'notes', group: 'Annotations', color: '#e5e7eb', icon: '📝',
    fields: [],
  },
]

export const KIND_MAP: Record<string, KindDef> = Object.fromEntries(KINDS.map((k) => [k.kind, k]))
export const KIND_GROUPS = [...new Set(KINDS.map((k) => k.group))]

export function kindDef(kind: string): KindDef {
  return KIND_MAP[kind] ?? { kind, label: cap(kind), geom: 'Point', layerKey: 'notes', group: 'Other', color: '#e5e7eb', fields: [], icon: '❔' }
}

export function objectColor(kind: string, props: Props): string {
  const c = props.color
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : kindDef(kind).color
}

export function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : fallback
}
