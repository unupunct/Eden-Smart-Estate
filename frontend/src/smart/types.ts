export interface Integration {
  id: string
  kind: 'homeassistant' | 'mqtt'
  name: string
  url: string
  options: Record<string, unknown>
  enabled: boolean
  status: 'unknown' | 'online' | 'error' | 'disabled'
  statusMsg: string
  lastSync: string | null
  hasToken: boolean
  deviceCount: number
}

export interface Device {
  id: string
  integrationId: string
  externalId: string
  name: string
  domain: string
  deviceClass: string
  unit: string
  state: string | null // null = the integration has not reported a value
  stateUpdated: string | null
  attrs: Record<string, unknown>
  objectId: string | null
  risky: boolean
  commandTopic: string
  integrationStatus: string | null
  controllable: boolean
}

export interface Camera {
  id: string
  name: string
  kind: 'snapshot' | 'mjpeg' | 'rtsp' | 'ha'
  url: string
  username: string
  hasPassword: boolean
  integrationId: string | null
  entityId: string
  objectId: string | null
}

export type Trigger = { type: 'state'; deviceId: string; to?: string; above?: string; below?: string } | { type: 'time'; at: string; days?: number[] }
export type Condition = { type: 'state'; deviceId: string; op: 'eq' | 'ne' | 'gt' | 'lt'; value: string } | { type: 'time'; after: string; before: string }
export type Action = { type: 'device'; deviceId: string; service: string } | { type: 'log'; message: string } | { type: 'notify'; message: string }

export interface Automation {
  id: string
  name: string
  enabled: boolean
  trigger: Trigger
  conditions: Condition[]
  actions: Action[]
  riskAck: boolean
  lastRun: string | null
  lastResult: string
  summary: string
  riskyDevices: string[]
}

export interface LogEntry {
  id: number
  automationId: string | null
  automation: string | null
  at: string
  level: 'info' | 'warn' | 'error'
  dryRun: boolean
  message: string
}

export interface SmartStatus {
  pollSeconds: number
  mqttAvailable: boolean
  ffmpeg: boolean
}

/** What each device type can be told to do (mirrors the server's allow-list). */
export const SERVICES: Record<string, [string, string][]> = {
  switch: [['turn_on', 'On'], ['turn_off', 'Off']], light: [['turn_on', 'On'], ['turn_off', 'Off']], fan: [['turn_on', 'On'], ['turn_off', 'Off']],
  input_boolean: [['turn_on', 'On'], ['turn_off', 'Off']], humidifier: [['turn_on', 'On'], ['turn_off', 'Off']], mqtt: [['turn_on', 'On'], ['turn_off', 'Off']],
  lock: [['lock', 'Lock'], ['unlock', 'Unlock']], cover: [['open_cover', 'Open'], ['close_cover', 'Close'], ['stop_cover', 'Stop']],
  valve: [['open_valve', 'Open'], ['close_valve', 'Close']], climate: [['turn_on', 'On'], ['turn_off', 'Off']], water_heater: [['turn_on', 'On'], ['turn_off', 'Off']],
}
