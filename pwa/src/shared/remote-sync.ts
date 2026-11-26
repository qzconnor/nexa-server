import type { RemoteLevel } from './remote'

/*
 * What this device and another one it controls (Remote Control) share while this one shows the other's
 * chats: a setting of this device for each (Einstellungen › Geräte › Abgleich). On, both see the same:
 * a change made here goes there, and what is set there shows here. Off, each device keeps its own: a
 * change made here stays here (`stores/kept-here.ts`), the other device's own state goes on there.
 */

export type SyncKey =
  | 'foldProjects'
  | 'foldSections'
  | 'order'
  | 'pin'
  | 'archive'
  | 'rename'
  | 'defaults'
  | 'showThinking'
  | 'collapseDiffs'
  | 'enterSends'
  | 'promptSuggestions'

export interface SyncItem {
  key: SyncKey
  label: string
  /** More words the settings search finds it by. */
  keywords?: string
}

export interface SyncGroup {
  id: 'sidebar' | 'chats' | 'start' | 'display'
  label: string
  description: string
  items: readonly SyncItem[]
}

export const SYNC_GROUPS = [
  {
    id: 'sidebar',
    label: 'Seitenleiste',
    description: 'Wie die Projekte des Geräts in der Seitenleiste stehen.',
    items: [
      { key: 'foldProjects', label: 'Projekte auf- und zuklappen', keywords: 'Ordner einklappen ausklappen' },
      { key: 'foldSections', label: 'Trenner auf- und zuklappen', keywords: 'Gruppen einklappen ausklappen' },
      { key: 'order', label: 'Reihenfolge der Projekte und Trenner', keywords: 'sortieren ziehen verschieben' },
    ],
  },
  {
    id: 'chats',
    label: 'Chats',
    description: 'Was du an den Chats und Projekten des Geräts ordnest.',
    items: [
      { key: 'pin', label: 'Angeheftete Chats', keywords: 'anheften Pin' },
      { key: 'archive', label: 'Archivierte Chats', keywords: 'archivieren ausblenden' },
      { key: 'rename', label: 'Namen von Chats, Projekten und Trennern', keywords: 'umbenennen Titel' },
    ],
  },
  {
    id: 'start',
    label: 'Startseite',
    description: 'Was die Startseite des Geräts für neue Chats vorschlägt.',
    items: [{ key: 'defaults', label: 'Vorgaben für neue Chats', keywords: 'CLI Modell Denkaufwand Modus Konto Account Vorgabe' }],
  },
  {
    id: 'display',
    label: 'Anzeige im Chat',
    description: 'An: wie auf dem anderen Gerät eingestellt. Aus: wie auf diesem.',
    items: [
      { key: 'showThinking', label: 'Denkprozess anzeigen', keywords: 'Thinking Reasoning' },
      { key: 'collapseDiffs', label: 'Änderungen eingeklappt', keywords: 'Diffs einklappen' },
      { key: 'enterSends', label: 'Enter sendet', keywords: 'Tastatur Strg Senden' },
      { key: 'promptSuggestions', label: 'Vorschläge für den nächsten Prompt', keywords: 'Vorschlag Tab' },
    ],
  },
] as const satisfies readonly SyncGroup[]

export const SYNC_KEYS: readonly SyncKey[] = SYNC_GROUPS.flatMap((group) => group.items.map((item) => item.key))

export type SyncSettings = Record<SyncKey, boolean>

/** Everything shared: the device shows here as it is there. */
export function defaultSync(): SyncSettings {
  return Object.fromEntries(SYNC_KEYS.map((key) => [key, true])) as SyncSettings
}

/**
 * The level a change needs to go to the other device (`channelLevel` of its call); one it doesn't allow
 * stays here, whatever the setting. null: nothing goes there, its setting only decides what shows here.
 */
export const SYNC_LEVEL: Record<SyncKey, RemoteLevel | null> = {
  foldProjects: 'prompt',
  foldSections: 'prompt',
  order: 'prompt',
  pin: 'prompt',
  archive: 'prompt',
  rename: 'prompt',
  defaults: 'full',
  showThinking: null,
  collapseDiffs: null,
  enterSends: null,
  promptSuggestions: null,
}

/** The chat settings the group „Anzeige im Chat“ is about, by their key in `ChatSettings`. */
export const DISPLAY_KEYS = ['showThinking', 'collapseDiffs', 'enterSends', 'promptSuggestions'] as const satisfies readonly SyncKey[]
