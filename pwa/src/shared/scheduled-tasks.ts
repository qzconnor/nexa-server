import { PROVIDER_IDS, type PermissionMode, type ProviderId } from './chat'
import { PROVIDERS } from './providers'
import type { ProviderUsage, UsageWindow } from './types'
import { isPlainObject } from './utils'

/**
 * Scheduled tasks („Geplant“): a prompt that Nexa sends on a schedule, each time in a chat of its own
 * (or on in the chat of the last run), with the CLI, account, model and permissions the task names.
 * They run while Nexa runs (main `scheduled/scheduled-tasks.ts`); a run missed meanwhile comes once
 * when Nexa starts, if the task says so. Times are the computer's local time.
 */

type Unsubscribe = () => void

export const MAX_TASK_NAME = 120
export const MAX_TASK_PROMPT = 20_000
/** More than anyone schedules; the page lists them all. */
export const MAX_TASKS = 200
/** Runs a task remembers, the newest first. */
export const MAX_TASK_RUNS = 20
/** Hours between runs of an hourly task. */
export const HOURLY_STEPS = [1, 2, 3, 4, 6, 8, 12] as const
/**
 * A run due longer ago than this (the computer slept, Nexa was closed) is a missed one: it runs only
 * with `catchUp`, once, however many it missed.
 */
export const MISSED_AFTER_MS = 5 * 60_000

/** When a task runs. `time` is `HH:MM`, `days` count from Sunday (0) as `Date.getDay()`. */
export type TaskSchedule =
  | { kind: 'manual' }
  | { kind: 'hourly'; every: number; minute: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekdays'; time: string }
  | { kind: 'weekly'; days: number[]; time: string }
  /** `day` past the month's end: its last day. */
  | { kind: 'monthly'; day: number; time: string }
  /** `at`: local date and time, `YYYY-MM-DDTHH:MM`. */
  | { kind: 'once'; at: string }

export type TaskScheduleKind = TaskSchedule['kind']

/** What a run did. */
export interface TaskRun {
  at: number
  /** What started it: its schedule, the user („Jetzt ausführen“), or Nexa's start after it was missed. */
  trigger: 'schedule' | 'manual' | 'catch-up'
  /**
   * `started`: the chat got the prompt. `skipped`: the chat of the last run still worked, or the
   * account's usage didn't fit the task's limits (`error` says why). `missed`: it was due while Nexa was
   * off or the computer slept, and the task doesn't catch up. `error`: it couldn't start (`error` says why).
   */
  outcome: 'started' | 'skipped' | 'missed' | 'error'
  sessionId?: string
  error?: string
  /** How long the run waited for the account's usage to fit its limits (ms). */
  waited?: number
}

/** The kinds of limit windows a task can hold to: the short one (5 hours) and the long ones (week). */
export const USAGE_WINDOW_KINDS = ['session', 'week'] as const
export type UsageWindowKind = (typeof USAGE_WINDOW_KINDS)[number]

export const USAGE_WINDOW_LABELS: Record<UsageWindowKind, string> = { session: '5 Stunden', week: 'Woche' }

/** A range of usage in percent, both ends included. */
export interface UsageRange {
  min: number
  max: number
}

/**
 * Runs only while the usage of the task's account lies in a range („Limits“): below a threshold so
 * other work keeps its share, or above a point to use up what is left before a reset.
 */
export interface TaskUsageGuard {
  /** Per kind of window, the range its usage must lie in; missing: any. The fullest window of a kind counts. */
  ranges: Partial<Record<UsageWindowKind, UsageRange>>
  /** When it doesn't fit: the run is left out, or waits until it fits (until the next run at most). */
  otherwise: 'skip' | 'wait'
  /** Nexa has no numbers for the account (none read yet, a login without them): runs anyway instead of holding back. */
  runWithoutNumbers: boolean
}

/** A run that waits for the account's usage to fit the task's limits. */
export interface TaskWait {
  /** When it was due. */
  since: number
  trigger: 'schedule' | 'catch-up'
  /** Why it waits, as the last check said. */
  reason: string
}

/** How long a run waits at most for a task without a next run (once): every window resets within a week. */
export const MAX_WAIT_MS = 7 * 24 * 60 * 60_000

/** What the user sets of a task. */
export interface ScheduledTaskInput {
  name: string
  /** The prompt each run sends („Anweisungen“). */
  prompt: string
  enabled: boolean
  schedule: TaskSchedule
  provider: ProviderId
  /** An account of the CLI; missing: its default account at the time of the run. */
  account?: string
  /** Empty: the CLI's default. */
  model: string
  effort: string
  permissionMode: PermissionMode
  /** The project the chats work in. */
  projectId: string
  /** On in the chat of the last run (with its conversation) instead of a new chat each time. */
  reuseChat: boolean
  /** A run missed while Nexa was off or the computer slept comes once when it is back. */
  catchUp: boolean
  /** Runs only while the account's usage fits; missing: whatever it is. „Jetzt ausführen“ ignores it. */
  usageGuard?: TaskUsageGuard
}

export interface ScheduledTask extends ScheduledTaskInput {
  id: string
  createdAt: number
  updatedAt: number
  /** When it runs next; null: not on its own (off, by hand, once and done). */
  nextRunAt: number | null
  /** The newest first, at most `MAX_TASK_RUNS`. */
  runs: TaskRun[]
  /** A run due that waits for the account's usage to fit (`usageGuard.otherwise` `wait`). */
  waiting?: TaskWait
}

export const ScheduledInvoke = {
  list: 'scheduled:list',
  save: 'scheduled:save',
  remove: 'scheduled:remove',
  setEnabled: 'scheduled:set-enabled',
  runNow: 'scheduled:run-now',
  stopWaiting: 'scheduled:stop-waiting',
} as const

export const ScheduledEvent = {
  /** A task came, changed, ran or went; with all of them. */
  changed: 'event:scheduled-changed',
} as const

export interface ScheduledApi {
  list(): Promise<ScheduledTask[]>
  /** A new task without `id`, else changes the one with it. */
  save(input: ScheduledTaskInput, id?: string): Promise<ScheduledTask>
  remove(id: string): Promise<void>
  setEnabled(id: string, enabled: boolean): Promise<ScheduledTask>
  /** Runs it now, whatever its schedule (also when switched off) and its limits; what came of it. */
  runNow(id: string): Promise<TaskRun>
  /** A run that waits for its limits doesn't come (it counts as skipped). */
  stopWaiting(id: string): Promise<ScheduledTask>
  onChanged(cb: (tasks: ScheduledTask[]) => void): Unsubscribe
}

// Times ---------------------------------------------------------------------------------------------

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const AT_RE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/

/** `HH:MM` as hours and minutes; null when it isn't one. */
export function parseTime(time: string): { hours: number; minutes: number } | null {
  const match = TIME_RE.exec(time)
  return match ? { hours: Number(match[1]), minutes: Number(match[2]) } : null
}

/** A local `YYYY-MM-DDTHH:MM` as a time; null when it isn't a real date. */
export function parseLocalDateTime(at: string): number | null {
  const match = AT_RE.exec(at)
  if (!match) return null
  const [year, month, day, hours, minutes] = match.slice(1).map(Number) as [number, number, number, number, number]
  const date = new Date(year, month - 1, day, hours, minutes)
  // 31.02. would become 03.03.
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date.getTime() : null
}

/** A time as local `YYYY-MM-DDTHH:MM`, for `once` and the date field. */
export function localDateTime(time: number): string {
  const d = new Date(time)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const daysIn = (year: number, month: number) => new Date(year, month + 1, 0).getDate()

/** Whether a day-based schedule runs on this day (local). */
function runsOn(schedule: Exclude<TaskSchedule, { kind: 'manual' | 'hourly' | 'once' }>, date: Date): boolean {
  const weekday = date.getDay()
  switch (schedule.kind) {
    case 'daily':
      return true
    case 'weekdays':
      return weekday >= 1 && weekday <= 5
    case 'weekly':
      return schedule.days.includes(weekday)
    case 'monthly':
      return date.getDate() === Math.min(schedule.day, daysIn(date.getFullYear(), date.getMonth()))
  }
}

/**
 * When the schedule runs next after `after` (strictly later); null when it doesn't run on its own (by
 * hand, once and past). In local time: a time the clock skips at the change to summer time runs an
 * hour later, as `Date` makes it.
 */
export function nextRunAfter(schedule: TaskSchedule, after: number): number | null {
  switch (schedule.kind) {
    case 'manual':
      return null
    case 'once': {
      const at = parseLocalDateTime(schedule.at)
      return at !== null && at > after ? at : null
    }
    case 'hourly': {
      const every = Math.max(1, Math.floor(schedule.every))
      const start = new Date(after)
      start.setMinutes(0, 0, 0)
      // Two days of hours are more than any step needs, also over a change of the clock.
      for (let i = 0; i <= 48; i++) {
        const candidate = new Date(start.getFullYear(), start.getMonth(), start.getDate(), start.getHours() + i, schedule.minute)
        if (candidate.getHours() % every === 0 && candidate.getTime() > after) return candidate.getTime()
      }
      return null
    }
    default: {
      const time = parseTime(schedule.time)
      if (!time) return null
      if (schedule.kind === 'weekly' && !schedule.days.length) return null
      const day = new Date(after)
      // A year and a day: a monthly run on the 31st finds its month, a weekly one its weekday.
      for (let i = 0; i <= 366; i++) {
        const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate() + i, time.hours, time.minutes)
        if (candidate.getTime() > after && runsOn(schedule, candidate)) return candidate.getTime()
      }
      return null
    }
  }
}

// Words ---------------------------------------------------------------------------------------------

export const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'] as const
export const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const
/** The week as people here read it: from Monday. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

/** `09:05` → `9:05`, as clocks are read out. */
function clock(time: string): string {
  return time.replace(/^0(\d)/, '$1')
}

function joinAnd(parts: string[]): string {
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} und ${parts.at(-1)}` : (parts[0] ?? '')
}

/** The schedule in words: „Wochentags um 7:18“, „Jeden Montag um 9:16“, „Nur von Hand“. */
export function describeSchedule(schedule: TaskSchedule): string {
  switch (schedule.kind) {
    case 'manual':
      return 'Nur von Hand'
    case 'hourly': {
      const at = schedule.minute === 0 ? 'zur vollen Stunde' : `zur Minute ${schedule.minute}`
      return schedule.every === 1 ? `Stündlich ${at}` : `Alle ${schedule.every} Stunden ${at}`
    }
    case 'daily':
      return `Täglich um ${clock(schedule.time)}`
    case 'weekdays':
      return `Wochentags um ${clock(schedule.time)}`
    case 'weekly': {
      const days = WEEK_ORDER.filter((d) => schedule.days.includes(d))
      if (days.length === 7) return `Täglich um ${clock(schedule.time)}`
      if (days.length === 5 && days.every((d) => d >= 1 && d <= 5)) return `Wochentags um ${clock(schedule.time)}`
      if (days.length === 1) return `Jeden ${WEEKDAYS[days[0]!]} um ${clock(schedule.time)}`
      return `${joinAnd(days.map((d) => WEEKDAYS_SHORT[d]))} um ${clock(schedule.time)}`
    }
    case 'monthly':
      return `Monatlich am ${schedule.day}. um ${clock(schedule.time)}`
    case 'once': {
      const at = parseLocalDateTime(schedule.at)
      if (at === null) return 'Einmalig'
      const d = new Date(at)
      return `Einmalig am ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()} um ${clock(localDateTime(at).slice(11))}`
    }
  }
}

// Limits --------------------------------------------------------------------------------------------

/** Which kind of limit a window is: shorter than a day the 5 hours, else the week (also a model's week). */
export function windowKind(window: Pick<UsageWindow, 'key' | 'windowMinutes'>): UsageWindowKind {
  if (window.windowMinutes) return window.windowMinutes < 1440 ? 'session' : 'week'
  return window.key === 'five_hour' ? 'session' : 'week'
}

/**
 * The fullest window of each kind in whole percent, as the title bar shows it. A window whose reset
 * passed is empty again, whatever the last reading said (as `account-choice.ts` counts it).
 */
export function usageByKind(usage: Pick<ProviderUsage, 'windows'>, now: number): Partial<Record<UsageWindowKind, number>> {
  const used: Partial<Record<UsageWindowKind, number>> = {}
  for (const window of usage.windows) {
    const percent = window.resetsAt && window.resetsAt <= now ? 0 : Math.max(0, Math.min(100, Math.round(window.usedPercent)))
    const kind = windowKind(window)
    used[kind] = Math.max(used[kind] ?? 0, percent)
  }
  return used
}

/** What the limits say of a run now; `fits` null: Nexa has no numbers for the account. */
export type UsageCheck = { fits: true } | { fits: false | null; reason: string }

/** Whether the account's usage fits the task's limits, and if not, why in words for the list of runs. */
export function checkUsage(guard: TaskUsageGuard, usage: Pick<ProviderUsage, 'windows'> | undefined, now: number): UsageCheck {
  if (!usage?.windows.length) return { fits: null, reason: 'Nexa kennt die Limits des Accounts noch nicht' }
  const used = usageByKind(usage, now)
  const reasons: string[] = []
  for (const kind of USAGE_WINDOW_KINDS) {
    const range = guard.ranges[kind]
    const percent = used[kind]
    // A limit the account doesn't have holds nothing back.
    if (!range || percent === undefined) continue
    if (percent > range.max) reasons.push(`${USAGE_WINDOW_LABELS[kind]} bei ${percent} % (läuft bis ${range.max} %)`)
    else if (percent < range.min) reasons.push(`${USAGE_WINDOW_LABELS[kind]} bei ${percent} % (läuft ab ${range.min} %)`)
  }
  return reasons.length ? { fits: false, reason: reasons.join(', ') } : { fits: true }
}

/** A range in words: „bis 80 %“, „ab 50 %“, „20–90 %“. */
export function describeRange(range: UsageRange): string {
  if (range.min === range.max) return `bei ${range.min} %`
  if (range.min === 0) return `bis ${range.max} %`
  if (range.max === 100) return `ab ${range.min} %`
  return `${range.min}–${range.max} %`
}

/** The limits in words, for the list: „5 Stunden bis 80 %, Woche ab 50 %“. */
export function describeUsageGuard(guard: TaskUsageGuard): string {
  return USAGE_WINDOW_KINDS.flatMap((kind) => {
    const range = guard.ranges[kind]
    return range ? [`${USAGE_WINDOW_LABELS[kind]} ${describeRange(range)}`] : []
  }).join(', ')
}

/** Until when a waiting run waits at most: the task's next run, else (once, switched off) a week. */
export function waitUntil(task: Pick<ScheduledTask, 'nextRunAt'>, wait: TaskWait): number {
  return task.nextRunAt ?? wait.since + MAX_WAIT_MS
}

/** The limits from the window, checked; none when no range holds anything back. Throws in words. */
export function parseUsageGuard(value: unknown): TaskUsageGuard | undefined {
  if (value === undefined || value === null) return undefined
  if (!isPlainObject(value)) throw new Error('Die Limits fehlen.')
  const raw = isPlainObject(value.ranges) ? value.ranges : {}
  const ranges: TaskUsageGuard['ranges'] = {}
  for (const kind of USAGE_WINDOW_KINDS) {
    const range = raw[kind]
    if (range === undefined || range === null) continue
    const min = isPlainObject(range) ? Number(range.min) : NaN
    const max = isPlainObject(range) ? Number(range.max) : NaN
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > 100) throw new Error('Limits liegen zwischen 0 und 100 %.')
    if (min > max) throw new Error(`${USAGE_WINDOW_LABELS[kind]}: Der untere Wert liegt über dem oberen.`)
    if (min > 0 || max < 100) ranges[kind] = { min, max }
  }
  if (!Object.keys(ranges).length) return undefined
  return { ranges, otherwise: value.otherwise === 'wait' ? 'wait' : 'skip', runWithoutNumbers: value.runWithoutNumbers === true }
}

// Checks --------------------------------------------------------------------------------------------

/** The schedule from the window, checked; throws in words for the dialog. */
export function parseSchedule(value: unknown): TaskSchedule {
  if (!isPlainObject(value)) throw new Error('Der Zeitplan fehlt.')
  const time = () => {
    if (typeof value.time !== 'string' || !parseTime(value.time)) throw new Error('Gib eine Uhrzeit an, z. B. 09:00.')
    return value.time
  }
  switch (value.kind) {
    case 'manual':
      return { kind: 'manual' }
    case 'hourly': {
      const every = Number(value.every)
      const minute = Number(value.minute)
      if (!(HOURLY_STEPS as readonly number[]).includes(every)) throw new Error('Diese Stundenzahl gibt es nicht.')
      if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error('Die Minute liegt zwischen 0 und 59.')
      return { kind: 'hourly', every, minute }
    }
    case 'daily':
    case 'weekdays':
      return { kind: value.kind, time: time() }
    case 'weekly': {
      const days = Array.isArray(value.days) ? [...new Set(value.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b) : []
      if (!days.length) throw new Error('Wähle mindestens einen Wochentag.')
      return { kind: 'weekly', days, time: time() }
    }
    case 'monthly': {
      const day = Number(value.day)
      if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('Der Tag des Monats liegt zwischen 1 und 31.')
      return { kind: 'monthly', day, time: time() }
    }
    case 'once': {
      if (typeof value.at !== 'string' || parseLocalDateTime(value.at) === null) throw new Error('Gib Datum und Uhrzeit an.')
      return { kind: 'once', at: value.at }
    }
    default:
      throw new Error('Diesen Zeitplan gibt es nicht.')
  }
}

/**
 * A task from the window, checked and trimmed; throws in words for the dialog. Whether its project and
 * account exist is the main process's to check.
 */
export function parseTaskInput(value: unknown): ScheduledTaskInput {
  if (!isPlainObject(value)) throw new Error('Die Aufgabe fehlt.')
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  if (!name) throw new Error('Gib der Aufgabe einen Namen.')
  if (name.length > MAX_TASK_NAME) throw new Error(`Der Name ist zu lang (höchstens ${MAX_TASK_NAME} Zeichen).`)
  const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : ''
  if (!prompt) throw new Error('Schreib auf, was die Aufgabe tun soll.')
  if (prompt.length > MAX_TASK_PROMPT) throw new Error(`Die Anweisungen sind zu lang (höchstens ${MAX_TASK_PROMPT} Zeichen).`)
  const provider = PROVIDER_IDS.find((id) => id === value.provider)
  if (!provider) throw new Error('Diese CLI gibt es nicht.')
  const permissionMode = PROVIDERS[provider].permissionModes.find((mode) => mode === value.permissionMode)
  if (!permissionMode) throw new Error(`${PROVIDERS[provider].name} kennt diese Freigaben nicht.`)
  if (typeof value.projectId !== 'string' || !value.projectId) throw new Error('Wähle das Projekt, in dem die Aufgabe arbeitet.')
  const text = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 200) : '')
  const account = text(value.account)
  const usageGuard = parseUsageGuard(value.usageGuard)
  return {
    name,
    prompt,
    enabled: value.enabled !== false,
    schedule: parseSchedule(value.schedule),
    provider,
    ...(account ? { account } : {}),
    model: text(value.model),
    effort: text(value.effort),
    permissionMode,
    projectId: value.projectId,
    reuseChat: value.reuseChat === true,
    catchUp: value.catchUp !== false,
    ...(usageGuard ? { usageGuard } : {}),
  }
}

/** The title of a run's chat: the task's name and when it ran, so the runs tell apart in the sidebar. */
export function runTitle(name: string, at: number): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${name} · ${d.getDate()}.${d.getMonth() + 1}. ${d.getHours()}:${pad(d.getMinutes())}`
}
