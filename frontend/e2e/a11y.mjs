// Accessibility audit with axe-core on every page of the demo estate. Fails on serious or critical violations.
// Usage: npm run build && node e2e/a11y.mjs [--verbose]
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const PORT = 8800
const base = `http://127.0.0.1:${PORT}`
const root = resolve(import.meta.dirname, '..', '..')
const verbose = process.argv.includes('--verbose')
const dataDir = mkdtempSync(join(tmpdir(), 'eden-a11y-'))
const py = process.platform === 'win32' ? join(root, 'backend', '.venv', 'Scripts', 'python.exe') : join(root, 'backend', '.venv', 'bin', 'python')
const server = spawn(py, ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT)], { cwd: join(root, 'backend'), env: { ...process.env, EDEN_DATA_DIR: dataDir, EDEN_POLL_SECONDS: '0' }, stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const axeSource = readFileSync(join(root, 'frontend', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8')
const PAGES = ['overview', 'editor', 'garden', 'orchard', 'greenhouse', 'pond', 'library', 'buildings', 'smart', 'automations', 'security', 'sun', 'sky', 'tasks', 'weather', 'notes', 'reports', 'settings']

let failures = 0
let browser
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break } catch { /* wait */ } await sleep(250) }
  await fetch(`${base}/api/demo`, { method: 'POST' })
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  await page.goto(`${base}/#overview`)
  await page.waitForSelector('text=Estate Overview')
  for (const route of PAGES) {
    await page.evaluate((r) => { location.hash = r }, route)
    await sleep(route === 'editor' || route === 'sun' ? 3500 : 1200)
    await page.addScriptTag({ content: axeSource }).catch(() => {})
    const res = await page.evaluate(async () => {
      const r = await window.axe.run(document, { resultTypes: ['violations'], rules: { 'color-contrast': { enabled: true } } })
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n').slice(1, 3).join(' ')), count: v.nodes.length }))
    })
    const bad = res.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${route}${res.length ? `  (${res.length} issue types, ${bad.length} serious/critical)` : ''}`)
    if (bad.length) failures++
    if (verbose || bad.length) for (const v of res) console.log(`      [${v.impact}] ${v.id} x${v.count}: ${v.help}\n         ${v.nodes.join('\n         ')}`)
  }
} catch (e) {
  console.error(e)
  failures++
} finally {
  await browser?.close()
  server.kill()
}
console.log(failures ? `\n${failures} page(s) with serious accessibility problems` : '\nNo serious or critical accessibility violations')
process.exit(failures ? 1 : 0)
