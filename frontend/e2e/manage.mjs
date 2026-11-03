// End-to-end test of the Phase 6 features (tasks, documents, weather, reports) on the demo estate.
// The weather service is a TEST FIXTURE (fakes.mjs); no real forecast is requested.
// Usage: npm run build && node e2e/manage.mjs [screenshotDir]
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startFakeWeather, testPicture } from './fakes.mjs'

const PORT = 8798
const base = `http://127.0.0.1:${PORT}`
const root = resolve(import.meta.dirname, '..', '..')
const out = process.argv[2]
if (out) mkdirSync(out, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'eden-manage-'))
const files = mkdtempSync(join(tmpdir(), 'eden-files-'))
const py = process.platform === 'win32' ? join(root, 'backend', '.venv', 'Scripts', 'python.exe') : join(root, 'backend', '.venv', 'bin', 'python')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failures++ }
const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await sleep(250) } return false }
const p2 = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
const dayOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d) }

let browser, wx, server
try {
  wx = await startFakeWeather(8902)
  server = spawn(py, ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT)], { cwd: join(root, 'backend'), env: { ...process.env, EDEN_DATA_DIR: dataDir, EDEN_POLL_SECONDS: '0', EDEN_WEATHER_URL: wx.url }, stdio: 'ignore' })
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break } catch { /* wait */ } await sleep(250) }
  const demo = await (await fetch(`${base}/api/demo`, { method: 'POST' })).json()
  const m0 = await (await fetch(`${base}/api/properties/${demo.id}`)).json()
  const tree = m0.objects.find((o) => o.kind === 'tree')
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errors = []
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  page.on('dialog', (d) => d.accept())
  const nav = (name) => page.locator('.navitem', { hasText: name }).first().click()
  const api = async (path) => (await fetch(`${base}${path}`)).json()
  const shot = async (name) => { if (out) await page.screenshot({ path: `${out}/${name}.png` }) }

  await page.goto(`${base}/#weather`)
  await page.waitForSelector('text=Weather is switched off')

  // ---------- weather: off by default, nothing requested
  check('weather is off by default and says what enabling sends', /coordinates/.test(await page.locator('.page').innerText()) && wx.state.requests === 0)
  await nav('Estate Overview'); await page.waitForSelector('text=Live data')
  check('overview shows the weather tile as switched off', /Switched off/.test(await page.locator('.page').innerText()) && wx.state.requests === 0)

  // ---------- enable and read the forecast
  await nav('Weather')
  await page.locator('button', { hasText: 'Enable weather' }).click()
  await page.waitForSelector('text=What the forecast says for the garden', { timeout: 20000 })
  let t = await page.locator('.page').innerText()
  check('forecast shows the values the service returned', /17\.5 °C/.test(t) && /Partly cloudy/.test(t) && /Open-Meteo/.test(t))
  check('only rounded coordinates were sent to the service', wx.state.params.latitude === String(Math.round(m0.property.center[1] * 1e4) / 1e4) && wx.state.requests === 1, JSON.stringify(wx.state.params?.latitude))
  const frostDay = dayOffset(1)
  check('a forecast minimum below zero is called out as frost for that day', new RegExp(`-1\\.5 °C on ${frostDay}: frost is likely`).test(t))
  check('the 7-day table and rain total come from the forecast numbers', /18\.4 mm of rain/.test(t) && (await page.locator('.tablewrap tbody tr').count()) === 7)
  await shot('29-weather')
  await page.locator('button', { hasText: 'Add a reminder' }).click()
  await page.waitForSelector('text=Reminder added')
  await nav('Weather'); await sleep(500)
  check('reloading the page uses the cache instead of asking the service again', wx.state.requests === 1)

  // ---------- tasks
  await nav('Tasks & Maintenance'); await page.waitForSelector('text=Maintenance history')
  const frostTask = (await api('/api/tasks')).find((x) => x.title === 'Protect tender plants from frost')
  check('the frost reminder is a task due on the frost day', frostTask?.due === frostDay, `${frostTask?.due} vs ${frostDay}`)
  const addTask = async (title, { due = '', repeat = false, about = '' } = {}) => {
    await page.locator('button', { hasText: 'New task' }).click()
    await page.getByLabel('What needs doing').fill(title)
    if (due) await page.getByLabel('Due date').fill(due)
    if (about) await page.getByLabel('About (optional)').selectOption({ label: about })
    if (repeat) { await page.getByLabel('Repeats every').check() }
    await page.locator('button', { hasText: 'Save task' }).click()
    await page.waitForSelector(`li.task:has-text("${title}")`)
  }
  await addTask('Fix the gate hinge', { due: dayOffset(-3) })
  check('a past due date lands in Overdue and is counted', /Overdue/.test(await page.locator('.page').innerText()) && /3 days overdue/.test(await page.locator('li.task', { hasText: 'Fix the gate hinge' }).innerText()))
  await addTask('Mow the orchard', { due: dayOffset(0), repeat: true })
  check('a repeating task is described', /every week/.test(await page.locator('li.task', { hasText: 'Mow the orchard' }).innerText()))
  await page.locator('li.task', { hasText: 'Mow the orchard' }).locator('button.tick').click()
  await page.waitForSelector('text=Next “Mow the orchard”')
  check('completing a repeating task moves it forward a week', (await api('/api/tasks')).find((x) => x.title === 'Mow the orchard').due === dayOffset(7))
  await page.locator('li.task', { hasText: 'Fix the gate hinge' }).locator('button.tick').click()
  await page.waitForSelector('text=Done: “Fix the gate hinge”')
  check('a one-off task disappears from the open list and enters the history', await until(async () => (await page.locator('li.task', { hasText: 'Fix the gate hinge' }).count()) === 0) &&(await api(`/api/tasks-history?propertyId=${demo.id}`)).some((h) => h.title === 'Fix the gate hinge'))
  await addTask('Winter pruning', { due: dayOffset(30), about: `${tree.name} (Tree)` })
  await shot('30-tasks')

  // ---------- tasks and documents from the object panel
  await nav('Property Editor'); await page.waitForSelector('.maplibregl-canvas')
  await page.waitForFunction(() => window.__edenMap?.loaded?.())
  await page.evaluate((id) => window.__edenStore.getState().setSelection([id]), tree.id)
  await page.waitForSelector('text=Tasks & maintenance')
  check('the tree\'s panel lists its own open task', /Winter pruning/.test(await page.locator('.rightpanel').innerText()))
  await page.locator('.rightpanel input[placeholder="Add a task…"]').fill('Check for scab')
  await page.locator('#obj-add-task').click()
  await page.waitForSelector('.rightpanel li.mini:has-text("Check for scab")')
  check('a task added from the object panel is linked to the object', (await api('/api/tasks')).some((x) => x.title === 'Check for scab' && x.objectId === tree.id))
  const png = join(files, 'apple-blossom.png'); writeFileSync(png, testPicture())
  await page.locator('.rightpanel input[type=file]').setInputFiles(png)
  await page.waitForSelector('.rightpanel .thumbs img')
  check('a photo attached from the panel shows as a thumbnail', (await api(`/api/documents?propertyId=${demo.id}&objectId=${tree.id}`)).length === 1)

  // ---------- documents page
  await nav('Notes & Documents'); await page.waitForSelector('.doccard')
  check('the document page lists the attached photo with its object', /apple-blossom/.test(await page.locator('.docgrid').innerText()))
  const bad = join(files, 'run.exe'); writeFileSync(bad, 'MZ not allowed')
  await page.locator('.filters input[type=file]').setInputFiles(bad)
  await page.waitForSelector('.notice.err')
  check('a disallowed file type is refused with the reason', /not allowed/.test(await page.locator('.notice.err').innerText()))
  const fake = join(files, 'notes.pdf'); writeFileSync(fake, 'this is not a pdf')
  await page.locator('.filters input[type=file]').setInputFiles(fake)
  await page.waitForFunction(() => /does not look like/.test(document.querySelector('.notice.err')?.textContent ?? ''))
  check('a file whose content does not match its extension is refused', true)
  const pdf = join(files, 'greenhouse-manual.pdf'); writeFileSync(pdf, '%PDF-1.4\n%fixture\n')
  await page.locator('.filters input[type=file]').setInputFiles(pdf)
  await page.waitForSelector('.doccard:has-text("greenhouse-manual")')
  await page.locator('.doccard', { hasText: 'greenhouse-manual' }).locator('button', { hasText: 'Edit' }).click()
  await page.getByLabel('Tags (comma separated)').fill('manual, greenhouse')
  await page.locator('.modal button.primary').click()
  await page.waitForSelector('.doccard .pill:has-text("manual")')
  await page.getByPlaceholder('title, tag, note, file name, object…').fill('greenhouse')
  await sleep(300)
  check('search finds a document by tag', (await page.locator('.doccard').count()) === 1)
  const served = await fetch(`${base}${(await api(`/api/documents?propertyId=${demo.id}&q=manual`))[0].url}`)
  check('stored files are served with nosniff and a sandbox policy', served.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(served.headers.get('content-security-policy') ?? ''))
  await page.getByPlaceholder('title, tag, note, file name, object…').fill('')
  await sleep(300)
  await shot('31-documents')

  // ---------- reports
  await nav('Reports'); await page.waitForSelector('article.report')
  t = await page.locator('article.report').innerText()
  check('the report contains the property, its demo flag and real findings', /DEMO DATA/.test(t) && /Garden beds and plantings/.test(t) && /CONFLICT: incompatible pair/.test(t) && /Winter pruning/.test(t))
  check('the weather section carries the fetch time of the real forecast', /Open-Meteo forecast fetched/.test(t))
  await shot('32-report')
  await page.emulateMedia({ media: 'print' })
  check('printing hides the menu and keeps the report', !(await page.locator('.sidebar').isVisible()) && (await page.locator('article.report').isVisible()))
  await page.emulateMedia({ media: 'screen' })
  await page.getByLabel('Weather snapshot').uncheck()
  await sleep(300)
  check('sections can be switched off', !/Weather snapshot/.test(await page.locator('article.report').innerText()))

  // ---------- overview
  await nav('Estate Overview'); await page.waitForSelector('text=Live data')
  t = await page.locator('.page').innerText()
  check('overview shows open tasks and the real forecast temperature', /open/.test(t) && /17\.5 °C/.test(t))

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  console.error(e)
  failures++
} finally {
  await browser?.close()
  await wx?.close().catch(() => {})
  server?.kill()
}
console.log(failures ? `\n${failures} FAILED` : '\nAll management e2e checks passed')
process.exit(failures ? 1 : 0)
