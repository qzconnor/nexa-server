import type { DeviceIssue } from './shared/server-link'

const relative = new Intl.RelativeTimeFormat('de', { numeric: 'auto' })
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.35],
  ['month', 12],
  ['year', Infinity],
]

/** „vor 5 Minuten“, „gestern“. */
export function ago(time: number, now = Date.now()): string {
  let value = (time - now) / 1000
  for (const [unit, size] of STEPS) {
    if (Math.abs(value) < size) return relative.format(Math.round(value), unit)
    value /= size
  }
  return relative.format(Math.round(value), 'year')
}

const clockFormat = new Intl.DateTimeFormat('de', { hour: '2-digit', minute: '2-digit' })
const weekdayFormat = new Intl.DateTimeFormat('de', { weekday: 'short' })
const dateFormat = new Intl.DateTimeFormat('de', { day: 'numeric', month: 'numeric', year: '2-digit' })

function startOfDay(time: number): number {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** „14:32“ today, „Gestern“, „Mo“ within the week, else „3.11.25“: when a chat was last active, in a list. */
export function shortTime(time: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(time)) / 86_400_000)
  if (days <= 0) return clockFormat.format(time)
  if (days === 1) return 'Gestern'
  if (days < 7) return weekdayFormat.format(time).replace('.', '')
  return dateFormat.format(time)
}

/** „14:32“. */
export function clock(time: number): string {
  return clockFormat.format(time)
}

/** „8 s“, „3 min 4 s“, „1 h 12 min“: how long a turn took. */
export function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return seconds % 60 ? `${minutes} min ${seconds % 60} s` : `${minutes} min`
  return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${Math.floor(minutes / 60)} h`
}

/** Why a device isn't trusted yet, from this device's side. */
export function issueText(issue: DeviceIssue): string {
  if (issue.kind === 'clock') {
    const minutes = Math.max(1, Math.round(Math.abs(issue.skew) / 60_000))
    return `Die Uhr eines der beiden Geräte geht ${minutes} Minute${minutes === 1 ? '' : 'n'} ${issue.skew > 0 ? 'vor' : 'nach'}. Stell sie richtig.`
  }
  return 'Meldet sich mit einem Schlüssel, den dieses Gerät nicht hat. Wurde es mit einem älteren Kopplungscode gekoppelt?'
}
