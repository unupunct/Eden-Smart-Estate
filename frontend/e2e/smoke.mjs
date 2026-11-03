// Quick end-to-end smoke test against a running EDEN server. Usage: node e2e/smoke.mjs [baseUrl] [outDir]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const base = process.argv[2] ?? 'http://127.0.0.1:8787'
const out = process.argv[3] ?? '.'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))

await page.goto(base)
await page.waitForSelector('text=Estate Overview')
await page.screenshot({ path: `${out}/01-overview-empty.png` })
await page.click('text=Explore the demo estate')
await page.waitForSelector('.maplibregl-canvas', { timeout: 20000 })
await page.waitForTimeout(6000)
await page.screenshot({ path: `${out}/02-editor-demo.png` })
console.log('errors:', JSON.stringify(errors.slice(0, 10), null, 1))
await browser.close()
