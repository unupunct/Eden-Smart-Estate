import type * as maplibregl from 'maplibre-gl'

export const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

/** First eden layer: base rasters and image overlays are inserted below it. */
export const FIRST_EDEN_LAYER = 'eden-wedge'

const Z24 = 16777216 // 2^24: with an exponential(2) zoom ramp this keeps metre-sized things true to scale
const metric = (prop: string): maplibregl.ExpressionSpecification => [
  'interpolate', ['exponential', 2], ['zoom'], 0, ['get', prop], 24, ['*', ['get', prop], Z24],
]

const isPoly: maplibregl.ExpressionSpecification = ['==', ['geometry-type'], 'Polygon']
const isLine: maplibregl.ExpressionSpecification = ['==', ['geometry-type'], 'LineString']
const isPoint: maplibregl.ExpressionSpecification = ['==', ['geometry-type'], 'Point']
const dashed = (v: boolean): maplibregl.ExpressionSpecification => ['==', ['get', 'dashed'], v]
const sel: maplibregl.ExpressionSpecification = ['==', ['get', 'selected'], true]

export const HIT_LAYERS = {
  points: ['eden-point', 'eden-point-tree', 'eden-canopy'],
  lines: ['eden-line-solid', 'eden-line-dashed', 'eden-outline-solid', 'eden-outline-dashed', 'eden-road-casing'],
  fills: ['eden-fill'],
}

export function installEdenLayers(map: maplibregl.Map): void {
  const src = (id: string) => map.addSource(id, { type: 'geojson', data: EMPTY })
  ;['eden', 'ext', 'wedges', 'mature', 'compat', 'handles', 'draw', 'shadow', 'sunheat', 'terrain'].forEach(src)

  const add = (l: maplibregl.LayerSpecification) => map.addLayer(l)

  // camera coverage wedges sit under everything else
  add({ id: 'eden-wedge', type: 'fill', source: 'wedges', paint: { 'fill-color': '#f87171', 'fill-opacity': 0.17 } })
  add({ id: 'eden-wedge-line', type: 'line', source: 'wedges', paint: { 'line-color': '#fca5a5', 'line-width': 1.2, 'line-opacity': 0.85 } })

  // sun-hours heat map and cast shadows lie on the ground, under the objects
  add({ id: 'terrain-fill', type: 'fill', source: 'terrain',
    paint: { 'fill-color': ['interpolate', ['linear'], ['get', 'rel'], 0, '#1e3a8a', 0.2, '#0e7490', 0.45, '#65a30d', 0.7, '#ca8a04', 0.9, '#92400e', 1, '#f5f5f4'],
      'fill-opacity': ['case', ['==', ['get', 'level'], 'local'], 0.5, 0.3], 'fill-antialias': true } })
  add({ id: 'sunheat-fill', type: 'fill', source: 'sunheat',
    paint: { 'fill-color': ['interpolate', ['linear'], ['get', 'hours'], 0, '#312e81', 3, '#38bdf8', 6, '#a3e635', 9, '#fbbf24', 12, '#f97316', 15, '#ef4444'], 'fill-opacity': 0.55, 'fill-antialias': false } })
  add({ id: 'shadow-light', type: 'fill', source: 'shadow', filter: ['==', ['get', 'cls'], 'light'], paint: { 'fill-color': '#05080f', 'fill-opacity': 0.22 } })
  add({ id: 'shadow-dense', type: 'fill', source: 'shadow', filter: ['==', ['get', 'cls'], 'dense'], paint: { 'fill-color': '#05080f', 'fill-opacity': 0.5 } })

  add({ id: 'eden-fill', type: 'fill', source: 'eden', filter: isPoly,
    layout: { 'fill-sort-key': ['get', 'sort'] },
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'fillOpacity'] } })

  add({ id: 'eden-sel-halo', type: 'line', source: 'eden', filter: ['all', ['any', isPoly, isLine], sel],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-opacity': 0.55, 'line-width': ['+', ['get', 'lineWidth'], 6], 'line-blur': 1 } })

  add({ id: 'eden-road-casing', type: 'line', source: 'eden', filter: ['all', isLine, ['>', ['get', 'wpx'], 0]],
    layout: { 'line-cap': 'butt', 'line-join': 'round', 'line-sort-key': ['get', 'sort'] },
    paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.72, 'line-width': metric('wpx') } })

  add({ id: 'eden-outline-solid', type: 'line', source: 'eden', filter: ['all', isPoly, dashed(false)],
    layout: { 'line-join': 'round', 'line-sort-key': ['get', 'sort'] },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'lineWidth'] } })
  add({ id: 'eden-outline-dashed', type: 'line', source: 'eden', filter: ['all', isPoly, dashed(true)],
    layout: { 'line-join': 'round', 'line-sort-key': ['get', 'sort'] },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'lineWidth'], 'line-dasharray': [3, 2] } })

  add({ id: 'eden-line-solid', type: 'line', source: 'eden', filter: ['all', isLine, dashed(false)],
    layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'sort'] },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['>', ['get', 'wpx'], 0], 1.5, ['get', 'lineWidth']] } })
  add({ id: 'eden-line-dashed', type: 'line', source: 'eden', filter: ['all', isLine, dashed(true)],
    layout: { 'line-join': 'round', 'line-sort-key': ['get', 'sort'] },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'lineWidth'], 'line-dasharray': [3, 2] } })

  // 3D: extruded buildings, tree crowns, fences. Hidden in 2D.
  add({ id: 'eden-extrusion', type: 'fill-extrusion', source: 'ext', layout: { visibility: 'none' },
    paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-opacity': 0.9 } })

  // projected mature canopy of trees (optional) sits under the live canopy circles
  add({ id: 'eden-mature-fill', type: 'fill', source: 'mature', paint: { 'fill-color': '#4ade80', 'fill-opacity': 0.07 } })
  add({ id: 'eden-mature-line', type: 'line', source: 'mature', paint: { 'line-color': '#bbf7d0', 'line-width': 1.2, 'line-opacity': 0.75, 'line-dasharray': [3, 2] } })

  add({ id: 'eden-canopy', type: 'circle', source: 'eden', filter: ['all', isPoint, ['>', ['get', 'rpx'], 0]],
    paint: { 'circle-radius': metric('rpx'), 'circle-color': ['get', 'color'], 'circle-opacity': 0.28,
      'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 1.2, 'circle-stroke-opacity': 0.9, 'circle-pitch-alignment': 'map' } })

  add({ id: 'eden-point-halo', type: 'circle', source: 'eden', filter: ['all', isPoint, sel],
    paint: { 'circle-radius': 19, 'circle-color': '#ffffff', 'circle-opacity': 0.22, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } })
  // trees and bushes already show their true canopy circle, so their badge only appears when zoomed in
  add({ id: 'eden-point-tree', type: 'symbol', source: 'eden', filter: ['all', isPoint, ['>', ['get', 'rpx'], 0]],
    layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 17.6, 0, 18.6, 0.45, 20.5, 0.8], 'symbol-sort-key': ['get', 'sort'] } })
  add({ id: 'eden-point', type: 'symbol', source: 'eden', filter: ['all', isPoint, ['==', ['get', 'rpx'], 0]],
    layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.5, 19, 0.85], 'symbol-sort-key': ['get', 'sort'] } })

  // companion-planting links from the selected plant to its neighbours (green / yellow / red)
  add({ id: 'eden-compat', type: 'line', source: 'compat', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 3.5, 'line-opacity': 0.95 } })
  add({ id: 'eden-compat-end', type: 'circle', source: 'compat', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 7, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#0c1114', 'circle-stroke-width': 2 } })

  // selection handles
  add({ id: 'h-stem', type: 'line', source: 'handles', filter: ['==', ['get', 'role'], 'stem'], paint: { 'line-color': '#34d399', 'line-width': 1.5 } })
  add({ id: 'h-mid', type: 'circle', source: 'handles', filter: ['==', ['get', 'role'], 'mid'],
    paint: { 'circle-radius': 4.5, 'circle-color': '#34d399', 'circle-opacity': 0.55, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } })
  add({ id: 'h-vertex', type: 'circle', source: 'handles', filter: ['==', ['get', 'role'], 'vertex'],
    paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#10b981', 'circle-stroke-width': 2.5 } })
  add({ id: 'h-rotate', type: 'circle', source: 'handles', filter: ['==', ['get', 'role'], 'rotate'],
    paint: { 'circle-radius': 8, 'circle-color': '#10b981', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } })

  // drawing / measuring preview
  add({ id: 'draw-fill', type: 'fill', source: 'draw', filter: isPoly, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.22 } })
  add({ id: 'draw-line', type: 'line', source: 'draw', filter: ['in', ['geometry-type'], ['literal', ['LineString', 'Polygon']]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-dasharray': [2, 1.5] } })
  add({ id: 'draw-vertex', type: 'circle', source: 'draw', filter: ['==', ['get', 'role'], 'vertex'],
    paint: { 'circle-radius': 4.5, 'circle-color': '#ffffff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2 } })
  add({ id: 'draw-first', type: 'circle', source: 'draw', filter: ['==', ['get', 'role'], 'first'],
    paint: { 'circle-radius': 8, 'circle-color': ['get', 'color'], 'circle-opacity': 0.35, 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2 } })
  add({ id: 'draw-snap', type: 'circle', source: 'draw', filter: ['==', ['get', 'role'], 'snap'],
    paint: { 'circle-radius': 7, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#fb923c', 'circle-stroke-width': 2.5 } })
}
