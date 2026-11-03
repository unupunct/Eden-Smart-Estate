// End-to-end test of the Phase 4 sun, shadow and night-sky features, on the fictional demo estate.
// Usage: npm run build && node e2e/sun.mjs [screenshotDir]
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const PORT = 8794
const base = `http://127.0.0.1:${PORT}`
const root = resolve(import.meta.dirname, '..', '..')
const out = process.argv[2]
if (out) mkdirSync(out, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'eden-sun-'))
const py = process.platform === 'win32' ? join(root, 'backend', '.venv', 'Scripts', 'python.exe') : join(root, 'backend', '.venv', 'bin', 'python')
const server = spawn(py, ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT)], { cwd: join(root, 'backend'), env: { ...process.env, EDEN_DATA_DIR: dataDir }, stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failures++ }

let browser
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break } catch { /* wait */ } await sleep(250) }
  const demo = await (await fetch(`${base}/api/demo`, { method: 'POST' })).json()
  const m0 = await (await fetch(`${base}/api/properties/${demo.id}`)).json()
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, timezoneId: 'Europe/Bucharest', locale: 'en-US' })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))

  const nav = (name) => page.locator('.navitem', { hasText: name }).first().click()
  const setSun = (patch) => page.evaluate((p) => window.__edenSun.getState().set(p), patch)
  const at = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 3, mi) // Bucharest summer time is UTC+3; winter dates pass h-2 via atW
  const atW = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 2, mi)
  const features = (src) => page.evaluate(async (s) => (await window.__edenMap.getSource(s).getData()).features.map((f) => ({ cls: f.properties.cls, hours: f.properties.hours, ring: f.geometry.coordinates[0] })), src)
  const lngRange = (fs) => { const xs = fs.flatMap((f) => f.ring.map((p) => p[0])); return [Math.min(...xs), Math.max(...xs)] }
  const settle = async () => { await page.waitForFunction(() => window.__edenMap?.loaded?.() && !window.__edenMap.isMoving()); await sleep(900) }

  await page.goto(`${base}/#sun`)
  await page.waitForSelector('.maplibregl-canvas')
  await page.waitForFunction(() => window.__edenMap?.loaded?.())
  await setSun({ instant: at(2025, 6, 21, 10, 0), leaf: 'auto' })
  await settle()

  // ---------- readouts and shadows
  const side = () => page.locator('.sidepanel').innerText()
  let t = await side()
  check('sun page shows azimuth/elevation and day events', /Azimuth/.test(t) && /Elevation/.test(t) && /Sunrise/.test(t) && /Sunset/.test(t) && /Day length/.test(t))
  check('midsummer day length is about 15-16 h at this latitude', /1[56] h \d\d min/.test(t))
  check('10:00 sun is in the east-south-east', /Azimuth\s*\n?\s*1[0-3]\d\.\d° (ESE|SE|E|SSE)/.test(t), (t.match(/Azimuth\s*\n?\s*[^\n]+/) || [''])[0].replace(/\s+/g, ' '))
  const house = m0.objects.find((o) => o.kind === 'building')
  const hb = (() => { const xs = house.geometry.coordinates[0].map((p) => p[0]); return [Math.min(...xs), Math.max(...xs)] })()
  let sh = await features('shadow')
  check('shadows are drawn in the morning', sh.length > 0, `${sh.length} polygons`)
  let [w0] = lngRange(sh)
  check('morning shadows reach west of the buildings', w0 < hb[0])
  await setSun({ instant: at(2025, 6, 21, 17, 0) }); await sleep(900)
  sh = await features('shadow')
  const [, e1] = lngRange(sh)
  check('afternoon shadows reach east of the buildings', e1 > hb[1])
  await setSun({ instant: at(2025, 6, 21, 2, 0) }); await sleep(700)
  check('no shadows at night', (await features('shadow')).length === 0)

  // ---------- season comparison table
  await setSun({ instant: at(2025, 6, 21, 12, 0) }); await sleep(2500)
  const rows = page.locator('.suntable tbody tr.clickrow')
  const nRows = await rows.count()
  const wantRows = m0.objects.filter((o) => ['garden_bed', 'greenhouse', 'gh_bed', 'orchard_area', 'pond'].includes(o.kind)).length
  check('table lists every bed, greenhouse bed, orchard area and pond', nRows === wantRows && nRows >= 5, `${nRows}/${wantRows}`)
  const nums = async (r) => (await rows.nth(r).locator('.hrs b').allInnerTexts()).map((x) => parseFloat(x))
  let allOk = true
  let anyShaded = false
  for (let r = 0; r < nRows; r++) {
    const [sel, mar, jun, sep, dec, grow] = await nums(r)
    if (!(jun >= dec - 0.01 && jun >= mar - 0.01 && jun <= 17 && dec >= 0 && grow >= 0)) allOk = false
    if (jun < 12) anyShaded = true
    void sel; void sep
  }
  check('June gives at least as much sun as March and December in every row, within physical limits', allOk)
  check('the demo estate has at least one shaded area (house, trees or hedge)', anyShaded)
  const dayHours = await (async () => { const v = await nums(0); return v[0] })()
  await setSun({ instant: atW(2025, 12, 21, 12, 0) }); await sleep(2500)
  const decSel = (await nums(0))[0]
  check('selected-date column follows the date (winter < summer)', decSel < dayHours - 2, `${decSel} vs ${dayHours}`)
  await rows.first().click(); await sleep(400)
  const sel = await page.evaluate(() => window.__edenStore?.getState?.().selection ?? null)
  check('clicking a row selects the object on the map', Array.isArray(sel) && sel.length === 1)

  // ---------- foliage season
  await setSun({ instant: at(2025, 6, 21, 15, 0), leaf: 'on' }); await sleep(800)
  const on = await features('shadow')
  await setSun({ leaf: 'off' }); await sleep(800)
  const off = await features('shadow')
  const light = (fs) => fs.filter((f) => f.cls === 'light').length
  const dense = (fs) => fs.filter((f) => f.cls === 'dense').length
  check('tree shadows are dense with leaves on and light when bare', dense(on) >= dense(off) && light(off) >= light(on) && (dense(on) !== dense(off) || light(on) !== light(off)), `on d${dense(on)}/l${light(on)}, off d${dense(off)}/l${light(off)}`)
  await setSun({ leaf: 'auto' })

  // ---------- sun-hours map
  await setSun({ instant: at(2025, 6, 21, 12, 0), heatOn: true }); await sleep(3500)
  const heat = await features('sunheat')
  const hv = heat.map((f) => f.hours)
  check('sun-hours map covers the property with plausible values', heat.length > 200 && Math.max(...hv) > 12 && Math.min(...hv) < Math.max(...hv) - 2, `${heat.length} cells, ${Math.min(...hv).toFixed(1)}-${Math.max(...hv).toFixed(1)} h`)
  if (out) {
    await page.evaluate(() => { const m = window.__edenMap; m.jumpTo({ zoom: 18.4 }) })
    await setSun({ instant: at(2025, 6, 21, 16, 30) }); await settle(); await sleep(1500)
    await page.screenshot({ path: `${out}/sun-shadows.png` })
  }
  await setSun({ heatOn: false })

  // ---------- editor chip
  await nav('Property Editor'); await page.waitForSelector('.tooloptions')
  await page.waitForFunction(() => window.__edenMap?.loaded?.()); await sleep(800)
  const chip = page.locator('.tooloptions button', { hasText: 'Shadows' })
  check('shadows are off in the editor until switched on', (await features('shadow')).length === 0)
  await setSun({ instant: at(2025, 6, 21, 16, 0) })
  await chip.click(); await sleep(1500)
  check('editor shadow chip draws shadows', (await features('shadow')).length > 0)
  await chip.click(); await sleep(500)

  // ---------- night sky
  await nav('Night Sky'); await page.waitForSelector('.skycanvas canvas')
  await setSun({ instant: atW(2025, 11, 3, 22, 0) }); await sleep(900)
  t = await page.locator('.skypage').innerText()
  check('night sky names the twilight state, moon and planets', /Night|twilight/i.test(t) && /Moon/.test(t) && ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'].every((p) => t.includes(p)))
  check('moon phase and next full moon (5 Nov 2025) are shown', /% lit/.test(t) && /2025-11-0[45]/.test(t), (t.match(/Next full moon[^\n]*\n?[^\n]*/) || [''])[0].replace(/\s+/g, ' '))
  check('astronomical dusk/dawn and a moon-free window are reported', /Astronomical dusk/.test(t) && /Dark window with no moon/.test(t))
  const bright = () => page.evaluate(() => { const c = document.querySelector('.skycanvas canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) n++; return n })
  const night = await bright()
  check('stars are drawn on the canvas at night', night > 150, `${night} bright px`)
  await setSun({ instant: at(2025, 6, 21, 13, 0) }); await sleep(700)
  const dayText = await page.locator('.skyhud').innerText()
  const dayBright = await bright() // includes the sun's glow, so compare with and without stars rather than with the night count
  check('in daylight the sky says so', /daylight/i.test(dayText))
  await page.locator('label.check', { hasText: 'Show stars in daylight' }).locator('input').check(); await sleep(400)
  const withStars = await bright()
  check('stars are hidden by daylight and "show stars in daylight" reveals them', withStars > dayBright + 100, `${dayBright} -> ${withStars}`)
  await page.locator('label.check', { hasText: 'Show stars in daylight' }).locator('input').uncheck()
  await setSun({ instant: atW(2025, 11, 3, 22, 0) }); await sleep(600)
  if (out) await page.screenshot({ path: `${out}/night-sky.png` })

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  console.error(e)
  failures++
} finally {
  await browser?.close()
  server.kill()
}
console.log(failures ? `\n${failures} FAILED` : '\nAll sun e2e checks passed')
process.exit(failures ? 1 : 0)
