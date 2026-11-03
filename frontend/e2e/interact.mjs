// End-to-end test of the property editor. Spawns its own EDEN server on a temp data dir.
// Usage: npm run build && node e2e/interact.mjs   (needs Microsoft Edge or Chrome installed)
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const PORT = 8791
const base = `http://127.0.0.1:${PORT}`
const root = resolve(import.meta.dirname, '..', '..')
const out = process.argv[2]
if (out) mkdirSync(out, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'eden-e2e-'))
const py = process.platform === 'win32' ? join(root, 'backend', '.venv', 'Scripts', 'python.exe') : join(root, 'backend', '.venv', 'bin', 'python')
const server = spawn(py, ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT)], { cwd: join(root, 'backend'), env: { ...process.env, EDEN_DATA_DIR: dataDir }, stdio: 'ignore' })

let failures = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
  if (!ok) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return } catch { /* not up yet */ }
    await sleep(250)
  }
  throw new Error('server did not start')
}

let browser
try {
  await waitForServer()
  const created = await (await fetch(`${base}/api/properties`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'E2E estate', center: [24.05261, 46.04842], zoom: 18 }) })).json()
  const pid = created.id
  const model = async () => (await fetch(`${base}/api/properties/${pid}`)).json()
  const geojson = async () => (await fetch(`${base}/api/properties/${pid}/export.geojson`)).json()
  const saved = async () => { await sleep(1000); await page.waitForFunction(() => window.__edenStore.getState().save.status === 'saved', null, { timeout: 20000 }); await sleep(250) } // autosave debounce is 700 ms
  const settle = () => page.waitForFunction(() => !window.__edenMap.isMoving() && window.__edenMap.loaded(), null, { timeout: 15000 }).then(() => sleep(400))

  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
  const errors = []
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))

  await page.goto(`${base}/#editor`)
  await page.waitForSelector('.maplibregl-canvas')
  await page.waitForFunction(() => window.__edenMap?.loaded?.(), null, { timeout: 20000 })
  const box = await page.locator('.map').boundingBox()
  const px = (lng, lat) => page.evaluate(([a, b]) => { const p = window.__edenMap.project([a, b]); return [p.x, p.y] }, [lng, lat]).then(([x, y]) => [box.x + x, box.y + y])
  const at = async (dx, dy) => { const c = await page.evaluate(() => { const p = window.__edenMap.project(window.__edenMap.getCenter()); return [p.x, p.y] }); return [box.x + c[0] + dx, box.y + c[1] + dy] }
  const click = async (dx, dy) => { const [x, y] = await at(dx, dy); await page.mouse.click(x, y); await sleep(60) }
  const tool = (label) => page.locator('.palette .pal', { hasText: label }).first().click()
  const panelText = () => page.locator('.rightpanel').innerText()

  check('editor opens with the property', (await page.locator('.rightpanel h3').first().innerText()) === 'Property')

  // ---- boundary: polygon, closing by clicking the first vertex
  await tool('Property boundary')
  for (const [dx, dy] of [[-200, -150], [220, -140], [240, 160], [-180, 170]]) await click(dx, dy)
  await click(-200, -150) // close
  await sleep(300)
  let n = Object.keys((await page.evaluate(() => 1) && {})).length
  await saved()
  let gj = await geojson()
  const boundary = gj.features.find((f) => f.properties.kind === 'boundary')
  check('boundary drawn and autosaved', !!boundary, boundary ? `${boundary.properties.area_m2} m2` : '')
  const shown = await page.locator('.statusbar').innerText()
  check('status bar shows property area', /m²/.test(shown) && boundary && shown.replace(/,/g, '').includes(String(Math.round(boundary.properties.area_m2))), shown.split('\n').find((l) => l.includes('Property area')) ?? '')
  check('selection panel opens for the new object', (await panelText()).includes('Property boundary'))

  // ---- building via rectangle shape
  await tool('Building')
  await page.locator('.tooloptions .seg button', { hasText: 'rectangle' }).click()
  await click(-120, -60)
  await click(-40, 10)
  await sleep(200)
  await page.keyboard.press('Escape')
  await saved()
  gj = await geojson()
  const bld = gj.features.find((f) => f.properties.kind === 'building')
  check('rectangle building drawn', !!bld && bld.geometry.coordinates[0].length === 5, bld ? `${bld.properties.area_m2} m2` : '')

  // ---- fence line with snapping to the boundary corner, finish with double-click
  await tool('Fence')
  await click(-200, -150)
  await click(0, -150)
  { const [x, y] = await at(200, -140); await page.mouse.dblclick(x, y) }
  await sleep(200)
  await saved()
  gj = await geojson()
  const fence = gj.features.find((f) => f.properties.kind === 'fence')
  check('fence drawn, length measured', !!fence && fence.properties.length_m > 60, fence ? `${fence.properties.length_m} m` : '')
  const b0 = boundary.geometry.coordinates[0][0]
  const f0 = fence.geometry.coordinates[0]
  check('fence start snapped exactly onto the boundary corner', Math.abs(b0[0] - f0[0]) < 1e-9 && Math.abs(b0[1] - f0[1]) < 1e-9)

  // ---- points: tree + bush stay in tool until Esc
  await tool('Tree')
  await click(60, 40)
  await click(110, 60)
  await page.keyboard.press('Escape')
  await tool('Bush')
  await click(150, 100)
  await page.keyboard.press('Escape')
  await saved()
  gj = await geojson()
  check('trees and bush placed', gj.features.filter((f) => f.properties.kind === 'tree').length === 2 && gj.features.filter((f) => f.properties.kind === 'bush').length === 1)

  // ---- garden zone, greenhouse, pond, note
  await tool('Zone'); await page.locator('.tooloptions .seg button', { hasText: 'polygon' }).click(); await click(-100, 80); await click(-30, 80); await click(-30, 130); await click(-100, 130); await page.keyboard.press('Enter')
  await tool('Greenhouse'); await page.locator('.tooloptions .seg button', { hasText: 'rectangle' }).click(); await click(20, -100); await click(70, -70); await page.keyboard.press('Escape')
  await tool('Pond'); await page.locator('.tooloptions .seg button', { hasText: 'circle' }).click(); await click(150, -60); await click(190, -60); await page.keyboard.press('Escape')
  await tool('Note'); await click(-150, 20); await page.keyboard.press('Escape')
  await saved()
  gj = await geojson()
  const kinds = gj.features.map((f) => f.properties.kind)
  check('zone, greenhouse, pond (circle) and note created', ['zone', 'greenhouse', 'pond', 'note'].every((k) => kinds.includes(k)), kinds.join(','))
  const pond = gj.features.find((f) => f.properties.kind === 'pond')
  check('circle pond is round (perimeter^2 / area = 4*pi)', pond && Math.abs((pond.properties.length_m ** 2) / pond.properties.area_m2 / (4 * Math.PI) - 1) < 0.02, pond ? `${pond.properties.area_m2} m2` : '')

  // ---- select building, edit properties
  await page.locator('.tool', { hasText: 'Select' }).click()
  await click(-80, -25)
  check('click selects the building', (await panelText()).includes('Building'))
  await page.locator('.rightpanel label:has-text("Name") input').first().fill('Main barn')
  await page.locator('.rightpanel label:has-text("Floors") input').fill('2')
  await saved()
  let m = await model()
  let bo = m.objects.find((o) => o.kind === 'building')
  check('name and attributes persisted', bo.name === 'Main barn' && bo.props.floors === 2)

  // ---- drag to move, then undo/redo
  const before = JSON.stringify(bo.geometry)
  { const [x, y] = await at(-80, -25); await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 40, y + 30, { steps: 6 }); await page.mouse.up() }
  await saved()
  m = await model(); bo = m.objects.find((o) => o.kind === 'building')
  check('dragging moves the object', JSON.stringify(bo.geometry) !== before)
  await page.keyboard.press('Control+z')
  await saved()
  m = await model(); bo = m.objects.find((o) => o.kind === 'building')
  check('undo restores the position', JSON.stringify(bo.geometry) === before)
  await page.keyboard.press('Control+y')
  await saved()
  m = await model(); bo = m.objects.find((o) => o.kind === 'building')
  check('redo re-applies the move', JSON.stringify(bo.geometry) !== before)
  await page.keyboard.press('Control+z')

  // ---- vertex drag + add vertex via midpoint + remove vertex
  await page.screenshot({ path: out ? `${out}/selected.png` : undefined })
  const ringPx = async () => { const mm = await model(); const o = mm.objects.find((x) => x.kind === 'building'); return { o, pts: await Promise.all(o.geometry.coordinates[0].slice(0, -1).map((c) => px(c[0], c[1]))) } }
  { const { pts } = await ringPx(); await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); await page.mouse.move(pts[0][0] - 25, pts[0][1] - 20, { steps: 5 }); await page.mouse.up() }
  await saved()
  { const { o } = await ringPx(); check('dragging a corner reshapes the polygon', o.geometry.coordinates[0].length === 5 && JSON.stringify(o.geometry) !== before) }
  { const { pts } = await ringPx(); const mid = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]; await page.mouse.move(mid[0], mid[1]); await page.mouse.down(); await page.mouse.move(mid[0], mid[1] - 20, { steps: 4 }); await page.mouse.up() }
  await saved()
  { const { o } = await ringPx(); check('dragging an edge handle adds a corner', o.geometry.coordinates[0].length === 6) }
  { const { pts } = await ringPx(); await page.mouse.click(pts[1][0], pts[1][1], { button: 'right' }) }
  await saved()
  { const { o } = await ringPx(); check('right-click removes a corner', o.geometry.coordinates[0].length === 5) }

  // ---- rotate via panel
  const areaBefore = (await geojson()).features.find((f) => f.properties.kind === 'building').properties.area_m2
  await page.locator('.rightpanel button', { hasText: '90°' }).click()
  await saved()
  const areaAfter = (await geojson()).features.find((f) => f.properties.kind === 'building').properties.area_m2
  check('rotating preserves area', Math.abs(areaAfter - areaBefore) / areaBefore < 0.002, `${areaBefore} -> ${areaAfter}`)

  // ---- duplicate and delete
  const count0 = (await model()).objects.length
  await page.keyboard.press('Control+d')
  await saved()
  check('Ctrl+D duplicates', (await model()).objects.length === count0 + 1)
  await page.keyboard.press('Delete')
  await saved()
  check('Delete removes the selection', (await model()).objects.length === count0)

  // ---- layers: hide, lock
  await page.locator('.leftpanel .tabs button', { hasText: 'Layers' }).click()
  const bRow = page.locator('.layerrow', { hasText: 'Buildings' }).first()
  await bRow.locator('button').first().click()
  await settle()
  const countBuildings = () => page.evaluate(() => window.__edenMap.queryRenderedFeatures(undefined, { layers: ['eden-fill'] }).filter((f) => f.properties.kind === 'building').length)
  let hidden = await countBuildings()
  for (let i = 0; i < 12 && hidden !== 0; i++) { await sleep(250); hidden = await countBuildings() } // the map repaints on the next frame
  check('hiding a layer removes its objects from the map', hidden === 0)
  await bRow.locator('button').first().click()
  await saved()
  m = await model()
  check('layer visibility persisted', m.layers.find((l) => l.key === 'buildings').visible === true)
  await bRow.locator('button').nth(1).click() // lock
  await page.locator('.leftpanel .tabs button', { hasText: 'Draw' }).click()
  await click(-80, -25)
  check('locked layer objects cannot be selected', !(await panelText()).includes('Main barn'))
  await page.locator('.leftpanel .tabs button', { hasText: 'Layers' }).click()
  await bRow.locator('button').nth(1).click() // unlock

  // ---- measuring tools
  await page.locator('.leftpanel .tabs button', { hasText: 'Draw' }).click()
  await page.locator('.tool', { hasText: 'Distance' }).click()
  await click(-150, 200); { const [x, y] = await at(50, 200); await click(-50, 200); await page.mouse.dblclick(x, y) }
  await sleep(200)
  const label = await page.locator('.eden-label.measure').first().innerText().catch(() => '')
  check('distance tool shows a length label', /\d+(\.\d+)? m/.test(label), label)
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')

  // ---- image import with two-point calibration
  {
    const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 800; c.height = 500; const g = c.getContext('2d'); g.fillStyle = '#446'; g.fillRect(0, 0, 800, 500); g.fillStyle = '#fc0'; g.fillRect(100, 100, 40, 40); g.fillRect(660, 100, 40, 40); return c.toDataURL('image/png').split(',')[1] })
    const file = join(dataDir, 'aerial.png')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(file, Buffer.from(png, 'base64'))
    await page.locator('.leftpanel .tabs button', { hasText: 'Images' }).click()
    await page.locator('button', { hasText: 'Import and calibrate image' }).click()
    await page.locator('.modal input[type=file]').first().setInputFiles(file)
    await page.waitForSelector('.calimg img')
    const ib = await page.locator('.calimg img').boundingBox()
    await page.mouse.click(ib.x + ib.width * 0.15, ib.y + ib.height * 0.25) // picture point 1 (120,125)
    await page.mouse.click(ib.x + ib.width * 0.85, ib.y + ib.height * 0.25) // picture point 2 (680,125): 560 px apart
    await page.locator('.modal button', { hasText: 'Next: pick on the map' }).click()
    check('calibration banner guides the map clicks', (await page.locator('.hintbar').innerText()).includes('point 1'))
    const metresPerPx = await page.evaluate(() => { const mp = window.__edenMap; const c = mp.getCenter(); return 78271.517 * Math.cos((c.lat * Math.PI) / 180) / 2 ** mp.getZoom() })
    await click(-150, 230)
    await click(150, 230) // 300 screen px apart
    await sleep(2500)
    m = await model()
    check('overlay stored after calibration', m.overlays.length === 1)
    if (m.overlays.length) {
      const [tl, tr] = m.overlays[0].corners
      const R = 6371008.8, rad = (d) => (d * Math.PI) / 180
      const h = Math.sin(rad(tr[1] - tl[1]) / 2) ** 2 + Math.cos(rad(tl[1])) * Math.cos(rad(tr[1])) * Math.sin(rad(tr[0] - tl[0]) / 2) ** 2
      const widthM = 2 * R * Math.asin(Math.sqrt(h))
      const expected = (300 / 560) * 800 * metresPerPx
      check('image scale matches the two calibration points', Math.abs(widthM / expected - 1) < 0.03, `${widthM.toFixed(1)} m vs ${expected.toFixed(1)} m`)
      const img = await fetch(`${base}${m.overlays[0].url}`)
      check('overlay image served back', img.ok && img.headers.get('content-type') === 'image/png')
    }
    check('image layer exists on the map', await page.evaluate(() => Object.keys(window.__edenMap.getStyle().sources).some((k) => k.startsWith('ov-'))))
    await page.screenshot({ path: out ? `${out}/overlay.png` : undefined })
    await page.locator('.leftpanel .tabs button', { hasText: 'Draw' }).click()
  }

  // ---- 3D
  await page.locator('.tb', { hasText: '2D' }).click()
  await sleep(1500)
  const pitch = await page.evaluate(() => window.__edenMap.getPitch())
  check('3D mode tilts the camera and extrudes buildings', pitch > 30 && await page.evaluate(() => window.__edenMap.getLayoutProperty('eden-extrusion', 'visibility') === 'visible'), `pitch ${pitch.toFixed(0)}`)
  await page.screenshot({ path: out ? `${out}/3d.png` : undefined })
  await page.locator('.tb', { hasText: '3D' }).click()
  await sleep(1000)

  // ---- basemap switch
  await page.locator('label.tb select').selectOption('streets')
  await sleep(1000)
  check('basemap switch swaps raster sources', await page.evaluate(() => Object.keys(window.__edenMap.getStyle().sources).some((s) => s.startsWith('base-'))))
  await page.locator('label.tb select').selectOption('satellite')

  // ---- persistence across reload
  await saved()
  const final = await model()
  await page.reload()
  await page.waitForFunction(() => window.__edenMap?.loaded?.(), null, { timeout: 20000 })
  await sleep(800)
  const status = await page.locator('.statusbar').innerText()
  check('reload restores the property (area shown)', /m²/.test(status))
  check('saved view restored', await page.evaluate(([lng, lat]) => { const c = window.__edenMap.getCenter(); return Math.abs(c.lng - lng) < 0.01 && Math.abs(c.lat - lat) < 0.01 }, final.property.center))
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  console.error('E2E crashed:', e)
  failures++
} finally {
  await browser?.close()
  server.kill()
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
