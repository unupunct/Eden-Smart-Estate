// What was checked against GBIF for a library entry, in words. Pure functions (unit-tested); the Library page only displays them.
import type { Taxon } from './types'

export interface RomaniaLine {
  verdict: 'native' | 'introduced' | 'conflict' | 'casual'
  text: string
  note?: string
}

/** Whether the Romanian checklists call the species native or introduced, and where the library says something different. */
export function romaniaLine(t: Taxon | null | undefined, curated: 'native' | 'naturalised' | 'introduced' | string): RomaniaLine | null {
  const ro = t?.ro
  if (!ro || ro.verdict === 'unknown') return null
  const list = (a: string[]) => a.join(', ')
  if (ro.verdict === 'native') {
    return {
      verdict: 'native', text: `Native in Romania according to ${list(ro.native)}.`,
      note: curated === 'native' ? undefined : 'That describes the wild species. Cultivated varieties are grown here as introduced plants, which is how this library lists it.',
    }
  }
  if (ro.verdict === 'introduced') {
    return { verdict: 'introduced', text: `Introduced in Romania according to ${list(ro.introduced)}.`, note: curated === 'native' ? 'The library lists it as native: the checklists and the library disagree, so check locally.' : undefined }
  }
  if (ro.verdict === 'conflict') return { verdict: 'conflict', text: `The checklists disagree: native according to ${list(ro.native)}, introduced according to ${list(ro.introduced)}.` }
  return { verdict: 'casual', text: 'Only a casual (occasional) visitor in Romania according to the checklists.' }
}

/** One sentence about the scientific name. */
export function nameLine(t: Taxon | null | undefined): string {
  if (!t) return 'This name could not be matched to one entry in GBIF.'
  const who = `${t.name}${t.authorship ? ' ' + t.authorship : ''}`
  if (t.status === 'ACCEPTED') return `The scientific name is the accepted name in GBIF (${who}).`
  if (t.status === 'SYNONYM') {
    return `GBIF treats ${t.name} as a synonym${t.acceptedName ? `; its accepted name is ${t.acceptedName}` : ''}. The library keeps the name gardeners know.`
  }
  return `GBIF lists this name as ${String(t.status).toLowerCase()} (${who}).`
}

export function familyLine(family: string, t: Taxon | null | undefined): string {
  return family && t?.family && t.family !== family ? `GBIF files it under ${t.family} (the library uses ${family}); botanists use more than one family system.` : ''
}

export const gbifUrl = (t: Taxon) => `https://www.gbif.org/species/${t.gbif}`
export const wikipediaUrl = (sci: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(sci.split(' / ')[0].replace(/ agg\.$/, '').trim().replace(/ /g, '_'))}`
