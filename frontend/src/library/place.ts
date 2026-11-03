import { useApp } from '../model/app'
import { useEditor } from '../model/store'
import type { Props } from '../model/types'
import type { LibraryIndex } from './logic'
import type { Plant } from './types'

export interface Placement {
  kind: 'tree' | 'bush' | 'plant'
  extra: Props
}

const treeCategory = (p: Plant) => (p.cats.includes('fruit_tree') ? 'fruit_tree' : p.cats.includes('nut_tree') ? 'nut_tree' : p.cats.includes('ornamental_tree') ? 'ornamental_tree' : p.cats.includes('forest_tree') ? 'forest_tree' : 'tree')

/** Props for a freshly planted specimen of a library species (young size; maturity comes from the library). */
export function placementFor(ix: LibraryIndex, id: string, now = new Date().getFullYear()): Placement | null {
  const p = ix.plants.get(id)
  if (p) {
    if (p.place === 'tree') return { kind: 'tree', extra: { speciesId: id, species: p.name, name: p.name, category: treeCategory(p), canopy: 1.5, height: 2.5, plantedYear: now } }
    if (p.place === 'bush') return { kind: 'bush', extra: { speciesId: id, species: p.name, name: p.name, canopy: Math.min(p.canopy ?? 1, 1), height: 0.8, plantedYear: now } }
    return { kind: 'plant', extra: { speciesId: id, species: p.name, name: p.name, canopy: Math.max(0.1, p.spacing / 100), height: p.height, quantity: 1 } }
  }
  const a = ix.aquatic.get(id)
  if (a) return { kind: 'plant', extra: { speciesId: id, species: a.name, name: a.name, canopy: 0.5, aquatic: true, quantity: 1 } }
  return null
}

/** "Add to property": arm the draw tool with this species and jump to the map. */
export function startPlacing(ix: LibraryIndex, id: string): boolean {
  const pl = placementFor(ix, id)
  if (!pl) return false
  useEditor.getState().setTool({ type: 'draw', kind: pl.kind, extra: pl.extra })
  useApp.getState().go('editor')
  return true
}
