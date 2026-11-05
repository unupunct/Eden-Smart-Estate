import { describe, expect, it } from 'vitest'
import { familyLine, gbifUrl, nameLine, romaniaLine, wikipediaUrl } from './taxon'
import type { Taxon } from './types'

const t = (over: Partial<Taxon> = {}): Taxon => ({ gbif: 123, name: 'Solanum lycopersicum', authorship: 'L.', family: 'Solanaceae', status: 'ACCEPTED', checked: '2026-11-05', ...over })

describe('what GBIF said about the name', () => {
  it('says so when the name is the accepted one', () => {
    expect(nameLine(t())).toMatch(/accepted name in GBIF \(Solanum lycopersicum L\.\)/)
  })
  it('names the accepted name when the library keeps an older one', () => {
    const s = nameLine(t({ name: 'Pisum sativum', status: 'SYNONYM', acceptedName: 'Lathyrus oleraceus' }))
    expect(s).toMatch(/synonym/)
    expect(s).toMatch(/Lathyrus oleraceus/)
    expect(s).toMatch(/gardeners know/)
  })
  it('is honest when there was no match, and about any other status', () => {
    expect(nameLine(null)).toMatch(/could not be matched/)
    expect(nameLine(t({ status: 'DOUBTFUL' }))).toMatch(/doubtful/)
  })
  it('mentions a different family only when GBIF files it elsewhere', () => {
    expect(familyLine('Solanaceae', t())).toBe('')
    expect(familyLine('Adoxaceae', t({ family: 'Viburnaceae' }))).toMatch(/Viburnaceae.*Adoxaceae/)
    expect(familyLine('', t())).toBe('')
    expect(familyLine('X', null)).toBe('')
  })
})

describe('native or introduced in Romania', () => {
  const ro = (verdict: 'native' | 'introduced' | 'conflict' | 'casual' | 'unknown', native: string[] = [], introduced: string[] = []) => t({ ro: { verdict, native, introduced } })
  it('reports what the checklists say, with their names', () => {
    expect(romaniaLine(ro('native', ['WCVP']), 'native')).toEqual({ verdict: 'native', text: 'Native in Romania according to WCVP.', note: undefined })
    expect(romaniaLine(ro('introduced', [], ['WCVP', 'DAISIE']), 'introduced')?.text).toBe('Introduced in Romania according to WCVP, DAISIE.')
  })
  it('explains a crop whose wild species is native: the library is not wrong, it lists the cultivated plant', () => {
    const l = romaniaLine(ro('native', ['WCVP']), 'introduced')!
    expect(l.note).toMatch(/wild species/)
    expect(l.note).toMatch(/introduced plants/)
  })
  it('flags a real disagreement between the library and the checklists', () => {
    expect(romaniaLine(ro('introduced', [], ['DAISIE']), 'native')?.note).toMatch(/disagree/)
    expect(romaniaLine(ro('introduced', [], ['WCVP']), 'introduced')?.note).toBeUndefined()
  })
  it('shows a conflict between the checklists as a conflict, not as a verdict', () => {
    const l = romaniaLine(ro('conflict', ['WCVP'], ['Catalogue of Life']), 'native')!
    expect(l.verdict).toBe('conflict')
    expect(l.text).toMatch(/disagree.*WCVP.*Catalogue of Life/)
  })
  it('says nothing when there is no record (the page then says it is unchecked)', () => {
    expect(romaniaLine(ro('unknown'), 'native')).toBeNull()
    expect(romaniaLine(t(), 'native')).toBeNull()
    expect(romaniaLine(null, 'native')).toBeNull()
    expect(romaniaLine(ro('casual'), 'native')?.verdict).toBe('casual')
  })
})

describe('links', () => {
  it('points at the GBIF record and the Wikipedia article for the scientific name', () => {
    expect(gbifUrl(t())).toBe('https://www.gbif.org/species/123')
    expect(wikipediaUrl('Solanum lycopersicum')).toBe('https://en.wikipedia.org/wiki/Solanum_lycopersicum')
    expect(wikipediaUrl('Cucurbita maxima / pepo')).toBe('https://en.wikipedia.org/wiki/Cucurbita_maxima')
    expect(wikipediaUrl('Aconitum napellus agg.')).toBe('https://en.wikipedia.org/wiki/Aconitum_napellus')
  })
})
