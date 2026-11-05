// End-to-end test of neighbouring buildings on the Sun & Shadows page, and of pitched roofs in the 3D view.
// The Overpass (OpenStreetMap) service is a TEST FIXTURE serving a few made-up building outlines around the demo property; no real data is requested.
// Usage: npm run build && node e2e/neighbours.mjs [screenshotDir]
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const PORT = 8805
const FAKE = 8905
const base = `http://127.0.0.1:${PORT}`
const root = resolve(import.meta.dirname, '..', '..')
const out = process.argv[2]
if (out) mkdirSync(out, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'eden-neigh-'))
const py = process.platform === 'win32' ? join(root, 'backend', '.venv', 'Scripts', 'python.exe') : join(root, 'backend', '.venv', 'bin', 'python')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failures++ }
const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await sleep(250) } return false }

let centre = null
const queries = []
const box = (id, tags, east, north, w, d) => {
  const mx = 111320 * Math.cos((centre[1] * Math.PI) / 180), my = 110574
  const pts = [[east, north], [east + w, north], [east + w, north + d], [east, north + d], [east, north]]
  return { type: 'way', id, tags, geometry: pts.map(([x, y]) => ({ lat: centre[1] + y / my, lon: centre[0] + x / mx })) }
}
const fake = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    queries.push(decodeURIComponent(body.replace(/\+/g, ' ')))
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ elements: [
      box(101, { building: 'house', height: '9', 'roof:shape': 'gabled', name: 'Casa vecinului' }, 150, 10, 12, 8),   // next door, height in the data
      box(102, { building: 'yes' }, 0, -20, 6, 6),                                                                     // on the property itself
      box(103, { building: 'garage' }, 140, -50, 6, 4),                                                                // no height anywhere
      box(104, { building: 'yes', 'building:levels': '2', 'roof:shape': 'hipped' }, 160, 40, 10, 9),                   // floors only
    ] }))
  })
}).listen(FAKE, '127.0.0.1')

const server = spawn(py, ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT)], { cwd: join(root, 'backend'), env: { ...process.env, EDEN_DATA_DIR: dataDir, EDEN_POLL_SECONDS: '0', EDEN_OVERPASS_URL: `http://127.0.0.1:${FAKE}/api/interpreter` }, stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break } catch { /* wait */ } await sleep(250) }
  const demo = await (await fetch(`${base}/api/demo`, { method: 'POST' })).json()
  const model0 = await (await fetch(`${base}/api/properties/${demo.id}`)).json()
  centre = model0.property.center
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })
  const errors = []
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  const open = async (label) => { await page.locator('.navitem', { hasText: label }).first().click(); await page.waitForSelector('.sidepanel') }

  await page.goto(`${base}/`)
  await page.waitForSelector('.sidebar')
  await open('Sun &')
  await page.waitForSelector('text=Neighbouring buildings')
  check('nothing is looked up until the button is pressed, and the card says what would be sent', queries.length === 0 && /rounded to about 100 m/.test(await page.locator('body').innerText()))

  await page.locator('button', { hasText: 'Find neighbouring buildings' }).click()
  await page.waitForSelector('text=to add')
  const t = await page.locator('.infobox', { hasText: 'to add' }).innerText()
  check('one request was made, with a radius and a rounded centre and nothing else', queries.length === 1 && /around:120,/.test(queries[0]) && !/Eden Hollow/.test(queries[0]), queries[0])
  check('the four outlines are sorted out: three are neighbours, one is on the property itself', /3 to add/.test(t) && /Found 4 building outlines/.test(t) && /1 on your own land: left out/.test(t), t.replace(/\n/g, ' | ').slice(0, 220))
  check('the height source of each is stated (data, floors, assumed)', /1 with height height given in OpenStreetMap/.test(t) && /1 with height estimated from the number of floors/.test(t) && /1 with height assumed typical height: check it/.test(t))
  check('the licence is shown', /OpenStreetMap contributors, Open Database Licence/.test(t))
  if (out) await page.screenshot({ path: `${out}/39-neighbours.png` })
  check('nothing has been added yet', (await page.evaluate(() => Object.values(window.__edenStore.getState().doc.objects).filter((o) => o.kind === 'neighbour').length)) === 0)

  await page.locator('button', { hasText: 'Add 3 to the map' }).click()
  await page.waitForSelector('text=3 neighbouring buildings added')
  const added = await page.evaluate(() => {
    const s = window.__edenStore.getState()
    const layer = s.doc.layers.find((l) => l.name.startsWith('Neighbouring buildings'))
    return { layer: layer?.name, objs: Object.values(s.doc.objects).filter((o) => o.kind === 'neighbour').map((o) => ({ name: o.name, layer: o.layerId === layer?.id, h: o.props.height, roof: o.props.roofType, src: o.props.source, basis: o.props.heightBasis, eave: o.props.eaveHeight })) }
  })
  check('they are ordinary editable objects on their own layer, labelled with the source', added.objs.length === 3 && added.objs.every((o) => o.layer && /OpenStreetMap/.test(o.src)), JSON.stringify(added.objs.map((o) => [o.name, o.h, o.roof])))
  const house = added.objs.find((o) => o.name === 'Casa vecinului')
  check('the height and roof from the data are kept (9 m, gable)', house && house.h === 9 && house.roof === 'gable')
  check('floors give 2 x 3 m + 1.5 m for a pitched roof, and an untagged garage is assumed 3 m', added.objs.some((o) => o.h === 7.5 && o.roof === 'hip') && added.objs.some((o) => o.h === 3 && o.roof === 'flat'))

  // a second search finds nothing new
  await page.locator('button', { hasText: 'Find neighbouring buildings' }).click()
  await page.waitForSelector('text=0 to add')
  check('searching again does not add the same buildings twice', /3 you already have: left out/.test(await page.locator('.infobox', { hasText: 'to add' }).innerText()))
  await page.locator('button', { hasText: 'Cancel' }).click()

  // they are saved with the property and kept out of its building statistics
  await sleep(1800)
  const saved = await (await fetch(`${base}/api/properties/${demo.id}`)).json()
  check('they are saved with the property', saved.objects.filter((o) => o.kind === 'neighbour').length === 3)
  await page.locator('.navitem', { hasText: 'Buildings' }).first().click()
  await page.waitForSelector('.page h1:has-text("Buildings")')
  check('the Buildings list is only your own buildings', !/Casa vecinului/.test(await page.locator('.page').innerText()))

  // 3D: pitched roofs (gable and hip) are real roof shapes, flat roofs stay boxes
  await page.locator('.navitem', { hasText: 'Property Editor' }).first().click()
  await page.waitForSelector('.maplibregl-canvas')
  await page.evaluate(() => window.__edenStore.setState({ view3d: true }))
  await page.waitForFunction(() => { const m = window.__edenMap; const d = m?.getSource('ext')?.serialize?.().data; return d && d.features?.length > 0 })
  const roof = await page.evaluate(() => {
    const d = window.__edenMap.getSource('ext').serialize().data
    const doc = window.__edenStore.getState().doc
    const ids = Object.values(doc.objects).reduce((m, o) => ({ ...m, [o.name + '|' + o.kind]: o.id }), {})
    const of = (id) => d.features.filter((f) => f.properties.id === id).map((f) => ({ h: f.properties.h, base: f.properties.base }))
    return { main: of(ids['Main house|building']), neighbour: of(ids['Casa vecinului|neighbour']), garage: of(ids['Garage|building'] || ids['Neighbouring building|neighbour']) }
  })
  const top = (a) => Math.max(...a.map((x) => x.h))
  check('the main house (gable) is drawn as walls plus a stack of roof pieces that peaks at its height (7.5 m)', roof.main.length > 10 && Math.abs(top(roof.main) - 7.5) < 0.01 && roof.main.some((x) => x.base > 0), `${roof.main.length} pieces`)
  check('the neighbour with a gable roof peaks at 9 m', roof.neighbour.length > 10 && Math.abs(top(roof.neighbour) - 9) < 0.01, `${roof.neighbour.length} pieces`)
  await page.evaluate(() => { const m = window.__edenMap; m.jumpTo({ pitch: 55, bearing: 35, zoom: 19 }) })
  await sleep(1500)
  if (out) await page.screenshot({ path: `${out}/40-roofs-3d.png` })

  check('no unexpected console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  console.error(e)
  failures++
} finally {
  await browser?.close()
  server.kill()
  fake.close()
}
console.log(failures ? `\n${failures} FAILED` : '\nAll neighbour e2e checks passed')
process.exit(failures ? 1 : 0)
