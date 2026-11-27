/**
 * The service worker as the browser runs it: its handlers on a fake `self`, the pairing in a fake
 * IndexedDB, and a push sealed as a computer seals one.
 */

import { pushNotice, pushResolved, PUSH_KIND } from '@shared/push'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DeviceChannel } from './client/server-link/device-channel'
import { generateIdentity, type Identity, type StoredLink } from './client/server-link/link-store'

type Listener = (event: Record<string, unknown>) => void

let listeners: Map<string, Listener>
let shown: { title: string; options: NotificationOptions }[]
/** The notifications on screen, as `getNotifications` lists them; `closed` once taken away. */
let onScreen: { tag: string; data: unknown; closed: boolean; close: () => void }[]
let opened: string[]
let windows: { url: string; postMessage: (message: unknown) => void; focus: () => Promise<void> }[]
let stored: StoredLink | null
let computer: Identity
let phone: Identity

beforeEach(async () => {
  computer = await generateIdentity()
  phone = await generateIdentity()
  stored = {
    version: 1,
    url: 'https://nexa.example.com',
    namespace: 'alpha',
    instance: 'phone',
    name: 'iPhone',
    identity: phone,
    keys: [{ gen: 1, id: 'abcdefghijklmnop', raw: 'd0NTpLORZtuSkTbcxduvXqesFq0J_14yLwXMyZUHbyE', createdAt: 0 }],
    members: [{ id: 'computer', signKey: computer.signKey, dhKey: computer.dhKey, since: 0 }],
    devices: [],
  }
  listeners = new Map()
  shown = []
  onScreen = []
  opened = []
  windows = []
  vi.stubGlobal('self', {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: async () => undefined,
    registration: {
      scope: 'https://nexa.example.com/app/',
      showNotification: async (title: string, options: NotificationOptions) => {
        shown.push({ title, options })
        onScreen = onScreen.filter((n) => n.tag !== options.tag)
        const notification = { tag: options.tag!, data: options.data, closed: false, close: () => (notification.closed = true) }
        onScreen.push(notification)
      },
      getNotifications: async ({ tag }: { tag: string }) => onScreen.filter((n) => n.tag === tag && !n.closed),
    },
    clients: { claim: async () => undefined, matchAll: async () => windows, openWindow: async (url: string) => void opened.push(url) },
  })
  vi.stubGlobal('indexedDB', fakeIndexedDB())
  vi.resetModules()
  await import('./sw')
})

afterEach(() => vi.unstubAllGlobals())

/** Just what LinkStore asks of IndexedDB to read the pairing. */
function fakeIndexedDB() {
  const db = {
    transaction() {
      const transaction: { oncomplete?: () => void; objectStore: () => unknown } = {
        objectStore: () => ({
          get: () => {
            setTimeout(() => transaction.oncomplete?.())
            return { result: stored }
          },
        }),
      }
      return transaction
    },
  }
  return {
    open() {
      const request: { result?: unknown; onsuccess?: () => void } = {}
      setTimeout(() => {
        request.result = db
        request.onsuccess?.()
      })
      return request
    },
  }
}

async function dispatch(type: string, event: Record<string, unknown>): Promise<void> {
  const waits: Promise<unknown>[] = []
  listeners.get(type)!({ ...event, waitUntil: (promise: Promise<unknown>) => waits.push(promise) })
  await Promise.all(waits)
}

/** What the server hands the push service, as the browser gives it to the service worker. */
async function push(data: unknown, patch: Record<string, unknown> = {}) {
  const channel = new DeviceChannel({
    instance: 'computer',
    identity: computer,
    member: () => ({ id: 'phone', signKey: phone.signKey, dhKey: phone.dhKey, since: 0 }),
    send: () => true,
  })
  const sealed = (await channel.sealed('phone', PUSH_KIND, data))!
  const payload = { t: 'msg', id: sealed.id, from: 'computer', to: 'phone', kind: PUSH_KIND, body: sealed.body, ...patch }
  return { data: { json: () => payload } }
}

it('handles nothing but install, activate, push and a click', () => {
  // No fetch handler: the page always comes from the server, nothing is cached here.
  expect([...listeners.keys()].sort()).toEqual(['activate', 'install', 'notificationclick', 'push'])
})

it('shows what a computer pushed, one notification per chat', async () => {
  await dispatch('push', await push(pushNotice('input', 's1', 'Claude hat eine Frage', 'Mein Chat\nDarf ich?')))
  expect(shown).toEqual([
    {
      title: 'Claude hat eine Frage',
      options: {
        body: 'Mein Chat\nDarf ich?',
        tag: 'computer:s1',
        data: { path: 'chats/computer/s1', reason: 'input' },
        icon: 'https://nexa.example.com/app/icon.png',
        lang: 'de',
      },
    },
  ])
})

it('takes a question’s notification away once it is resolved, showing nothing, and leaves what came since', async () => {
  await dispatch('push', await push(pushNotice('input', 's1', 'Claude hat eine Frage', 'Mein Chat')))
  await dispatch('push', await push(pushNotice('input', 's2', 'Claude hat eine Frage', 'Anderer Chat')))
  await dispatch('push', await push(pushResolved('s1')))
  expect(shown).toHaveLength(2)
  expect(onScreen.map((n) => [n.tag, n.closed])).toEqual([
    ['computer:s1', true],
    ['computer:s2', false],
  ])

  // The chat finished since: its notification says so now and stays.
  await dispatch('push', await push(pushNotice('done', 's2', 'Claude ist fertig', 'Anderer Chat')))
  await dispatch('push', await push(pushResolved('s2')))
  expect(onScreen.find((n) => n.tag === 'computer:s2')).toMatchObject({ closed: false, data: { reason: 'done' } })
})

it('still shows something for a push it cannot read, as browsers want', async () => {
  const notice = pushNotice('done', 's1', 'Claude ist fertig', 'Mein Chat')
  await dispatch('push', await push(notice, { id: 'AAAAAAAAAAAAAAAA' }))
  await dispatch('push', { data: { json: () => JSON.parse('kein JSON') } })
  await dispatch('push', { data: null })
  stored = null
  await dispatch('push', await push(notice))
  expect(shown).toHaveLength(4)
  for (const { title, options } of shown) expect({ title, tag: options.tag, data: options.data }).toEqual({ title: 'Nexa', tag: 'nexa', data: { path: '' } })
})

it('opens the chat on a click, in the open window if there is one', async () => {
  let closed = 0
  const notification = (path: unknown) => ({ data: { path }, close: () => closed++ })
  await dispatch('notificationclick', { notification: notification('chats/computer/s1') })
  expect(opened).toEqual(['https://nexa.example.com/app/chats/computer/s1'])

  const posted: unknown[] = []
  let focused = 0
  windows = [{ url: 'https://nexa.example.com/app/settings', postMessage: (message) => posted.push(message), focus: async () => void focused++ }]
  await dispatch('notificationclick', { notification: notification('chats/computer/s1') })
  // A path that isn't ours leads to the inbox.
  await dispatch('notificationclick', { notification: notification('https://example.com/') })
  expect(posted).toEqual([
    { type: 'nexa:open', path: 'chats/computer/s1' },
    { type: 'nexa:open', path: '' },
  ])
  expect({ closed, focused, opened: opened.length }).toEqual({ closed: 3, focused: 2, opened: 1 })
})
