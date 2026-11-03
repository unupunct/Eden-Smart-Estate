// TEST FIXTURES ONLY. A stand-in for Home Assistant's REST API and for an IP camera, used by the end-to-end tests and the
// documentation screenshots. Every name says "TEST FIXTURE"; nothing here ships with the app or is shown to real users.
import { createServer } from 'node:http'
import { deflateSync } from 'node:zlib'

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/** A deliberately synthetic picture (colour bars and a diagonal), so nobody mistakes it for a real camera. */
export function testPicture(w = 320, h = 180) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3
      const bar = Math.floor((x / w) * 6)
      const cols = [[200, 60, 60], [220, 170, 40], [90, 190, 90], [60, 170, 190], [80, 90, 200], [170, 80, 190]][bar]
      const diag = Math.abs(x * (h / w) - y) < 3
      raw[o] = diag ? 255 : cols[0]; raw[o + 1] = diag ? 255 : cols[1]; raw[o + 2] = diag ? 255 : cols[2]
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

export async function startFakeHA(port, token = 'e2e-token') {
  const png = testPicture()
  const st = (id, state, attributes = {}) => ({ entity_id: id, state, attributes, last_updated: new Date().toISOString() })
  const states = {
    'switch.pump': st('switch.pump', 'off', { friendly_name: 'TEST FIXTURE Garden pump' }),
    'light.porch': st('light.porch', 'on', { friendly_name: 'TEST FIXTURE Porch light' }),
    'sensor.soil': st('sensor.soil', '31.5', { friendly_name: 'TEST FIXTURE Soil moisture', unit_of_measurement: '%', device_class: 'moisture' }),
    'sensor.shed_temp': st('sensor.shed_temp', '18.4', { friendly_name: 'TEST FIXTURE Shed temperature', unit_of_measurement: '°C', device_class: 'temperature' }),
    'lock.gate': st('lock.gate', 'locked', { friendly_name: 'TEST FIXTURE Gate lock' }),
    'camera.yard': st('camera.yard', 'idle', { friendly_name: 'TEST FIXTURE Yard camera', access_token: 'SHOULD-NEVER-BE-STORED' }),
  }
  const calls = []
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/snap.png') {
      if (req.headers.authorization !== `Basic ${Buffer.from('admin:pw123').toString('base64')}`) { res.writeHead(401); return res.end() }
      res.writeHead(200, { 'content-type': 'image/png' }); return res.end(png)
    }
    if (url.pathname.startsWith('/__')) { // test control channel
      if (url.pathname === '/__calls') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(calls)) }
      if (url.pathname === '/__set') { states[url.searchParams.get('id')].state = url.searchParams.get('state'); states[url.searchParams.get('id')].last_updated = new Date().toISOString(); res.writeHead(200); return res.end('ok') }
    }
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"message":"401: Unauthorized"}') }
    const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
    if (url.pathname === '/api/states') return json(Object.values(states))
    if (url.pathname.startsWith('/api/states/')) { const s = states[url.pathname.slice(12)]; return s ? json(s) : (res.writeHead(404), res.end()) }
    if (url.pathname.startsWith('/api/camera_proxy/')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(png) }
    if (url.pathname.startsWith('/api/services/')) {
      let body = ''
      req.on('data', (d) => (body += d))
      req.on('end', () => {
        const [, , , domain, service] = url.pathname.split('/')
        const eid = JSON.parse(body).entity_id
        calls.push(`${domain}.${service} ${eid}`)
        const next = { turn_on: 'on', turn_off: 'off', lock: 'locked', unlock: 'unlocked' }[service]
        if (next && states[eid]) { states[eid].state = next; states[eid].last_updated = new Date().toISOString() }
        json([])
      })
      return
    }
    res.writeHead(404); res.end()
  })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  return { server, calls, states, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r) }), url: `http://127.0.0.1:${port}` }
}

/** TEST FIXTURE: a stand-in for the Open-Meteo forecast API (the numbers are made up for tests, with one frost night). */
export async function startFakeWeather(port) {
  const state = { requests: 0, params: null, fail: false }
  const p2 = (n) => String(n).padStart(2, '0')
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    state.requests++
    state.params = Object.fromEntries(url.searchParams)
    if (state.fail) { res.writeHead(503); return res.end() }
    const now = new Date()
    const iso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
    const hourStr = (d) => `${iso(d)}T${p2(d.getHours())}:00`
    const days = Array.from({ length: 7 }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + i))
    const hours = Array.from({ length: 80 }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() - 3 + i))
    const mins = [3, -1.5, 2, 6, 8, 5, 4]
    const body = {
      timezone: 'Europe/Bucharest', elevation: 410,
      current_units: { temperature_2m: '°C' }, daily_units: {}, hourly_units: {},
      current: { time: `${iso(now)}T${p2(now.getHours())}:${p2(now.getMinutes())}`, temperature_2m: 17.5, relative_humidity_2m: 58, apparent_temperature: 16.9, precipitation: 0, weather_code: 2, wind_speed_10m: 9.4, wind_gusts_10m: 18.2, surface_pressure: 1013 },
      daily: {
        time: days.map(iso), weather_code: [2, 0, 3, 61, 63, 2, 1], temperature_2m_max: [19, 14, 16, 15, 13, 18, 21], temperature_2m_min: mins,
        precipitation_sum: [0, 0, 0.4, 6.2, 11.8, 0, 0], precipitation_probability_max: [5, 0, 20, 70, 90, 10, 0], wind_speed_10m_max: [14, 9, 12, 28, 33, 15, 10],
        sunrise: days.map((d) => `${iso(d)}T05:31`), sunset: days.map((d) => `${iso(d)}T21:03`), uv_index_max: [7, 7, 6, 3, 2, 6, 7],
      },
      hourly: {
        time: hours.map(hourStr), temperature_2m: hours.map((_, i) => 10 + 6 * Math.sin((i / 24) * 2 * Math.PI)), precipitation: hours.map((_, i) => (i > 40 && i < 46 ? 0.8 : 0)),
        soil_temperature_0cm: hours.map((_, i) => 12 + 3 * Math.sin((i / 24) * 2 * Math.PI)), precipitation_probability: hours.map(() => 10), wind_speed_10m: hours.map(() => 9), weather_code: hours.map(() => 2),
      },
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  return { state, url: `http://127.0.0.1:${port}/v1/forecast`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r) }) }
}
