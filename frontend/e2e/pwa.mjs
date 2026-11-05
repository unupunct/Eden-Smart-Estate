// End-to-end test of v1.3 install and offline use: the manifest and icons, the service worker, opening EDEN with the network switched off
// (the app and the last property data still show, with an offline notice), saving again when the network returns, and wiping the saved data.
// Usage: npm run build && node e2e/pwa.mjs [screenshotDir]
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const PORT = 8804
const base = `http://localhost:${PORT}` // localhost counts as a secure context, so the service worker is allowed
const root = resolve(import.meta.dirname, '..', '..')
const out = process.argv[2]
if (out) mkdirSync(out, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'eden-pwa-'))
const py = process.platform === 'win32' ? join(root, 'backend', '.venv', 'Scripts', 'python.exe') : join(root, 'backend', '.venv', 'bin', 'python')
const server = spawn(py, ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT)], { cwd: join(root, 'backend'), env: { ...process.env, EDEN_DATA_DIR: dataDir, EDEN_POLL_SECONDS: '0' }, stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failures++ }
const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await sleep(250) } return false }
const LAUNCH = { channel: 'msedge', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }

let browser
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break } catch { /* wait */ } await sleep(250) }
  await fetch(`${base}/api/demo`, { method: 'POST' })

  // ---------- manifest and icons
  const m = await fetch(`${base}/manifest.webmanifest`)
  const man = await m.json()
  check('the manifest is served as a web manifest and names the app', m.headers.get('content-type')?.includes('manifest+json') && man.name.includes('EDEN') && man.display === 'standalone')
  check('the manifest has 192 and 512 icons and a maskable one, and they all exist', man.icons.filter((i) => i.src.endsWith('.png')).length >= 3 && (await Promise.all(man.icons.map((i) => fetch(base + i.src).then((r) => r.ok)))).every(Boolean))
  check('the service worker file is never cached by the browser (so updates arrive)', (await fetch(`${base}/sw.js`)).headers.get('cache-control') === 'no-cache')

  browser = await chromium.launch(LAUNCH)
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (msg) => msg.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::/.test(msg.text()) && errors.push(msg.text()))
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  const shot = async (name) => { if (out) await page.screenshot({ path: `${out}/${name}.png` }) }

  await page.goto(`${base}/`)
  await page.waitForSelector('.sidebar')
  check('the page links the manifest and an iOS icon', (await page.locator('link[rel=manifest]').count()) === 1 && (await page.locator('link[rel=apple-touch-icon]').count()) === 1)
  check('a service worker takes control of the page', await until(async () => page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active && navigator.serviceWorker.controller) }), 20000) || (await page.reload(), await until(async () => page.evaluate(() => !!navigator.serviceWorker.controller), 15000)))

  // look at the data once so it is kept: the overview and the plant library
  await page.waitForSelector('.page')
  const propName = (await page.evaluate(async () => (await (await fetch('/api/properties')).json())[0].name))
  await page.locator('.navitem', { hasText: 'Plants & Mushrooms' }).first().click()
  await page.waitForSelector('.page h1')
  await page.locator('.navitem', { hasText: 'Settings' }).first().click()
  await page.waitForSelector('#install-app')
  check('Settings explains installing and offline use', /Install as an app and use offline/.test(await page.locator('#install-app').innerText()))
  check('on localhost the card does not call the connection unsafe', !/plain http/.test(await page.locator('#install-app').innerText()))
  await shot('42-install-offline')
  check('the data and map answers are kept by the worker', await until(async () => page.evaluate(async () => (await caches.keys()).some((k) => k.endsWith('-data')))))

  // ---------- offline
  await ctx.setOffline(true)
  await page.reload()
  check('offline: EDEN still opens from the saved copy', await until(async () => (await page.locator('.sidebar').count()) > 0, 20000))
  check('offline: a notice says there is no connection', await until(async () => /No connection/.test(await page.locator('.offlinebar').innerText().catch(() => ''))))
  await page.locator('.navitem', { hasText: 'Estate Overview' }).first().click()
  check('offline: the last property data is still shown', await until(async () => (await page.locator('body').innerText()).includes(propName), 20000))
  await shot('43-offline')
  await ctx.setOffline(false)
  check('back online: the notice goes away', await until(async () => (await page.locator('.offlinebar').count()) === 0))

  // ---------- wiping the saved data (what sign-out does)
  await page.evaluate(() => navigator.serviceWorker.controller.postMessage('clear-user-data'))
  check('"clear-user-data" removes the kept answers and tiles but not the app itself', await until(async () => page.evaluate(async () => { const k = await caches.keys(); return !k.some((x) => x.endsWith('-data')) && k.some((x) => x.endsWith('-shell')) }), 8000))

  check('no unexpected console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  console.log('FAIL  script error:', e.message)
  failures++
} finally {
  await browser?.close()
  server.kill()
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
