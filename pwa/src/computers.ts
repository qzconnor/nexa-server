import { computed } from 'vue'
import type { LinkDevice } from './client/link-service'
import { ago, issueText } from './format'
import { hosts, linkState } from './link'
import { REMOTE_LEVEL_LABELS, type RemoteLevel } from './shared/remote'

/** The computers of the namespace (devices that have chats), not this device. */
export const computers = computed(() => linkState.value.devices.filter((device) => device.role === 'host' && !device.self))

export function computerById(id: string): LinkDevice | undefined {
  return computers.value.find((device) => device.id === id)
}

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
