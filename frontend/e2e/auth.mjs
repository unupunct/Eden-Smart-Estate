// End-to-end test of the optional password protection (EDEN_PASSWORD).
// Usage: npm run build && node e2e/auth.mjs [screenshotDir]
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const PORT = 8801
const base = `http://127.0.0.1:${PORT}`
const root = resolve(import.meta.dirname, '..', '..')
const out = process.argv[2]
if (out) mkdirSync(out, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'eden-auth-'))
const py = process.platform === 'win32' ? join(root, 'backend', '.venv', 'Scripts', 'python.exe') : join(root, 'backend', '.venv', 'bin', 'python')
const server = spawn(py, ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT)], { cwd: join(root, 'backend'), env: { ...process.env, EDEN_DATA_DIR: dataDir, EDEN_POLL_SECONDS: '0', EDEN_PASSWORD: 'correct horse' }, stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failures++ }

let browser
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break } catch { /* wait */ } await sleep(250) }
  check('the API refuses requests without a session', (await fetch(`${base}/api/properties`)).status === 401 && (await fetch(`${base}/api/devices`)).status === 401)
  check('health stays open for monitoring', (await fetch(`${base}/api/health`)).status === 200)
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1300, height: 800 } })
  const errors = []
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))

  await page.goto(`${base}/#overview`)
  await page.waitForSelector('text=This estate is password protected')
  check('the sign-in screen is shown instead of the app', !(await page.locator('.sidebar').count()))
  if (out) await page.screenshot({ path: `${out}/33-sign-in.png` })
  await page.getByLabel('User name').fill('admin')
  await page.getByLabel('Password').fill('wrong')
  await page.locator('button', { hasText: 'Sign in' }).click()
  await page.waitForSelector('text=Wrong user name or password')
  check('a wrong password is explained', true)
  await page.getByLabel('Password').fill('correct horse')
  await page.locator('button', { hasText: 'Sign in' }).click()
  await page.waitForSelector('text=Estate Overview')
  check('the right password opens the app', (await page.locator('.sidebar').count()) === 1)
  const cookies = await page.context().cookies()
  const c = cookies.find((x) => x.name === 'eden_session')
  check('the session cookie is HttpOnly and SameSite=Strict', !!c && c.httpOnly && c.sameSite === 'Strict')
  check('API calls from the signed-in page work, and the cookie is not readable by scripts', (await page.evaluate(async () => (await fetch('/api/properties')).status)) === 200 && !(await page.evaluate(() => document.cookie)).includes('eden_session'))
  await page.reload(); await page.waitForSelector('text=Estate Overview')
  check('the session survives a reload', true)
  await page.locator('button[title="Sign out"]').click()
  await page.waitForSelector('text=This estate is password protected')
  check('signing out returns to the sign-in screen and closes the API again', (await page.evaluate(async () => (await fetch('/api/properties')).status)) === 401)
  await page.getByLabel('User name').fill('admin')
  for (let i = 0; i < 5; i++) { await page.getByLabel('Password').fill(`bad${i}`); await page.locator('button', { hasText: 'Sign in' }).click(); await sleep(250) }
  await page.getByLabel('Password').fill('correct horse')
  await page.locator('button', { hasText: 'Sign in' }).click()
  await page.waitForSelector('text=Too many wrong passwords')
  check('repeated wrong passwords lock the address out, even for the right password', true)
  check('no unexpected console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  console.error(e)
  failures++
} finally {
  await browser?.close()
  server.kill()
}
console.log(failures ? `\n${failures} FAILED` : '\nAll auth e2e checks passed')
process.exit(failures ? 1 : 0)
