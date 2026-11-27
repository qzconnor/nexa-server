import type { Member } from '@shared/nexa-server/members'
import type { InstanceInfo, Role } from '@shared/nexa-server/protocol'
import { pushNotice, PUSH_KIND } from '@shared/push'
import { describe, expect, it } from 'vitest'
import { DeviceChannel } from '../client/server-link/device-channel'
import { generateIdentity, type Identity } from '../client/server-link/link-store'
import { notificationPath, openPush, pushNotification, type PushLink } from './open'

const NOW = Date.UTC(2026, 10, 27, 12)
const HOUR = 3_600_000

function member(id: string, identity: Identity): Member {
  return { id, signKey: identity.signKey, dhKey: identity.dhKey, since: 0 }
}

function device(id: string, name: string, role: Role, identity: Identity): InstanceInfo {
  return { id, name, role, signKey: identity.signKey, dhKey: identity.dhKey, createdAt: 0, lastSeen: null, online: false }
}

/** A computer and the phone it pushes to, each a member for the other, as after pairing. */
async function setup() {
  const computer = await generateIdentity()
  const phone = await generateIdentity()
  const link: PushLink = {
    instance: 'phone',
    identity: phone,
    members: [member('computer', computer)],
    devices: [
      device('phone', 'iPhone', 'controller', phone),
      device('computer', 'Werkstatt', 'host', computer),
    ],
  }
  /** Sealed as the desktop app seals a push (`DeviceChannel.sealed`), and as the server wraps it. */
  async function push(data: unknown, options: { from?: Identity; at?: number; to?: string; kind?: string } = {}) {
    const channel = new DeviceChannel({
      instance: 'computer',
      identity: options.from ?? computer,
      member: (id) => (id === 'phone' ? member('phone', phone) : undefined),
      send: () => true,
      now: () => options.at ?? NOW,
    })
    const sealed = await channel.sealed('phone', options.kind ?? PUSH_KIND, data)
    if (!sealed) throw new Error('not sealed')
    return { t: 'msg', id: sealed.id, from: 'computer', to: options.to ?? 'phone', kind: options.kind ?? PUSH_KIND, body: sealed.body }
  }
  return { computer, phone, link, push }
}

const NOTICE = pushNotice('input', 'chat_1', 'Claude hat eine Frage', 'Mein Chat\nDarf ich die Datei löschen?')

describe('openPush', () => {
  it('opens what a computer sealed for this phone', async () => {
    const { link, push } = await setup()
    expect(await openPush(await push(NOTICE), link, NOW)).toEqual({ from: 'computer', notice: NOTICE })
  })

  it('takes a push that waited at the push service for up to a day, and no older', async () => {
    const { link, push } = await setup()
    const payload = await push(NOTICE)
    expect(await openPush(payload, link, NOW + 24 * HOUR)).not.toBeNull()
    expect(await openPush(payload, link, NOW + 25 * HOUR)).toBeNull()
    // Sealed ahead of this clock: a few minutes are the clocks, more is something else.
    expect(await openPush(payload, link, NOW - 4 * 60_000)).not.toBeNull()
    expect(await openPush(payload, link, NOW - HOUR)).toBeNull()
  })

  it('refuses what is not sealed by a member for this phone, or was changed on the way', async () => {
    const { link, push } = await setup()
    const payload = await push(NOTICE)
    expect(await openPush({ ...payload, id: 'AAAAAAAAAAAAAAAA' }, link, NOW)).toBeNull()
    expect(await openPush({ ...payload, from: 'other' }, link, NOW)).toBeNull()
    expect(await openPush({ ...payload, t: 'error' }, link, NOW)).toBeNull()
    expect(await openPush(await push(NOTICE, { to: 'tablet' }), link, NOW)).toBeNull()
    expect(await openPush(await push(NOTICE, { kind: 'rc.events' }), link, NOW)).toBeNull()
    // Sealed with the pairwise key but signed by someone who isn't the computer.
    expect(await openPush(await push(NOTICE, { from: await generateIdentity() }), link, NOW)).toBeNull()
    expect(await openPush(payload, { ...link, members: [] }, NOW)).toBeNull()
    expect(await openPush(null, link, NOW)).toBeNull()
    expect(await openPush('{"t":"msg"}', link, NOW)).toBeNull()
  })

  it('refuses data that is no notice of this version', async () => {
    const { link, push } = await setup()
    expect(await openPush(await push({ ...NOTICE, v: 2 }), link, NOW)).toBeNull()
    expect(await openPush(await push({ ...NOTICE, chat: '../settings' }), link, NOW)).toBeNull()
    expect(await openPush(await push('Claude ist fertig'), link, NOW)).toBeNull()
  })
})

describe('pushNotification', () => {
  it('replaces the notification of the same chat and leads to it', async () => {
    const { link } = await setup()
    expect(pushNotification({ from: 'computer', notice: NOTICE }, link)).toEqual({
      title: 'Claude hat eine Frage',
      body: 'Mein Chat\nDarf ich die Datei löschen?',
      tag: 'computer:chat_1',
      path: 'chats/computer/chat_1',
    })
  })

  it('names the computer when there is more than one', async () => {
    const { link } = await setup()
    const devices = [...link.devices, device('laptop', 'Laptop', 'host', await generateIdentity())]
    expect(pushNotification({ from: 'computer', notice: NOTICE }, { devices }).body).toBe('Werkstatt · Mein Chat\nDarf ich die Datei löschen?')
  })
})

describe('notificationPath', () => {
  it('leads only to a chat or the inbox', () => {
    expect(notificationPath({ path: 'chats/computer/chat_1' })).toBe('chats/computer/chat_1')
    expect(notificationPath({ path: '' })).toBe('')
    expect(notificationPath({ path: 'https://example.com/' })).toBe('')
    expect(notificationPath({ path: '//example.com/chats/a/b' })).toBe('')
    expect(notificationPath({ path: 'chats/a/../../x' })).toBe('')
    expect(notificationPath(null)).toBe('')
    expect(notificationPath('chats/a/b')).toBe('')
  })
})
