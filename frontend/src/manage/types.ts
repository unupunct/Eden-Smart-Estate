export type Priority = 'low' | 'normal' | 'high'
export type RepeatUnit = 'day' | 'week' | 'month' | 'year'

export interface Task {
  id: string
  propertyId: string | null
  title: string
  notes: string
  category: string
  priority: Priority
  due: string | null // YYYY-MM-DD
  status: 'open' | 'done'
  repeatEvery: number | null
  repeatUnit: RepeatUnit | null
  repeatFrom: 'due' | 'completion'
  objectId: string | null
  createdAt: string
  completedAt: string | null
}

export interface TaskInput {
  propertyId: string
  title: string
  notes?: string
  category?: string
  priority?: Priority
  due?: string | null
  repeatEvery?: number | null
  repeatUnit?: RepeatUnit | null
  repeatFrom?: 'due' | 'completion'
  objectId?: string | null
}

export interface HistoryEntry {
  id: number
  taskId: string | null
  title: string
  objectId: string | null
  due: string | null
  completedOn: string
  note: string
}

export interface DocumentInfo {
  id: string
  propertyId: string
  objectId: string | null
  title: string
  originalName: string
  mime: string
  size: number
  tags: string[]
  note: string
  takenAt: string | null
  createdAt: string
  isImage: boolean
  url: string
}

export interface WeatherData {
  timezone: string
  elevation?: number
  current: { time: string; temperature_2m: number; relative_humidity_2m?: number; apparent_temperature?: number; precipitation?: number; weather_code: number; wind_speed_10m?: number; wind_gusts_10m?: number; surface_pressure?: number }
  daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_sum: number[]; precipitation_probability_max?: number[]; wind_speed_10m_max?: number[]; sunrise?: string[]; sunset?: string[]; uv_index_max?: number[] }
  hourly: { time: string[]; temperature_2m: number[]; precipitation?: number[]; precipitation_probability?: number[]; soil_temperature_0cm?: number[]; wind_speed_10m?: number[] }
}

export interface WeatherReply {
  source: string
  fetchedAt: string
  stale: boolean
  error?: string
  data: WeatherData
}
