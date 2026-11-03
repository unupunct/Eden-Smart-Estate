import { describe, expect, it } from 'vitest'
import { addDaysISO, daysFrom, dueLabel, gardenNotes, lastDone, repeatLabel, soilNow, summariseTasks, todayISO, urgency, weatherText } from './logic'
import type { Task, WeatherData } from './types'

const task = (o: Partial<Task>): Task => ({ id: 'a', propertyId: 'p', title: 't', notes: '', category: '', priority: 'normal', due: null, status: 'open', repeatEvery: null, repeatUnit: null, repeatFrom: 'due', objectId: null, createdAt: '', completedAt: null, ...o })
const TODAY = '2025-06-10'

describe('dates', () => {
  it('uses the local calendar day and does arithmetic across month ends', () => {
    expect(todayISO(new Date(2025, 0, 31, 23, 59))).toBe('2025-01-31')
    expect(addDaysISO('2025-01-31', 1)).toBe('2025-02-01')
    expect(addDaysISO('2024-02-28', 2)).toBe('2024-03-01')
    expect(daysFrom('2025-06-12', TODAY)).toBe(2)
    expect(daysFrom('2025-06-08', TODAY)).toBe(-2)
  })
})

describe('task urgency', () => {
  it('classifies overdue, today, this week, later, undated and done', () => {
    expect(urgency(task({ due: '2025-06-09' }), TODAY)).toBe('overdue')
    expect(urgency(task({ due: TODAY }), TODAY)).toBe('today')
    expect(urgency(task({ due: '2025-06-17' }), TODAY)).toBe('soon')
    expect(urgency(task({ due: '2025-06-18' }), TODAY)).toBe('later')
    expect(urgency(task({}), TODAY)).toBe('undated')
    expect(urgency(task({ due: '2020-01-01', status: 'done' }), TODAY)).toBe('done')
  })
  it('summarises and words the due date', () => {
    const s = summariseTasks([task({ due: '2025-06-01' }), task({ due: TODAY }), task({ due: TODAY }), task({})], TODAY)
    expect(s).toMatchObject({ overdue: 1, today: 2, undated: 1 })
    expect(dueLabel(task({ due: '2025-06-07' }), TODAY)).toBe('3 days overdue')
    expect(dueLabel(task({ due: '2025-06-11' }), TODAY)).toBe('tomorrow')
    expect(dueLabel(task({ due: '2025-08-01' }), TODAY)).toBe('2025-08-01')
  })
  it('describes repetition', () => {
    expect(repeatLabel(task({ repeatEvery: 1, repeatUnit: 'week' }))).toBe('every week')
    expect(repeatLabel(task({ repeatEvery: 3, repeatUnit: 'week', repeatFrom: 'completion' }))).toBe('every 3 weeks after completion')
    expect(repeatLabel(task({}))).toBe('')
  })
  it('finds when an object was last maintained', () => {
    const h = [{ id: 1, taskId: 'a', title: 'x', objectId: 'o1', due: null, completedOn: '2025-03-01', note: '' }, { id: 2, taskId: 'a', title: 'x', objectId: 'o1', due: null, completedOn: '2025-05-01', note: '' }]
    expect(lastDone(h, 'o1')).toBe('2025-05-01')
    expect(lastDone(h, 'o2')).toBeNull()
  })
})

const wx = (min: number[], rain = 0, wind = 10): WeatherData => ({
  timezone: 'x', current: { time: '2025-06-10T14:20', temperature_2m: 18, weather_code: 3 },
  daily: { time: ['2025-06-10', '2025-06-11', '2025-06-12'], weather_code: [0, 0, 0], temperature_2m_max: [20, 31, 22], temperature_2m_min: min, precipitation_sum: [rain, 0, 0], wind_speed_10m_max: [wind, 5, 5] },
  hourly: { time: ['2025-06-10T13:00', '2025-06-10T14:00', '2025-06-10T15:00'], temperature_2m: [1, 2, 3], soil_temperature_0cm: [11, 12, 13] },
})

describe('weather', () => {
  it('names weather codes and admits unknown ones', () => {
    expect(weatherText(63).text).toBe('Rain')
    expect(weatherText(95).icon).toBe('⛈️')
    expect(weatherText(1234).text).toBe('Weather code 1234')
  })
  it('derives frost, rain, wind and heat facts straight from the numbers', () => {
    const n = gardenNotes(wx([-1.5, 1, 6], 12, 55))
    expect(n.find((x) => x.frostDay === '2025-06-10')?.text).toMatch(/-1\.5 °C.*frost is likely/)
    expect(n.some((x) => /0–2 °C on 2025-06-11/.test(x.text))).toBe(true)
    expect(n.some((x) => /12\.0 mm/.test(x.text))).toBe(true)
    expect(n.some((x) => /55 km\/h/.test(x.text))).toBe(true)
    expect(n.some((x) => /30 °C or more on 2025-06-11/.test(x.text))).toBe(true)
  })
  it('says there is no rain only when the forecast says so, and no frost note without frost', () => {
    const n = gardenNotes(wx([5, 6, 7]))
    expect(n.some((x) => /No significant rain/.test(x.text))).toBe(true)
    expect(n.some((x) => /frost/i.test(x.text))).toBe(false)
  })
  it('reads the soil temperature for the current hour, or nothing', () => {
    expect(soilNow(wx([1, 1, 1]))).toBe(12)
    const d = wx([1, 1, 1])
    delete d.hourly.soil_temperature_0cm
    expect(soilNow(d)).toBeNull()
  })
})
