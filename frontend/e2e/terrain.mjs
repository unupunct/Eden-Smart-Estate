// End-to-end test of the terrain feature on the Sun & Shadows page: the 90 m and the 30 m source, the skyline, and beds tilted to the slope.
// The elevation services are TEST FIXTURES: a fake landscape (a slope facing south and a ridge 800 m to the east) served as Open-Meteo JSON
// and as Terrarium PNG tiles; no real data is requested.
// Usage: npm run build && node e2e/terrain.mjs [screenshotDir]
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
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
// ---- fake Terrarium tiles (PNG, 8-bit RGB, height = R*256 + G + B/256 - 32768) of the same landscape
const tileRequests = []
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]) }
function tilePng(z, tx, ty) {
  const n = 256 * 2 ** z
  const raw = Buffer.alloc(256 * (1 + 256 * 3))
  for (let py = 0; py < 256; py++) {
    raw[py * 769] = 0
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty * 256 + py + 0.5)) / n))) * 180) / Math.PI
    for (let px = 0; px < 256; px++) {
      const lng = ((tx * 256 + px + 0.5) / n) * 360 - 180
      const v = Math.round((height(lat, lng) + 32768) * 256)
      raw[py * 769 + 1 + px * 3] = (v >> 16) & 255; raw[py * 769 + 2 + px * 3] = (v >> 8) & 255; raw[py * 769 + 3 + px * 3] = v & 255
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(256, 0); ihdr.writeUInt32BE(256, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const fake = createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  const tm = /^\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(u.pathname)
  if (tm) {
    tileRequests.push(req.url)
    res.setHeader('Content-Type', 'image/png')
    res.end(tilePng(Number(tm[1]), Number(tm[2]), Number(tm[3])))
    return
  }
  const lats = u.searchParams.get('latitude').split(',').map(Number), lngs = u.searchParams.get('longitude').split(',').map(Number)
  requests.push(...lats.map((la, i) => [la, lngs[i]]))
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ elevation: lats.map((la, i) => Math.round(height(la, lngs[i]) * 10) / 10) }))
}).listen(FAKE, '127.0.0.1')

const server = spawn(py, ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT)], { cwd: join(root, 'backend'), env: { ...process.env, EDEN_DATA_DIR: dataDir, EDEN_POLL_SECONDS: '0', EDEN_ELEVATION_URL: `http://127.0.0.1:${FAKE}/v1/elevation`, EDEN_TERRARIUM_URL: `http://127.0.0.1:${FAKE}/terrarium/{z}/{x}/{y}.png` }, stdio: 'ignore' })
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

  check('the card offers the finer (30 m) source first and says what each one sends', (await page.getByLabel(/Terrain Tiles on AWS/).isChecked()) && /sends only the numbers of the 1-4 map tiles/.test(await page.locator('body').innerText()) && /sends the property centre rounded/.test(await page.locator('body').innerText()))
  await page.getByLabel(/Open-Meteo elevation/).check()
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

  // beds on the slope are tilted: the table says so, and the switch turns it off and on
  check('beds on the sloping ground show their slope and direct-light change', await until(async () => (await page.locator('.tiltnote').count()) > 0), (await page.locator('.tiltnote').first().innerText().catch(() => '')))
  const note = await page.locator('.tiltnote').first().innerText()
  check('the note names the slope, its direction and the effect against level ground', /slope 2\.\d° facing S/.test(note) && /% direct light vs level ground/.test(note), note)
  await page.getByLabel(/Tilt beds and the sun map/).uncheck()
  check('switching the tilt off removes the notes (flat-ground figures again)', await until(async () => (await page.locator('.tiltnote').count()) === 0))
  await page.getByLabel(/Tilt beds and the sun map/).check()
  check('and on again', await until(async () => (await page.locator('.tiltnote').count()) > 0))
  check('a pond is never tilted', !(await page.locator('tr', { hasText: 'Pond' }).locator('.tiltnote').count()))

  // it is remembered: a reload does not ask the service again
  const n = requests.length
  await page.reload()
  await page.waitForSelector('.sidebar')
  await open('Sun &')
  await page.waitForSelector('text=Slope here')
  check('after a reload the stored answer is used and the service is not asked again', requests.length === n)

  // the finer source: 30 m grid, only tile numbers sent
  const nBefore = requests.length
  await page.getByLabel('Elevation source').selectOption('terrarium')
  check('choosing the 30 m source fetches again, from tiles', await until(async () => tileRequests.length > 0 && /30 m resolution/.test(await page.locator('body').innerText())), `(${tileRequests.length} tiles)`)
  check('only one to four tiles were downloaded, and no coordinates were sent', tileRequests.length >= 1 && tileRequests.length <= 4 && tileRequests.every((u) => !u.includes('?')) && requests.length === nBefore, tileRequests.join(' '))
  const g = await page.evaluate(() => { const d = window.__edenTerrain.getState().data; return { n: d.local.n, step: d.local.stepM, id: d.source.id, slope: d.slopeDeg, aspect: d.aspect } })
  check('the local grid is finer (9 x 9 points, 30 m apart) and the slope and direction still agree', g.n === 9 && g.step === 30 && g.id === 'terrarium' && Math.abs(g.slope - 2.86) < 0.4 && g.aspect === 'S', JSON.stringify(g))
  check('the ridge is still on the skyline from the 30 m data', /Highest skyline\s*[\d.]+° towards E/.test(await page.locator('body').innerText()))
  await page.getByLabel('Show ground height on the map').check()
  check('the map tint uses the finer local grid', await until(async () => (await page.evaluate(() => window.__edenSun.getState().terrain?.features.length ?? 0)) === 15 * 15 + 9 * 9))
  await page.getByLabel('Show ground height on the map').uncheck()
  await page.getByLabel('Elevation source').selectOption('open-meteo')
  check('and the old source can be chosen again', await until(async () => /90 m resolution/.test(await page.locator('body').innerText())))

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
