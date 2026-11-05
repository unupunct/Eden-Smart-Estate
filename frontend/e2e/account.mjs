// End-to-end test of v1.2: the admin account (create, sign in elsewhere, change password), the notification and OCR cards in Settings,
// searching text inside a document, and the ONVIF panel (a real multicast search that finds nothing on this machine).
// Usage: npm run build && node e2e/account.mjs [screenshotDir]
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const PORT = 8802
const base = `http://127.0.0.1:${PORT}`
const root = resolve(import.meta.dirname, '..', '..')
const out = process.argv[2]
if (out) mkdirSync(out, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'eden-account-'))
const py = process.platform === 'win32' ? join(root, 'backend', '.venv', 'Scripts', 'python.exe') : join(root, 'backend', '.venv', 'bin', 'python')
const server = spawn(py, ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT)], { cwd: join(root, 'backend'), env: { ...process.env, EDEN_DATA_DIR: dataDir, EDEN_POLL_SECONDS: '0' }, stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failures++ }
const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await sleep(250) } return false }
const LAUNCH = { channel: 'msedge', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }
const GOOD = 'correct horse battery'
const NEW = 'a brand new passphrase'

let browser
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break } catch { /* wait */ } await sleep(250) }
  await fetch(`${base}/api/demo`, { method: 'POST' })
  browser = await chromium.launch(LAUNCH)
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  page.on('dialog', (d) => d.accept())
  const shot = async (name) => { if (out) await page.screenshot({ path: `${out}/${name}.png` }) }
  const open = async (label, heading) => { await page.locator('.navitem', { hasText: label }).first().click(); await page.waitForSelector(`.page h1:has-text("${heading}")`) }

  // ---------- ONVIF panel: a real multicast probe; nothing answers on this machine
  await page.goto(`${base}/`)
  await page.waitForSelector('.sidebar')
  await open('Security', 'Security')
  await page.locator('button', { hasText: 'Find ONVIF camera' }).click()
  await page.waitForSelector('text=Find an ONVIF camera')
  await page.locator('button', { hasText: 'Search the network' }).click()
  // on a network with real cameras the list shows them (their details stay out of the screenshots); with none, it says what to do
  check('the ONVIF search runs and shows only what answered: cameras found, or a note to enter the address by hand', await until(async () => /by hand|Use this camera/.test(await page.locator('.page').innerText()), 20000))
  check('the log-in button waits for an address and a user name', await page.locator('button', { hasText: 'Log in and read the camera' }).isDisabled())

  // ---------- documents: text inside a file is searchable
  await open('Notes', 'Notes & Documents')
  check('"Read text for search" is on by default', await page.getByLabel('Read text for search').isChecked())
  await page.setInputFiles('input[type=file]', { name: 'boiler.txt', mimeType: 'text/plain', buffer: Buffer.from('Boiler service manual.\nThe warranty is valid until 2031 for the heat exchanger.') })
  await page.waitForSelector('text=boiler')
  await page.getByPlaceholder('title, tag, note, file name, object…').fill('warranty is valid')
  check('a word that is only inside the file finds it, with a snippet of the text', await until(async () => /found in the text/.test(await page.locator('.docgrid').innerText())))
  await page.locator('.docgrid button', { hasText: 'Text' }).first().click()
  await page.waitForSelector('text=Text taken from the file')
  check('the text viewer shows what was read and says where it came from', /heat exchanger/.test(await page.locator('.doctext').innerText()))
  await shot('36-document-text')
  await page.keyboard.press('Escape')
  await page.locator('.modal button', { hasText: 'Close' }).click()

  // ---------- settings: notifications and OCR cards
  await open('Settings', 'Settings')
  await page.waitForSelector('text=Push notifications')
  await page.waitForSelector('text=Reading text from documents (OCR)')
  const settings = await page.locator('.page').innerText()
  check('the notification card explains how messages travel and starts with nothing subscribed', /encrypted/.test(settings) && /None yet/.test(settings))
  check('there is a test button that needs a subscription', await page.locator('button', { hasText: 'Send a test notification' }).isDisabled())
  check('the OCR card states the engine status plainly', /Tesseract is not installed|Engine:/.test(settings))
  const key = await (await fetch(`${base}/api/push/status`)).json()
  check('the server made its push key without sending anything anywhere', key.publicKey.length > 80 && key.subscriptions.length === 0)

  // ---------- admin account: create it
  check('EDEN is open and offers to create the admin account', /EDEN is open/.test(settings) && (await (await fetch(`${base}/api/auth/status`)).json()).setupAvailable === true)
  await page.getByLabel('User name').fill('owner')
  await page.getByLabel('Password (at least 10 characters)', { exact: true }).fill(GOOD)
  await page.getByLabel('Repeat the password').fill('something else')
  await page.waitForSelector('text=The two passwords differ')
  check('mismatched passwords are flagged and cannot be submitted', await page.locator('button', { hasText: 'Create admin account' }).isDisabled())
  await page.getByLabel('Repeat the password').fill(GOOD)
  await page.locator('button', { hasText: 'Create admin account' }).click()
  await page.waitForSelector('text=Admin account created')
  check('the account is created and this browser stays signed in', (await page.evaluate(async () => (await fetch('/api/properties')).status)) === 200)
  check('everyone else is now locked out', (await fetch(`${base}/api/properties`)).status === 401)
  await shot('37-admin-account')

  // ---------- a second browser has to sign in
  const other = await (await browser.newContext({ viewport: { width: 1300, height: 800 } })).newPage()
  await other.goto(`${base}/#overview`)
  await other.waitForSelector('text=This estate is password protected')
  await other.getByLabel('User name').fill('owner')
  await other.getByLabel('Password').fill('not the password')
  await other.locator('button', { hasText: 'Sign in' }).click()
  await other.waitForSelector('text=Wrong user name or password')
  await other.getByLabel('Password').fill(GOOD)
  await other.locator('button', { hasText: 'Sign in' }).click()
  await other.waitForSelector('text=Estate Overview')
  check('a second browser signs in with the user name and password', true)

  // ---------- change the password
  await page.reload()
  await page.waitForSelector('.sidebar')
  await open('Settings', 'Settings')
  await page.waitForSelector('text=Signed in as')
  await page.getByLabel('Current password').fill('wrong wrong wrong')
  await page.getByLabel('New password (at least 10 characters)', { exact: true }).fill(NEW)
  await page.getByLabel('Repeat the new password').fill(NEW)
  await page.locator('button', { hasText: 'Change password' }).click()
  await page.waitForSelector('text=current password is not correct')
  check('a wrong current password is refused with a clear message', true)
  await page.getByLabel('Current password').fill(GOOD)
  await page.getByLabel('New password (at least 10 characters)', { exact: true }).fill(NEW)
  await page.getByLabel('Repeat the new password').fill(NEW)
  await page.locator('button', { hasText: 'Change password' }).click()
  await page.waitForSelector('text=Password changed')
  check('the password is changed and this browser stays signed in', (await page.evaluate(async () => (await fetch('/api/properties')).status)) === 200)
  check('the other browser is signed out by the change', (await other.evaluate(async () => (await fetch('/api/properties')).status)) === 401)
  const login = (pw) => fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'owner', password: pw }) })
  check('the old password no longer works and the new one does', (await login(GOOD)).status === 401 && (await login(NEW)).status === 200)

  check('no unexpected console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  console.error(e)
  failures++
} finally {
  await browser?.close()
  server.kill()
}
console.log(failures ? `\n${failures} FAILED` : '\nAll account e2e checks passed')
process.exit(failures ? 1 : 0)
