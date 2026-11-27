import { computed, ref } from 'vue'
import type { LinkDevice } from './client/link-service'
import { ago, issueText } from './format'
import { hosts, linkState } from './link'
import type { PageTitle } from './page-title'
import { REMOTE_LEVEL_LABELS, type RemoteLevel } from './shared/remote'

/** The computers of the namespace (devices that have chats), not this device. */
export const computers = computed(() => linkState.value.devices.filter((device) => device.role === 'host' && !device.self))

export function computerById(id: string): LinkDevice | undefined {
  return computers.value.find((device) => device.id === id)
}

const STORAGE_KEY = 'nexa.computer'
const chosen = ref<string | null>(readChosen())

function readChosen(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    // Private mode may refuse storage; the choice then lasts until the page closes.
    return null
  }
}

/** The computer whose chats the chats tab shows, from now on and next time; a choice per device. */
export function chooseComputer(id: string): void {
  chosen.value = id
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // See readChosen.
  }
}

/**
 * The computer the chats tab shows: the only one, the one chosen last, else the first that can be used.
 * None while several are there and none of them can be used yet: the tab lists them, each with why.
 */
export const shownComputer = computed(() => {
  const list = computers.value
  if (list.length === 1) return list[0]!
  return list.find((device) => device.id === chosen.value) ?? list.find((device) => computerStatus(device).level) ?? null
})

export interface ComputerStatus {
  /** One line: why it can't be used yet, or what it lets this device do. */
  text: string
  tone: 'text-muted-foreground' | 'text-warning' | 'text-destructive'
  /** What it lets this device do, once usable: online, a member, Remote Control on, at least reading. */
  level: Exclude<RemoteLevel, 'off'> | null
  /** Online and a member, its answer still to come or failed: worth a spinner, not a warning. */
  asking: boolean
}

export function computerStatus(device: LinkDevice): ComputerStatus {
  const status = (text: string, tone: ComputerStatus['tone'] = 'text-muted-foreground', asking = false): ComputerStatus => ({ text, tone, level: null, asking })
  // The last list can't say who is online now, nor when one went.
  if (linkState.value.status !== 'online') return status('Unbekannt, solange keine Verbindung zum Server besteht.')
  if (!device.trusted) {
    if (device.issue) return status(issueText(device.issue), 'text-warning')
    return status(device.online ? 'Bestätigt dieses Gerät gleich …' : 'Offline; bestätigt dieses Gerät, sobald es online ist.', 'text-muted-foreground', device.online)
  }
  if (!device.online) return status(device.lastSeen ? `Offline, zuletzt ${ago(device.lastSeen)}` : 'Offline')
  const answer = hosts.get(device.id)
  if (answer?.info) {
    if (!answer.info.enabled) return status('Fernsteuerung ist dort aus (Einstellungen › Geräte).', 'text-warning')
    if (answer.info.level === 'off') return status('Für dieses Gerät ist dort nichts freigegeben (Einstellungen › Geräte).', 'text-warning')
    return { text: `Freigabe: ${REMOTE_LEVEL_LABELS[answer.info.level]}`, tone: 'text-muted-foreground', level: answer.info.level, asking: false }
  }
  if (answer?.error) return status(answer.error, 'text-destructive')
  return status('Frage nach, was es erlaubt …', 'text-muted-foreground', true)
}

/** Online and a member green, online but not yet confirmed amber, offline grey. */
export function computerDot(device: LinkDevice): string {
  return device.online && device.trusted ? 'bg-success' : device.online ? 'bg-warning' : 'bg-muted-foreground/40'
}

/** A computer as the header shows it on the right of its pages: its name and its dot, a menu of the others if there are. */
export function computerTitle(device: LinkDevice): PageTitle {
  const status = computerStatus(device)
  return {
    computer: { name: device.name, dot: computerDot(device), busy: status.asking, hint: status.text, switchable: computers.value.length > 1 },
  }
}
