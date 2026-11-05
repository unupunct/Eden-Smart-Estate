// Generates the README screenshots from the fictional DEMO estate only (never real data).
// Usage: npm run build && node e2e/screenshots.mjs ../docs/screenshots
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const PORT = 8792
const base = `http://127.0.0.1:${PORT}`
const root = resolve(import.meta.dirname, '..', '..')
const out = resolve(process.argv[2] ?? join(root, 'docs', 'screenshots'))
mkdirSync(out, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'eden-shots-')) // fresh, empty data: nothing personal can leak in
const py = process.platform === 'win32' ? join(root, 'backend', '.venv', 'Scripts', 'python.exe') : join(root, 'backend', '.venv', 'bin', 'python')
const server = spawn(py, ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT)], { cwd: join(root, 'backend'), env: { ...process.env, EDEN_DATA_DIR: dataDir }, stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let browser
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break } catch { /* wait */ } await sleep(250) }
  const demo = await (await fetch(`${base}/api/demo`, { method: 'POST' })).json()
  const model = await (await fetch(`${base}/api/properties/${demo.id}`)).json()
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1 })
  const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) })
  const settle = async () => { await page.waitForFunction(() => !window.__edenMap.isMoving() && window.__edenMap.loaded(), null, { timeout: 30000 }); await sleep(1200) }

  await page.goto(`${base}/#overview`)
  await page.waitForSelector('text=Estate Overview')
  await shot('00-welcome')
  await page.goto(`${base}/#overview`)
  await page.reload()
  await page.waitForSelector('text=DEMO DATA')
  await sleep(500)
  await shot('01-overview')

  await page.locator('.navitem', { hasText: 'Property Editor' }).click()
  await page.waitForSelector('.maplibregl-canvas')
  await page.waitForFunction(() => window.__edenMap?.loaded?.())
  await settle()
  await shot('02-property-editor')

  // select the main house
  const house = model.objects.find((o) => o.name === 'Main house')
  const ring = house.geometry.coordinates[0]
  const cx = ring.slice(0, 4).reduce((a, p) => a + p[0], 0) / 4
  const cy = ring.slice(0, 4).reduce((a, p) => a + p[1], 0) / 4
  await page.evaluate(([lng, lat]) => window.__edenMap.easeTo({ center: [lng, lat], zoom: 19.2, duration: 0 }), [cx, cy])
  await settle()
  const box = await page.locator('.map').boundingBox()
  const c = await page.evaluate(([lng, lat]) => { const p = window.__edenMap.project([lng, lat]); return [p.x, p.y] }, [cx, cy])
  await page.mouse.click(box.x + c[0], box.y + c[1])
  await sleep(900)
  await shot('03-object-properties')

  await page.keyboard.press('Escape')
  await page.locator('.leftpanel .tabs button', { hasText: 'Layers' }).click()
  await page.evaluate(([lng, lat]) => window.__edenMap.easeTo({ center: [lng, lat], zoom: 17.9, duration: 0 }), model.property.center)
  await settle()
  await shot('04-layers')

  await page.locator('.leftpanel .tabs button', { hasText: 'Draw' }).click()
  await page.locator('.tb', { hasText: '2D' }).click()
  await page.evaluate(([lng, lat]) => window.__edenMap.easeTo({ center: [lng, lat], zoom: 18.4, bearing: -25, pitch: 62, duration: 0 }), model.property.center)
  await settle()
  await shot('05-3d-view')
  await page.locator('.tb', { hasText: '3D' }).click()
  await page.evaluate(([lng, lat]) => window.__edenMap.easeTo({ center: [lng, lat], zoom: 17.9, bearing: 0, pitch: 0, duration: 0 }), model.property.center)
  await settle()

  // measuring along the driveway
  const road = model.objects.find((o) => o.name === 'Driveway')
  await page.locator('.tool', { hasText: 'Distance' }).click()
  const pts = []
  for (const q of [road.geometry.coordinates[0], road.geometry.coordinates[1], road.geometry.coordinates[2]]) pts.push(await page.evaluate(([lng, lat]) => { const p = window.__edenMap.project([lng, lat]); return [p.x, p.y] }, q))
  await page.keyboard.down('Alt') // bypass snapping so the pins sit exactly where clicked
  for (const [i, p] of pts.entries()) { if (i === pts.length - 1) await page.mouse.dblclick(box.x + p[0] + 30, box.y + p[1]); else await page.mouse.click(box.x + p[0] + 30, box.y + p[1]); await sleep(150) }
  await page.keyboard.up('Alt')
  await sleep(500)
  await shot('06-measure')
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')

  // ---------------------------------------------------------------- Phase 3
  const byName = (n) => model.objects.find((o) => o.name === n)
  const ctr = (o) => { const g = o.geometry; const pts = g.type === 'Point' ? [g.coordinates] : g.type === 'LineString' ? g.coordinates : g.coordinates[0].slice(0, -1); return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length] }
  const pick = async (o, zoom) => {
    const c = ctr(o)
    await page.evaluate(([lng, lat, z]) => window.__edenMap.jumpTo({ center: [lng, lat], zoom: z }), [c[0], c[1], zoom])
    await settle()
    const p = await page.evaluate(([lng, lat]) => { const q = window.__edenMap.project([lng, lat]); return [q.x, q.y] }, c)
    await page.mouse.click(box.x + p[0], box.y + p[1])
    await sleep(700)
  }
  const scrollPanelTo = async (re) => { await page.locator('.rightpanel h4', { hasText: re }).first().scrollIntoViewIfNeeded(); await sleep(300) }
  await page.locator('.navitem', { hasText: 'Property Editor' }).click()
  await page.waitForFunction(() => window.__edenMap?.loaded?.())

  await pick(byName('Bed 5'), 19.6)
  await scrollPanelTo(/plantings/i)
  await shot('09-bed-plantings')

  await pick(byName('Tomato'), 21.2)
  await scrollPanelTo(/companion planting/i)
  await shot('10-companion-links')

  await page.keyboard.press('Escape')
  await page.evaluate(() => { const s = document.querySelector('.rightpanel .scroll'); if (s) s.scrollTop = 0 })
  await page.locator('label.chip, button.chip', { hasText: 'Mature canopy' }).first().click()
  await page.evaluate(([lng, lat]) => window.__edenMap.jumpTo({ center: [lng, lat], zoom: 18.1 }), ctr(byName('Orchard')))
  await settle()
  await shot('11-mature-canopy')
  await page.locator('button.chip', { hasText: 'Mature canopy' }).first().click()

  await pick(byName('Apple 1'), 19.4)
  await scrollPanelTo(/tree record/i)
  await shot('12-tree-record')

  await page.fill('.search input', 'Natural swimming')
  await page.locator('.searchpop button', { hasText: 'Natural swimming pond' }).first().click()
  await settle(); await sleep(500)
  await scrollPanelTo(/^fish$/i)
  await shot('13-pond-panel')

  await page.locator('.navitem', { hasText: 'Plants & Mushrooms' }).click()
  await page.waitForSelector('text=Plants & trees')
  await page.locator('.liblist .item', { hasText: 'Apple' }).first().click()
  await sleep(300)
  await shot('14-plant-library')
  await page.locator('.seg button', { hasText: 'Mushrooms' }).click()
  await page.locator('.liblist .item', { hasText: 'Death cap' }).click()
  await sleep(300)
  await shot('15-mushroom-safety')

  await page.locator('.navitem', { hasText: 'Garden' }).click()
  await page.waitForSelector('text=Companion planting explorer')
  await sleep(300)
  await shot('16-garden-page')
  await page.locator('.navitem', { hasText: 'Orchard' }).click()
  await page.waitForSelector('text=By species')
  await sleep(300)
  await shot('17-orchard-page')
  await page.locator('.navitem', { hasText: 'Greenhouse' }).click()
  await page.waitForSelector('text=Floor area')
  await sleep(300)
  await shot('18-greenhouse-page')
  await page.locator('.navitem', { hasText: 'Natural Swimming Pond' }).click()
  await page.waitForSelector('text=Latest water reading')
  await sleep(300)
  await shot('19-pond-page')

  // ---------------------------------------------------------------- Phase 4
  const BUCHAREST = 'Europe/Bucharest'
  const setSun = (patch) => page.evaluate((p) => window.__edenSun.getState().set(p), patch)
  const local = (y, mo, d, h, mi = 0, off = 3) => Date.UTC(y, mo - 1, d, h - off, mi) // UTC+3 in summer, UTC+2 in winter
  await page.locator('.navitem', { hasText: 'Sun & Shadows' }).click()
  await page.waitForSelector('.sunpage .maplibregl-canvas')
  await page.waitForFunction(() => window.__edenMap?.loaded?.())
  await setSun({ tz: BUCHAREST, instant: local(2025, 6, 21, 16, 30), leaf: 'auto', heatOn: false })
  await page.evaluate(([lng, lat]) => window.__edenMap.jumpTo({ center: [lng, lat], zoom: 18.1 }), model.property.center)
  await settle(); await sleep(3500)
  await shot('20-sun-shadows')
  await page.evaluate(() => { document.querySelector('.sunpage').scrollTop = 99999 })
  await sleep(400)
  await shot('21-sun-seasons')
  await page.evaluate(() => { document.querySelector('.sunpage').scrollTop = 0 })
  await setSun({ heatOn: true, instant: local(2025, 6, 21, 12, 0) })
  await sleep(5000)
  await shot('22-sun-hours-map')
  await setSun({ heatOn: false, instant: local(2025, 12, 21, 12, 0, 2) })
  await sleep(2500)
  await shot('23-winter-shadows')

  await page.locator('.navitem', { hasText: 'Night Sky' }).click()
  await page.waitForSelector('.skycanvas canvas')
  await setSun({ tz: BUCHAREST, instant: local(2025, 11, 3, 22, 0, 2) })
  await sleep(1200)
  await shot('24-night-sky')

  await page.locator('.navitem', { hasText: 'Buildings' }).click()
  await page.waitForSelector('text=Floor area')
  await sleep(500)
  await shot('34-buildings')
  await page.keyboard.press('Control+k')
  await page.keyboard.type('apple')
  await page.waitForSelector('.palette-item')
  await sleep(500)
  await shot('35-search')
  await page.keyboard.press('Escape')
  await page.locator('.navitem', { hasText: 'Settings' }).click()
  await sleep(600)
  await shot('08-settings')
  console.log('screenshots written to', out)
} finally {
  await browser?.close()
  server.kill()
}
