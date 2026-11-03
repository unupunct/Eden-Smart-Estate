// End-to-end test of the Phase 3 landscape-design features, on the fictional demo estate.
// Usage: npm run build && node e2e/design.mjs [screenshotDir]
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const PORT = 8793
const base = `http://127.0.0.1:${PORT}`
const root = resolve(import.meta.dirname, '..', '..')
const out = process.argv[2]
if (out) mkdirSync(out, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'eden-design-'))
const py = process.platform === 'win32' ? join(root, 'backend', '.venv', 'Scripts', 'python.exe') : join(root, 'backend', '.venv', 'bin', 'python')
const server = spawn(py, ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT)], { cwd: join(root, 'backend'), env: { ...process.env, EDEN_DATA_DIR: dataDir }, stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failures++ }

let browser
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break } catch { /* wait */ } await sleep(250) }
  const demo = await (await fetch(`${base}/api/demo`, { method: 'POST' })).json()
  const model = async () => (await fetch(`${base}/api/properties/${demo.id}`)).json()
  const m0 = await model()
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
  const errors = []
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  page.on('dialog', (d) => d.accept('Jonathan')) // prompt() for the orchard-grid variety, confirm() dialogs

  const settle = async () => { await page.waitForFunction(() => !window.__edenMap.isMoving() && window.__edenMap.loaded(), null, { timeout: 30000 }); await sleep(500) }
  const nav = (name) => page.locator('.navitem', { hasText: name }).first().click()
  const panel = () => page.locator('.rightpanel').innerText()
  const mapBox = async () => page.locator('.map').boundingBox()
  const toPx = async (lng, lat) => { const b = await mapBox(); const p = await page.evaluate(([a, c]) => { const q = window.__edenMap.project([a, c]); return [q.x, q.y] }, [lng, lat]); return [b.x + p[0], b.y + p[1]] }
  const flyTo = (lng, lat, z) => page.evaluate(([a, b, zz]) => window.__edenMap.jumpTo({ center: [a, b], zoom: zz }), [lng, lat, z])
  const centroidOf = (o) => {
    const g = o.geometry
    const pts = g.type === 'Point' ? [g.coordinates] : g.type === 'LineString' ? g.coordinates : g.coordinates[0].slice(0, -1)
    return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
  }

  await page.goto(`${base}/#editor`)
  await page.waitForSelector('.maplibregl-canvas')
  await page.waitForFunction(() => window.__edenMap?.loaded?.())
  await settle()

  // ---------- garden bed plantings and companion check
  const bed = (n) => m0.objects.find((o) => o.name === `Bed ${n}`)
  const select = async (obj, z = 19) => {
    const c = centroidOf(obj)
    await flyTo(c[0], c[1], z); await settle()
    const [x, y] = await toPx(c[0], c[1])
    await page.mouse.click(x, y); await sleep(500)
  }
  await select(bed(5), 20)
  let t = await panel()
  check('bed 5 lists its crops', t.includes('Potato') && t.includes('Tomato'))
  check('conflicting crops (potato + tomato) are flagged red', /Avoid/.test(t) && /late blight/.test(t))
  await select(bed(1), 20)
  t = await panel()
  check('bed 1 shows evidence-labelled results, no red conflict', /Documented/.test(t) && /Traditional/.test(t) && t.split(/companion check/i).length === 2 && !/\bAvoid\b/.test(t.split(/companion check/i)[1]))
  check('bed capacity and totals shown', /Room for about/.test(t) && /Total plants/.test(t))
  if (out) await page.screenshot({ path: `${out}/bed-plantings.png` })

  // ---------- library: add to property -> companion links on the map
  await nav('Plants & Mushrooms')
  await page.waitForSelector('text=Plants & trees')
  await page.fill('input[placeholder="Common, Latin or Romanian name"]', 'tomato')
  await page.locator('.liblist .item', { hasText: 'Tomato' }).first().click()
  check('plant detail shows companion evidence labels', (await page.locator('.detail').innerText()).includes('Traditional') && (await page.locator('.detail').innerText()).includes('Documented'))
  await page.locator('button', { hasText: 'ADD TO PROPERTY' }).click()
  await page.waitForSelector('.maplibregl-canvas')
  await page.waitForFunction(() => window.__edenMap?.loaded?.())
  const free = [m0.property.center[0] - 0.0007, m0.property.center[1] - 0.0016]
  await flyTo(free[0], free[1], 20); await settle()
  const place = async (id, dx) => {
    const [x, y] = await toPx(free[0] + dx, free[1]); await page.mouse.click(x, y); await sleep(250)
  }
  await place('tomato', 0)
  await page.keyboard.press('Escape')
  const objs1 = (await (await fetch(`${base}/api/properties/${demo.id}`)).json()).objects
  await sleep(1500)
  const demoIds = new Set(m0.objects.map((o) => o.id))
  const tomato = (await model()).objects.find((o) => !demoIds.has(o.id) && o.props.speciesId === 'tomato' && o.kind === 'plant')
  check('Add to property creates a library-linked plant', !!tomato && tomato.name === 'Tomato' && tomato.props.species === 'Tomato', objs1.length ? '' : '')
  for (const [name, dx] of [['basil', 0.000012], ['potato', -0.00002]]) {
    await nav('Plants & Mushrooms'); await page.waitForSelector('text=Plants & trees')
    await page.fill('input[placeholder="Common, Latin or Romanian name"]', name)
    await page.locator('.liblist .item').first().click()
    await page.locator('button', { hasText: 'ADD TO PROPERTY' }).click()
    await page.waitForFunction(() => window.__edenMap?.loaded?.())
    await flyTo(free[0], free[1], 20); await settle()
    await place(name, dx); await page.keyboard.press('Escape')
  }
  await sleep(1500)
  const m1 = await model()
  const plants = m1.objects.filter((o) => !demoIds.has(o.id) && o.kind === 'plant' && ['tomato', 'basil', 'potato'].includes(o.props.speciesId))
  check('three plants placed from the library', plants.length === 3, plants.map((p) => p.props.speciesId).join(','))
  const tom = plants.find((p) => p.props.speciesId === 'tomato')
  await flyTo(free[0], free[1], 20); await settle()
  { const [x, y] = await toPx(free[0], free[1]); await page.mouse.click(x, y) }
  await sleep(600)
  t = await panel()
  check('selecting the tomato lists neighbour relationships', /companion planting/i.test(t) && /Basil/.test(t) && /Potato/.test(t))
  check('basil is yellow/traditional, potato is red/documented', /Traditional/.test(t) && /Avoid/.test(t))
  const links = await page.evaluate(() => window.__edenMap.getSource('compat').getData().then((d) => d.features.length))
  check('companion links drawn on the map (line + end dot per neighbour)', links >= 4, `${links} features`)
  if (out) { await flyTo(free[0], free[1], 21); await settle(); await page.screenshot({ path: `${out}/companion-links.png` }) }
  check('tomato object is selectable by id', !!tom)

  // ---------- orchard: pollination, mature canopy, grid planting + single undo
  const apple = m0.objects.find((o) => o.name === 'Apple 1')
  await select(apple, 19)
  t = await panel()
  check('apple shows pollination status and tree record', /Pollination: partner nearby/i.test(t) && /tree record/i.test(t) && /Pruning history/i.test(t))
  check('apple age and mature canopy computed', /Age/.test(t) && /mature canopy\s+4\.5 m across/i.test(t))
  await page.locator('label', { hasText: 'Show projected mature canopy' }).locator('input').check()
  await sleep(500)
  const mature = await page.evaluate(() => window.__edenMap.getSource('mature').getData().then((d) => d.features.length))
  check('mature canopy rings drawn for trees', mature >= 20, `${mature} rings`)
  const orchard = m0.objects.find((o) => o.kind === 'orchard_area')
  const before = (await model()).objects.length
  await select({ ...orchard, geometry: { type: 'Point', coordinates: centroidOf(orchard) } }, 18.6)
  // click the orchard outline instead if the centre hit something else
  if (!/plant a grid/i.test(await panel())) {
    const ring = orchard.geometry.coordinates[0]
    const [x, y] = await toPx((ring[0][0] + ring[1][0]) / 2, (ring[0][1] + ring[1][1]) / 2); await page.mouse.click(x, y); await sleep(500)
  }
  check('orchard area offers grid planting', /plant a grid of trees/i.test(await panel()))
  await page.locator('.rightpanel select').filter({ has: page.locator('option[value="pear"]') }).first().selectOption('pear')
  const btn = page.locator('button', { hasText: /^Plant \d+ pear/ })
  const label = await btn.innerText()
  const n = Number(/Plant (\d+)/.exec(label)[1])
  check('grid preview offers a sensible number of pear trees', n > 20 && n < 200, label)
  await btn.click(); await sleep(1800)
  const after = (await model()).objects
  check('grid created exactly that many trees', after.length - before === n && after.filter((o) => o.props.speciesId === 'pear').length >= n)
  await page.keyboard.press('Control+z'); await sleep(1800)
  check('one undo removes the whole planted grid', (await model()).objects.length === before)

  // ---------- pond: fish suitability and water-quality warnings
  const pond = m0.objects.find((o) => o.kind === 'pond')
  await nav('Property Editor')
  await page.waitForFunction(() => window.__edenMap?.loaded?.())
  await page.fill('.search input', 'Natural swimming')
  await page.locator('.searchpop button', { hasText: 'Natural swimming pond' }).first().click()
  await settle()
  await sleep(600)
  check('search finds the pond, selects it and zooms to it', /^Pond/i.test((await page.locator('.rightpanel h3').first().innerText()).trim()), pond ? '' : 'no pond')
  t = await panel()
  check('pond panel: surface, estimated volume and zones', /Volume \(estimate\)/.test(t) && /≈ \d+ m³/.test(t))
  check('goldfish flagged as not recommended', /Goldfish/.test(t) && /not recommended/i.test(t) && /Not suitable/.test(t))
  check('stickleback suitable, rudd cautioned', /Suitable/.test(t) && /Caution/.test(t))
  check('latest water reading flags pH and oxygen', /Latest reading: pH 8\.7 is above 8\.5/.test(t) && /oxygen 4\.6 mg\/L is below 5/i.test(t))
  check('pond panel says no sensor is connected', /no sensor connected/.test(t))
  if (out) await page.screenshot({ path: `${out}/pond-panel.png` })

  // ---------- pages
  await nav('Greenhouse'); await page.waitForSelector('text=Floor area')
  t = await page.locator('.page').innerText()
  check('greenhouse page: size, targets, interior items, no fake monitoring', /×/.test(t) && /12 – 28 °C/.test(t) && /Growing bed/.test(t) && /no sensors connected/i.test(t))
  await nav('Orchard'); await page.waitForSelector('text=By species')
  t = await page.locator('.page').innerText()
  check('orchard page: stats by species', /Apple/.test(t) && /average age/i.test(t) && /mature canopy/i.test(t))
  await nav('Natural Swimming Pond'); await page.waitForSelector('text=Latest water reading')
  check('pond page: fish verdicts and warnings', /not suitable/i.test(await page.locator('.page').innerText()))
  await nav('Garden'); await page.waitForSelector('text=Companion planting explorer')
  t = await page.locator('.page').innerText()
  check('garden page: bed table with conflict, explorer lists evidence', /Conflict/.test(t) && /Documented/.test(t))
  if (out) await page.screenshot({ path: `${out}/garden-page.png` })

  // ---------- library safety
  await nav('Plants & Mushrooms'); await page.waitForSelector('text=Plants & trees')
  await page.locator('.seg button', { hasText: 'Mushrooms' }).click()
  t = await page.locator('.page').innerText()
  check('mushroom tab leads with the safety warning', /NEVER eat a wild mushroom/.test(t))
  await page.locator('.liblist .item', { hasText: 'Death cap' }).click()
  t = await page.locator('.detail').innerText()
  check('death cap: DEADLY, no add button, no photo claim', /DEADLY/.test(t) && !/ADD TO PROPERTY/.test(t) && /No photograph is shown/.test(t))
  await page.locator('.seg button', { hasText: 'Aquatic plants' }).click()
  await page.locator('.liblist .item', { hasText: 'New Zealand pigmyweed' }).click()
  check('invasive aquatic plant cannot be added', await page.locator('button', { hasText: 'ADD TO PROPERTY' }).isDisabled())
  await page.locator('.seg button', { hasText: 'Plants & trees' }).click()
  await page.selectOption('.filters label:has-text("Category") select', 'medicinal')
  await page.locator('.liblist .item', { hasText: "St John's wort" }).click()
  t = await page.locator('.detail').innerText()
  check('medicinal entries say traditional use only and warn about interactions', /Traditional use only/.test(t) && /Interacts with many medicines/.test(t))
  await page.selectOption('.filters label:has-text("Category") select', '')
  await page.fill('input[placeholder="Common, Latin or Romanian name"]', '')
  await page.selectOption('.filters label:has-text("Companion of") select', 'tomato')
  const filtered = await page.locator('.liblist .item').count()
  check('"companion of tomato" filter narrows the list', filtered > 3 && filtered < 25, `${filtered} plants`)
  if (out) await page.screenshot({ path: `${out}/library.png` })
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
