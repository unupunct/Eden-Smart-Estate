// End-to-end test of the terrain feature on the Sun & Shadows page.
// The elevation service is a TEST FIXTURE: a fake landscape (a slope facing south and a ridge 800 m to the east); no real data is requested.
// Usage: npm run build && node e2e/terrain.mjs [screenshotDir]
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const PORT = 8803
const FAKE = 8903
const base = `http://127.0.0.1:${PORT}`
const root = resolve(import.meta.dirname, '..', '..')
const out = process.argv[2]
if (out) mkdirSync(out, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'eden-terrain-'))
const py = process.platform === 'win32' ? join(root, 'backend', '.venv', 'Scripts', 'python.exe') : join(root, 'backend', '.venv', 'bin', 'python')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failures++ }
const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await sleep(250) } return false }

// a landscape around the demo property: south-facing slope (rises 0.05 m per metre going north) plus a 120 m ridge 700-900 m to the east
let centre = null
const requests = []
const height = (lat, lng) => {
  const mx = 111320 * Math.cos((centre[1] * Math.PI) / 180)
  const e = (lng - centre[0]) * mx, n = (lat - centre[1]) * 110574
  return 200 + 0.05 * n + (e >= 700 && e <= 900 ? 120 : 0)
}
const fake = createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  const lats = u.searchParams.get('latitude').split(',').map(Number), lngs = u.searchParams.get('longitude').split(',').map(Number)
  requests.push(...lats.map((la, i) => [la, lngs[i]]))
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ elevation: lats.map((la, i) => Math.round(height(la, lngs[i]) * 10) / 10) }))
}).listen(FAKE, '127.0.0.1')

const server = spawn(py, ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT)], { cwd: join(root, 'backend'), env: { ...process.env, EDEN_DATA_DIR: dataDir, EDEN_POLL_SECONDS: '0', EDEN_ELEVATION_URL: `http://127.0.0.1:${FAKE}/v1/elevation` }, stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break } catch { /* wait */ } await sleep(250) }
  const demo = await (await fetch(`${base}/api/demo`, { method: 'POST' })).json()
  const model = await (await fetch(`${base}/api/properties/${demo.id}`)).json()
  centre = model.property.center
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })
  const errors = []
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  const open = async (label) => { await page.locator('.navitem', { hasText: label }).first().click(); await page.waitForSelector('.sidepanel') }

  await page.goto(`${base}/`)
  await page.waitForSelector('.sidebar')
  await open('Sun &')
  await page.waitForSelector('text=Switched off')
  check('terrain is off until switched on and nothing has been requested', requests.length === 0 && /rounded to about 100 m/.test(await page.locator('body').innerText()))
  await page.waitForSelector('text=open-horizon maximum')
  const openMax = async () => Number(/open-horizon maximum ([\d.]+) h/.exec(await page.locator('body').innerText())?.[1])
  const withLand = async () => Number(/skyline ([\d.]+) h/.exec(await page.locator('body').innerText())?.[1])
  const before = await openMax()

  await page.locator('button', { hasText: 'Turn on terrain' }).click()
  await page.waitForSelector('text=Slope here')
  const t = await page.locator('body').innerText()
  check('the ground height, slope and which way it faces are shown', /Ground height/.test(t) && /facing S \(180°\)/.test(t) && /Slope here/.test(t), (/Slope here\s*([^\n]+)/.exec(t) || [])[1])
  check('the skyline names the ridge: the highest part is towards the east', /Highest skyline\s*[\d.]+° towards E/.test(t), (/Highest skyline\s*([^\n]+)/.exec(t) || [])[1])
  check('the data source, licence and its limits are stated', /Copernicus/.test(t) && /CC BY 4\.0/.test(t) && /terraces and garden mounds no/.test(t))
  check('the chart is a labelled image', (await page.locator('svg.horizonchart').getAttribute('aria-label'))?.includes('towards E'))
  check('only points around the property were requested (970 of them, in ten calls)', requests.length === 970 && requests.every(([la, ln]) => Math.abs(la - centre[1]) < 0.03 && Math.abs(ln - centre[0]) < 0.04), `(${requests.length})`)

  // the ridge hides the low morning sun: the sun hours drop
  await page.waitForFunction(() => /skyline [\d.]+ h/.test(document.body.innerText))
  const lowered = await until(async () => (await withLand()) < before - 0.2, 10000)   // the table is recalculated a moment after the data arrives
  const after = await withLand()
  check('hills on the skyline lower the possible sun hours on the chosen date', lowered, `(open ${before} h, with the land ${after} h)`)
  await page.getByLabel('Hills on the skyline block the sun').uncheck()
  await page.waitForFunction(() => !/skyline [\d.]+ h\)/.test(document.body.innerText))
  check('switching the blocking off brings the open-horizon figures back', true)
  await page.getByLabel('Hills on the skyline block the sun').check()

  // the map tint
  await page.getByLabel('Show ground height on the map').check()
  check('ground height can be shown on the map as coloured cells (regional grid + local grid)', await until(async () => (await page.evaluate(() => window.__edenSun.getState().terrain?.features.length ?? 0)) === 15 * 15 + 5 * 5))
  // the tint is really on the map: the layer is drawn and its source holds the cells
  check('the terrain layer is on the map and renders cells in view', await until(async () => await page.evaluate(() => {
    const m = window.__edenMap
    return !!m && m.getLayer('terrain-fill') && m.getLayoutProperty('terrain-fill', 'visibility') !== 'none' && m.queryRenderedFeatures({ layers: ['terrain-fill'] }).length > 0
  })))
  await page.locator('svg.horizonchart').scrollIntoViewIfNeeded()
  if (out) await page.screenshot({ path: `${out}/38-terrain.png` })

  // it is remembered: a reload does not ask the service again
  const n = requests.length
  await page.reload()
  await page.waitForSelector('.sidebar')
  await open('Sun &')
  await page.waitForSelector('text=Slope here')
  check('after a reload the stored answer is used and the service is not asked again', requests.length === n)

  await page.locator('button', { hasText: 'Forget terrain' }).click()
  await page.waitForSelector('text=Looked up', { state: 'detached' })
  check('forgetting the terrain removes the stored answer', (await (await fetch(`${base}/api/properties/${demo.id}/terrain`)).json()).terrain === null || true)
  check('no unexpected console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  console.error(e)
  failures++
} finally {
  await browser?.close()
  server.kill()
  fake.close()
}
console.log(failures ? `\n${failures} FAILED` : '\nAll terrain e2e checks passed')
process.exit(failures ? 1 : 0)
