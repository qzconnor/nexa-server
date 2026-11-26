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

/** Why a device isn't trusted yet, from this device's side. */
export function issueText(issue: DeviceIssue): string {
  if (issue.kind === 'clock') {
    const minutes = Math.max(1, Math.round(Math.abs(issue.skew) / 60_000))
    return `Die Uhr eines der beiden Geräte geht ${minutes} Minute${minutes === 1 ? '' : 'n'} ${issue.skew > 0 ? 'vor' : 'nach'}. Stell sie richtig.`
  }
  return 'Meldet sich mit einem Schlüssel, den dieses Gerät nicht hat. Wurde es mit einem älteren Kopplungscode gekoppelt?'
}
