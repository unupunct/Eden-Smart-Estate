import * as maplibregl from 'maplibre-gl'
import { create } from 'zustand'
import { KIND_MAP } from '../model/kinds'
import type { Overlay, Pos, ProviderCatalog } from '../model/types'
import type { LabelItem } from './features'

// ------------------------------------------------------------------ status (bottom bar)
export const useStatus = create<{ cursor: Pos | null; zoom: number; bearing: number; pitch: number; hint: string }>(() => ({
  cursor: null, zoom: 0, bearing: 0, pitch: 0, hint: '',
}))

// ------------------------------------------------------------------ map icons (emoji badges, no glyph server needed)
function badge(emoji: string, color: string, size = 44): ImageData {
  const c = document.createElement('canvas')
  c.width = c.height = size * 2
  const g = c.getContext('2d')!
  g.scale(2, 2)
  g.beginPath()
  g.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2)
  g.fillStyle = 'rgba(16,22,26,0.88)'
  g.fill()
  g.lineWidth = 3
  g.strokeStyle = color
  g.stroke()
  g.font = `${size * 0.5}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(emoji, size / 2, size / 2 + 1)
  return g.getImageData(0, 0, size * 2, size * 2)
}

export function installIcons(map: maplibregl.Map): void {
  const add = (id: string) => {
    if (map.hasImage(id)) return
    const kind = KIND_MAP[id.replace(/^ic-/, '')]
    map.addImage(id, badge(kind?.icon ?? '•', kind?.color ?? '#e5e7eb'), { pixelRatio: 2 })
  }
  for (const k of Object.values(KIND_MAP)) if (k.icon) add(`ic-${k.kind}`)
  map.on('styleimagemissing', (e) => add(e.id))
}

// ------------------------------------------------------------------ base maps
const BASE_PREFIX = 'base-'

export function applyBaseMap(map: maplibregl.Map, catalog: ProviderCatalog, baseMapId: string, beforeId: string): void {
  for (const l of map.getStyle().layers ?? []) if (l.id.startsWith(BASE_PREFIX)) map.removeLayer(l.id)
  for (const id of Object.keys(map.getStyle().sources ?? {})) if (id.startsWith(BASE_PREFIX)) map.removeSource(id)
  const def = catalog.basemaps[baseMapId] ?? catalog.basemaps.satellite
  def.layers.forEach((pid, i) => {
    const p = catalog.providers[pid]
    if (!p || !p.available) return
    const id = `${BASE_PREFIX}${i}`
    map.addSource(id, { type: 'raster', tiles: [p.tiles.startsWith('/') ? location.origin + p.tiles : p.tiles], tileSize: 256, maxzoom: p.maxzoom, attribution: p.attribution })
    map.addLayer({ id, type: 'raster', source: id }, beforeId)
  })
  map.getCanvas().style.background = def.layers.length ? '#0c1114' : '#141c20'
  const blank = def.layers.length === 0
  map.setPaintProperty('bg', 'background-color', blank ? '#1a2429' : '#0c1114')
}

// ------------------------------------------------------------------ image overlays
export function syncOverlays(map: maplibregl.Map, overlays: Overlay[], beforeId: string): void {
  const wanted = new Set(overlays.map((o) => `ov-${o.id}`))
  for (const l of map.getStyle().layers ?? []) if (l.id.startsWith('ov-') && !wanted.has(l.id)) map.removeLayer(l.id)
  for (const id of Object.keys(map.getStyle().sources ?? {})) if (id.startsWith('ov-') && !wanted.has(id)) map.removeSource(id)
  for (const o of overlays) {
    const id = `ov-${o.id}`
    const coords = o.corners as [Pos, Pos, Pos, Pos]
    const existing = map.getSource(id) as maplibregl.ImageSource | undefined
    if (existing) existing.setCoordinates(coords)
    else map.addSource(id, { type: 'image', url: o.url, coordinates: coords })
    if (!map.getLayer(id)) map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': o.opacity, 'raster-fade-duration': 0 } }, beforeId)
    map.setPaintProperty(id, 'raster-opacity', o.opacity)
    map.setLayoutProperty(id, 'visibility', o.visible ? 'visible' : 'none')
  }
}

// ------------------------------------------------------------------ DOM labels (no glyph server => offline friendly)
export class LabelLayer {
  private markers = new Map<string, { m: maplibregl.Marker; el: HTMLDivElement; key: string }>()
  constructor(private map: maplibregl.Map) {}

  set(items: LabelItem[]): void {
    const seen = new Set<string>()
    for (const it of items) {
      seen.add(it.id)
      const key = `${it.cls}|${it.text}`
      const cur = this.markers.get(it.id)
      if (cur) {
        cur.m.setLngLat(it.at)
        if (cur.key !== key) {
          cur.el.className = `eden-label ${it.cls}`
          cur.el.textContent = it.text
          cur.key = key
        }
      } else {
        // MapLibre owns the marker element's classes/transform, so our styling lives on an inner element
        const host = document.createElement('div')
        const el = document.createElement('div')
        el.className = `eden-label ${it.cls}`
        el.textContent = it.text
        host.appendChild(el)
        host.style.pointerEvents = 'none'
        const m = new maplibregl.Marker({ element: host, anchor: 'center' }).setLngLat(it.at).addTo(this.map)
        this.markers.set(it.id, { m, el, key })
      }
    }
    for (const [id, v] of this.markers) {
      if (!seen.has(id)) {
        v.m.remove()
        this.markers.delete(id)
      }
    }
  }

  clear(): void {
    this.set([])
  }
}
