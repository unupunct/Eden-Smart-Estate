// End-to-end test of the grown plant library: more plants, what was checked against GBIF (shown per entry), and the opt-in pictures with their credit.
// Wikipedia / Wikimedia Commons are a TEST FIXTURE (a fake server with one free picture); no real data is requested.
// Usage: npm run build && node e2e/library.mjs [screenshotDir]
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const PORT = 8806
const FAKE = 8906
const base = `http://127.0.0.1:${PORT}`
const root = resolve(import.meta.dirname, '..', '..')
const out = process.argv[2]
if (out) mkdirSync(out, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'eden-library-'))
const py = process.platform === 'win32' ? join(root, 'backend', '.venv', 'Scripts', 'python.exe') : join(root, 'backend', '.venv', 'bin', 'python')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failures++ }
const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await sleep(250) } return false }

// a 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const log = []
const fake = createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  log.push(u.pathname)
  const json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)) }
  if (u.pathname.startsWith('/summary/')) {
    // only the tomato has a free picture on Commons; everything else has an article without one
    if (u.pathname.endsWith('Solanum_lycopersicum')) return json({ type: 'standard', originalimage: { source: `http://127.0.0.1:${FAKE}/wikipedia/commons/8/89/Tomato_je.jpg?utm_source=x` }, content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Tomato' } } })
    return json({ type: 'standard' })
  }
  if (u.pathname === '/commons') {
    return json({ query: { pages: [{ imageinfo: [{ thumburl: `http://127.0.0.1:${FAKE}/wikipedia/commons/thumb/8/89/Tomato_je.jpg/480px-Tomato_je.jpg`, descriptionurl: 'https://commons.wikimedia.org/wiki/File:Tomato_je.jpg',
      extmetadata: { LicenseShortName: { value: 'CC BY-SA 3.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/3.0' }, Artist: { value: '<a href="//x">Jane <b>Doe</b></a>' } } }] }] } })
  }
  if (u.pathname.startsWith('/wikipedia/commons/')) { res.setHeader('Content-Type', 'image/png'); return res.end(PNG) }
  res.statusCode = 404; res.end()
}).listen(FAKE, '127.0.0.1')

const server = spawn(py, ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT)], { cwd: join(root, 'backend'), env: { ...process.env, EDEN_DATA_DIR: dataDir, EDEN_POLL_SECONDS: '0',
  EDEN_WIKI_SUMMARY_URL: `http://127.0.0.1:${FAKE}/summary/{title}`, EDEN_COMMONS_API_URL: `http://127.0.0.1:${FAKE}/commons`, EDEN_WIKIMEDIA_HOSTS: `127.0.0.1:${FAKE}` }, stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break } catch { /* wait */ } await sleep(250) }
  await fetch(`${base}/api/demo`, { method: 'POST' })
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } })
  const errors = []
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  const search = async (q) => { await page.getByPlaceholder('Common, Latin or Romanian name').fill(q); await sleep(150) }
  const openSources = async () => { await page.locator('details.sources').first().evaluate((d) => { d.open = true }) }
  const pick = async (name) => { await page.locator('.liblist .item', { hasText: name }).first().click() }

  await page.goto(`${base}/`)
  await page.waitForSelector('.sidebar')
  await page.locator('.navitem', { hasText: 'Plants & Mushrooms' }).first().click()
  await page.waitForSelector('text=Plants & trees')
  const head = await page.locator('.pagehead').innerText()
  const n = Number(/(\d+) plants and trees/.exec(head)?.[1])
  check('the library has grown to nearly 200 plants', n >= 190, `(${n})`)
  check('the page says names are checked and growing advice is not', /names checked/i.test(head) && /Names are checked, growing advice is not/.test(await page.locator('.notice').first().innerText()))

  // ---- new plants are there, including the poisonous ones with their warning
  await search('hogweed')
  await pick('Giant hogweed')
  check('a new poisonous plant carries its warning', /burns/.test(await page.locator('.detail .dangerbox').innerText()) && (await page.locator('.liblist .pill.toxic').count()) > 0)
  await search('datura')
  await pick('Thorn apple')
  check('"all parts poisonous" plants say so in capitals', /ALL PARTS ARE DANGEROUSLY POISONOUS/.test(await page.locator('.detail .dangerbox').innerText()))
  await search('kiwiberry')
  await pick('Hardy kiwi')
  check('a new fruit plant says it needs both sexes', /male and female/.test(await page.locator('.detail').innerText()))

  // ---- what was checked
  await search('Pisum')
  await pick('Pea')
  await openSources()
  let t = await page.locator('details.sources').innerText()
  check('a synonym in GBIF is shown with the accepted name, and the library keeps the common one', /synonym/.test(t) && /Lathyrus oleraceus/.test(t) && /gardeners know/.test(t))
  check('the entry links to its GBIF record and to Wikipedia', (await page.locator('details.sources a[href^="https://www.gbif.org/species/"]').count()) === 1 && (await page.locator('details.sources a[href^="https://en.wikipedia.org/wiki/Pisum_sativum"]').count()) === 1)
  check('growing data is stated to be hand-curated, not cited', /hand-curated/.test(t) && /not cited value by value/.test(t))
  await search('tomato')
  await pick('Tomato')
  await openSources()
  t = await page.locator('details.sources').innerText()
  check('Romania: the checklists are named', /Introduced in Romania according to .*(WCVP|Checklist)/.test(t), (/In Romania:[^\n]*/.exec(t) || [])[0])
  await search('pedunculate')
  await pick('Pedunculate oak')
  await openSources()
  check('a native tree is confirmed native by the checklists', /Native in Romania according to/.test(await page.locator('details.sources').innerText()))
  await search('dandelion')
  await pick('Dandelion')
  await openSources()
  const dl = await page.locator('details.sources').innerText()
  check('a plant with no Romanian checklist record says it is unchecked rather than guessing', /no Romanian checklist record was found/.test(dl) || /Romania:/.test(dl), (/In Romania:[^\n]*/.exec(dl) || [])[0])

  // ---- pictures are off by default
  check('pictures are off: nothing was asked of Wikipedia', log.length === 0 && !(await page.getByLabel(/Show pictures of plants/).isChecked()))
  check('the switch explains what is sent and that mushrooms never get pictures', /sends its scientific name/.test(await page.locator('.infobox', { hasText: 'Show pictures' }).innerText()) && /never pictures of mushrooms/.test(await page.locator('.infobox', { hasText: 'Show pictures' }).innerText()))
  await search('tomato')
  await pick('Tomato')
  check('no picture block is shown while it is off', (await page.locator('figure.plantpic').count()) === 0)

  // ---- turn them on
  await page.getByLabel(/Show pictures of plants/).click()   // the switch changes once the server has confirmed it
  await until(async () => await page.getByLabel(/Show pictures of plants/).isChecked())
  await page.waitForSelector('figure.plantpic img')
  const cap = await page.locator('figure.plantpic figcaption').innerText()
  check('the tomato gets its picture with author, licence and source', /Photo: Jane Doe/.test(cap) && /CC BY-SA 3\.0/.test(cap) && /Wikimedia Commons/.test(cap), cap)
  check('the picture is really loaded', await until(async () => await page.locator('figure.plantpic img').evaluate((i) => i.complete && i.naturalWidth > 0)))
  check('the licence and the Commons page are links', (await page.locator('figure.plantpic a[href^="https://creativecommons.org"]').count()) === 1 && (await page.locator('figure.plantpic a[href^="https://commons.wikimedia.org"]').count()) === 1)
  check('only the scientific name was sent to the (fake) Wikipedia', log.some((p) => p.endsWith('Solanum_lycopersicum')) && log.every((p) => !/tomato$|eden|home/i.test(p) || p.startsWith('/wikipedia')))
  if (out) await page.screenshot({ path: `${out}/41-plant-picture.png` })
  await search('pedunculate')
  await pick('Pedunculate oak')
  check('a plant without a free picture says so', await until(async () => /No freely licensed picture found/.test(await page.locator('.detail').innerText())))
  const before = log.length
  await search('tomato'); await pick('Tomato')
  await sleep(600)
  check('a plant that was looked up is not asked about again', log.length === before)

  // ---- never mushrooms
  await page.getByRole('button', { name: 'Mushrooms', exact: true }).click()
  await page.waitForSelector('text=Safety first')
  await page.locator('.liblist .item').first().click()
  await sleep(500)
  check('mushrooms never get a picture and nothing is asked about them', (await page.locator('figure.plantpic').count()) === 0 && !/Looking for a picture/.test(await page.locator('.detail').innerText()) && log.length === before)
  await openSources()
  const mt = await page.locator('details.sources').innerText()
  check('the mushroom entry shows the name check but no Romanian verdict, and a warning not to rely on it', /scientific name/i.test(mt) && !/In Romania/.test(mt) && /Never rely on it to eat a mushroom/.test(mt))

  // ---- aquatic plants get pictures, pond fish do not
  await page.getByRole('button', { name: 'Aquatic plants' }).click()
  await page.waitForSelector('.liblist .item')
  await page.locator('.liblist .item').first().click()
  check('aquatic plants are looked up too', await until(async () => log.length > before))

  // ---- delete them
  await page.getByRole('button', { name: 'Plants & trees' }).click()
  await search('tomato'); await pick('Tomato')
  await page.getByRole('button', { name: 'Delete saved pictures' }).click()
  await sleep(500)
  const files = await (await fetch(`${base}/api/library/pictures/plants/tomato`)).json()
  check('deleting saved pictures forgets the answers, so the next look-up asks again', files.status === 'ok' && log.filter((p) => p.endsWith('Solanum_lycopersicum')).length >= 2)

  check('no unexpected console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  console.error(e)
  failures++
} finally {
  await browser?.close()
  server.kill()
  fake.close()
}
console.log(failures ? `\n${failures} FAILED` : '\nAll library e2e checks passed')
process.exit(failures ? 1 : 0)
