import { useEffect } from 'react'
import { todayISO, urgency } from './logic'
import { useManage } from './store'
import type { Task } from './types'

const ENABLED_KEY = 'eden.notify'
const SEEN_KEY = 'eden.notified'

/** Open tasks that are overdue or due today and have not yet been announced today. */
export function dueToNotify(tasks: Task[], today: string, seen: ReadonlySet<string>): Task[] {
  return tasks.filter((t) => {
    const u = urgency(t, today)
    return (u === 'overdue' || u === 'today') && !seen.has(`${t.id}:${today}`)
  })
}

export function reminderText(due: Task[], today: string): string {
  const overdue = due.filter((t) => urgency(t, today) === 'overdue').length
  const names = due.slice(0, 3).map((t) => t.title).join(', ')
  return `${overdue ? `${overdue} overdue, ` : ''}${due.length} due: ${names}${due.length > 3 ? '…' : ''}`
}

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* private mode: not remembered */
  }
}

export const remindersSupported = () => typeof Notification !== 'undefined'
export const remindersEnabled = () => remindersSupported() && Notification.permission === 'granted' && read(ENABLED_KEY) === '1'

export async function setReminders(on: boolean): Promise<boolean> {
  if (!remindersSupported()) return false
  if (on && Notification.permission !== 'granted') {
    if ((await Notification.requestPermission()) !== 'granted') return false
  }
  write(ENABLED_KEY, on ? '1' : '0')
  window.dispatchEvent(new Event('eden-reminders')) // announce what is already due right away
  return on
}

/** While EDEN is open in a browser tab, show one notification a day for overdue and due-today tasks. No server, no push service. */
export function useReminders(): void {
  const tasks = useManage((s) => s.tasks)
  useEffect(() => {
    const check = () => {
      if (!remindersEnabled()) return
      const today = todayISO()
      let seen: string[] = []
      try {
        seen = (JSON.parse(read(SEEN_KEY) ?? '[]') as string[]).filter((k) => k.endsWith(`:${today}`))
      } catch {
        seen = []
      }
      const due = dueToNotify(tasks, today, new Set(seen))
      if (!due.length) return
      new Notification('EDEN: tasks need attention', { body: reminderText(due, today), tag: 'eden-tasks' })
      write(SEEN_KEY, JSON.stringify([...seen, ...due.map((t) => `${t.id}:${today}`)]))
    }
    check()
    const h = setInterval(check, 5 * 60 * 1000)
    window.addEventListener('eden-reminders', check)
    return () => {
      clearInterval(h)
      window.removeEventListener('eden-reminders', check)
    }
  }, [tasks])
}
