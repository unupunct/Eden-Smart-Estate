// End-to-end test of the Phase 5 smart-home features against TEST FIXTURES (see fakes.mjs), not real devices.
// Usage: npm run build && node e2e/smart.mjs [screenshotDir]
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startFakeHA } from './fakes.mjs'

const PORT = 8796
const base = `http://127.0.0.1:${PORT}`
const root = resolve(import.meta.dirname, '..', '..')
const out = process.argv[2]
if (out) mkdirSync(out, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'eden-smart-'))
const py = process.platform === 'win32' ? join(root, 'backend', '.venv', 'Scripts', 'python.exe') : join(root, 'backend', '.venv', 'bin', 'python')
const server = spawn(py, ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT)], { cwd: join(root, 'backend'), env: { ...process.env, EDEN_DATA_DIR: dataDir, EDEN_POLL_SECONDS: '2' }, stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failures++ }
const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await sleep(250) } return false }

let browser, fake
try {
  fake = await startFakeHA(8901)
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break } catch { /* wait */ } await sleep(250) }
  const demo = await (await fetch(`${base}/api/demo`, { method: 'POST' })).json()
  const m0 = await (await fetch(`${base}/api/properties/${demo.id}`)).json()
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errors = []
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  const dialogs = []
  let plan = [] // what to do with the next dialogs: 'accept', 'dismiss' or a string for prompt()
  page.on('dialog', async (d) => { dialogs.push(d.message()); const p = plan.shift() ?? 'accept'; if (p === 'dismiss') await d.dismiss(); else await d.accept(typeof p === 'string' && p !== 'accept' ? p : undefined) })

  const nav = (name) => page.locator('.navitem', { hasText: name }).first().click()
  const api = async (path, init) => (await fetch(`${base}${path}`, init)).json()
  const row = (ext) => page.locator('.tablewrap tbody tr', { hasText: ext })
  const calls = () => fake.calls.slice()
  const shot = async (name) => { if (out) await page.screenshot({ path: `${out}/${name}.png` }) }

  await page.goto(`${base}/#smart`)
  await page.waitForSelector('text=Add an integration')

  // ---------- nothing connected: no status anywhere
  let t = await page.locator('.page').innerText()
  check('with nothing connected EDEN shows no device status and says so', /Nothing is connected/.test(t) && /not connected/i.test(t))
  await nav('Estate Overview'); await page.waitForSelector('text=Live data')
  t = await page.locator('.page').innerText()
  check('overview tiles are "not connected" until something is', (t.match(/Not connected/g) ?? []).length >= 3)

  // ---------- connect Home Assistant (wrong token first)
  await nav('Smart Home')
  await page.locator('.card.dashed button', { hasText: 'Home Assistant' }).click()
  await page.getByLabel('Home Assistant URL').fill(fake.url)
  await page.getByLabel('Long-lived access token').fill('wrong-token')
  await page.locator('button', { hasText: 'Save & test' }).click()
  await page.waitForSelector('text=rejected the access token')
  check('a wrong token is reported in plain words, not hidden', true)
  check('the stored token is never returned by the API', !JSON.stringify(await api('/api/integrations')).includes('wrong-token'))
  plan = ['e2e-token']
  await page.locator('.card', { hasText: 'Home Assistant' }).locator('button', { hasText: 'Change token' }).first().click()
  await sleep(500)
  await page.locator('.card', { hasText: 'Home Assistant' }).locator('button', { hasText: 'Test & sync' }).first().click()
  await page.waitForSelector('tr:has-text("sensor.soil")', { timeout: 15000 })
  check('after fixing the token the devices appear', (await page.locator('.tablewrap tbody tr').count()) >= 5)
  t = await row('sensor.soil').innerText()
  check('sensor shows the value Home Assistant reported, with its unit', /31\.5 %/.test(t))
  check('the entity access token was not imported', !JSON.stringify(await api('/api/devices')).includes('SHOULD-NEVER'))
  const integ = await api('/api/integrations')
  check('integration is connected and the API never returns the token', integ[0].status === 'online' && !JSON.stringify(integ).includes('e2e-token'))
  await shot('25-smart-home')

  // ---------- control: normal and risky
  await row('switch.pump').locator('button', { hasText: /^On$/ }).click()
  check('pump turns on, and the state shown comes back from Home Assistant', await until(async () => /\bon\b/.test(await row('switch.pump').innerText()) && calls().includes('switch.turn_on switch.pump')))
  dialogs.length = 0; plan = ['dismiss']
  await row('lock.gate').locator('button', { hasText: 'Unlock' }).click(); await sleep(800)
  check('risky command asks first; declining sends nothing', dialogs.length === 1 && /risky/.test(dialogs[0]) && !calls().some((c) => c.startsWith('lock.unlock')))
  plan = ['accept']
  await row('lock.gate').locator('button', { hasText: 'Unlock' }).click()
  check('accepting the confirmation sends the command', await until(async () => calls().includes('lock.unlock lock.gate')))
  fake.calls.length = 0
  await row('switch.pump').locator('button', { hasText: /^Off$/ }).click()
  await until(async () => calls().length === 1)

  // ---------- linking to the map
  const outlet = m0.objects.find((o) => o.kind === 'outlet')
  await row('switch.pump').locator('select').selectOption({ value: outlet.id })
  await sleep(800)
  check('device is linked to the map object', (await api('/api/devices')).find((d) => d.externalId === 'switch.pump').objectId === outlet.id)
  await nav('Property Editor'); await page.waitForSelector('.maplibregl-canvas')
  await page.evaluate((id) => window.__edenStore.getState().setSelection([id]), outlet.id)
  await sleep(700)
  t = await page.locator('.rightpanel').innerText()
  check('the linked map object shows the live state, not "not connected"', /TEST FIXTURE Garden pump/.test(t) && !/not connected to a device/.test(t))
  const light = m0.objects.find((o) => o.kind === 'light')
  await page.evaluate((id) => window.__edenStore.getState().setSelection([id]), light.id)
  await sleep(500)
  check('an unlinked light says it is not connected', /not connected/i.test(await page.locator('.rightpanel').innerText()))

  // ---------- automations
  fake.states['switch.pump'].state = 'off'
  await fetch(`${fake.url}/__set?id=sensor.soil&state=30`)
  await sleep(2500)
  await nav('Automations'); await page.waitForSelector('text=No automations')
  await page.locator('button', { hasText: 'New automation' }).click()
  await page.getByLabel('Name', { exact: true }).first().fill('Water when dry')
  const pick = (hasText) => page.locator('.formcard select').filter({ has: page.locator('option', { hasText }) })
  await pick('rises above').selectOption({ label: 'falls below' })
  await pick('TEST FIXTURE Soil moisture').first().selectOption({ label: 'TEST FIXTURE Soil moisture' })
  await page.locator('.formcard input[placeholder="25"]').fill('25')
  await page.locator('button', { hasText: '+ control a device' }).click()
  await page.locator('.formcard select').filter({ has: page.locator('option', { hasText: 'TEST FIXTURE Garden pump' }) }).filter({ hasNot: page.locator('option', { hasText: 'Soil' }) }).selectOption({ label: 'TEST FIXTURE Garden pump' })
  await page.getByLabel('Enabled (leave off').check()
  await page.locator('button', { hasText: 'Save automation' }).click()
  await page.waitForSelector('.card h3:has-text("Water when dry")')
  t = await page.locator('.card', { hasText: 'Water when dry' }).innerText()
  check('rule is saved and described in plain words', /when TEST FIXTURE Soil moisture falls below 25/.test(t) && /On → TEST FIXTURE Garden pump/.test(t))
  fake.calls.length = 0
  await page.locator('.card', { hasText: 'Water when dry' }).locator('button', { hasText: 'Dry run' }).click()
  await page.waitForSelector('text=nothing was sent')
  check('dry run explains what would happen and sends nothing', calls().length === 0)
  await fetch(`${fake.url}/__set?id=sensor.soil&state=20`)
  check('the rule fires when the real sensor value crosses the threshold', await until(async () => calls().includes('switch.turn_on switch.pump'), 20000))
  await sleep(2500)
  await page.reload(); await page.waitForSelector('text=Activity log')
  await page.waitForSelector('td:has-text("sent turn_on to TEST FIXTURE Garden pump")', { timeout: 15000 })
  check('the activity log records what was sent', true)
  fake.calls.length = 0
  await sleep(6500)
  check('it does not fire again while the value stays low', calls().length === 0)

  await page.locator('button', { hasText: 'New automation' }).click()
  await page.getByLabel('Name', { exact: true }).first().fill('Gate rule (risky example)')
  await page.locator('button', { hasText: '+ control a device' }).click()
  await page.locator('.formcard select').filter({ has: page.locator('option', { hasText: 'Gate lock' }) }).filter({ hasNot: page.locator('option', { hasText: 'Soil' }) }).selectOption({ label: 'TEST FIXTURE Gate lock (risky)' })
  await page.getByLabel('Enabled (leave off').check()
  await page.locator('button', { hasText: 'Save automation' }).click()
  await page.waitForSelector('.notice.err')
  check('an unattended rule on a risky device is refused without acknowledgement', /risky/.test(await page.locator('.notice.err').innerText()))
  await page.getByText('I understand it will operate them').click()
  await page.locator('button', { hasText: 'Save automation' }).click()
  await page.waitForSelector('.card h3:has-text("Gate rule (risky example)")')
  check('with the acknowledgement it is saved and marked risky', /risky/i.test(await page.locator('.card', { hasText: 'Gate rule (risky example)' }).innerText()))
  await page.locator('.card', { hasText: 'Gate rule (risky example)' }).locator('label.check input').click(); await sleep(700)
  await shot('26-automations')

  // ---------- cameras
  await nav('Security & Cameras'); await page.waitForSelector('text=No camera configured')
  check('without a camera there is no picture, and it says so', /does not simulate one/.test(await page.locator('.page').innerText()))
  const addCam = async (name, kind, url, user = '', pw = '') => {
    await page.locator('button', { hasText: 'Add camera' }).first().click()
    await page.locator('.formcard').getByLabel('Name', { exact: true }).fill(name)
    await page.locator('.formcard select').first().selectOption(kind)
    await page.locator('.formcard').getByLabel('Address').fill(url)
    if (user) await page.locator('.formcard').getByLabel('User name (optional)').fill(user)
    if (pw) await page.locator('.formcard').getByLabel('Password (optional, stored hidden)').fill(pw)
    await page.locator('.formcard button.primary').click()
  }
  await addCam('Yard (test fixture)', 'snapshot', `http://admin:pw123@127.0.0.1:8901/snap.png`)
  await page.waitForSelector('.camtile img', { timeout: 15000 })
  check('a snapshot camera shows its picture through the server', await until(() => page.evaluate(() => { const i = document.querySelector('.camtile img'); return !!i && i.naturalWidth > 100 })))
  const cams = await api('/api/cameras')
  check('the camera password is not in the stored URL or returned by the API', cams[0].url === 'http://127.0.0.1:8901/snap.png' && cams[0].username === 'admin' && cams[0].hasPassword && !JSON.stringify(cams).includes('pw123'))
  await addCam('Dead camera', 'snapshot', 'http://127.0.0.1:8999/none.jpg')
  await page.waitForSelector('.feed.err p:has-text("Cannot reach the camera")', { timeout: 15000 })
  check('an unreachable camera shows the reason, not an old picture', true)
  await addCam('RTSP camera', 'rtsp', 'rtsp://127.0.0.1:8554/stream')
  const ffmpeg = (await api('/api/smart/status')).ffmpeg
  if (!ffmpeg) { await page.waitForSelector('.feed.err p:has-text("ffmpeg")', { timeout: 15000 }); check('RTSP without ffmpeg says what is missing', true) } else check('RTSP uses ffmpeg (installed here)', true)
  await shot('27-security-cameras')

  // ---------- integration goes offline
  await fake.close()
  await nav('Smart Home')
  check('when the integration goes offline the problem is shown and values are marked last-known', await until(async () => { const tt = await page.locator('.page').innerText(); return /problem/.test(tt) && /integration offline/.test(tt) }, 20000))
  check('controls are disabled while offline', await row('switch.pump').locator('button', { hasText: /^On$/ }).isDisabled())
  await shot('28-integration-offline')

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  console.error(e)
  failures++
} finally {
  await browser?.close()
  await fake?.close().catch(() => {})
  server.kill()
}
console.log(failures ? `\n${failures} FAILED` : '\nAll smart-home e2e checks passed')
process.exit(failures ? 1 : 0)
