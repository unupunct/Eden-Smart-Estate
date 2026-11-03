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

  await page.locator('.navitem', { hasText: 'Orchard' }).click()
  await sleep(500)
  await shot('07-orchard-module')
  await page.locator('.navitem', { hasText: 'Settings' }).click()
  await sleep(600)
  await shot('08-settings')
  console.log('screenshots written to', out)
} finally {
  await browser?.close()
  server.kill()
}
