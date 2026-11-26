import { describe, expect, it } from 'vitest'
import { CHATS_KEPT, createHostStore, type HostRemote } from './host-store'
import type { ChatItem, SessionEvent, SessionRuntime } from './shared/chat'
import { IpcEvent, IpcInvoke } from './shared/ipc'
import { SESSIONS_OLDER } from './shared/remote'
import type { RemoteWatch } from './shared/remote-ipc'
import type { SessionDetail, SessionMeta } from './shared/types'

const PC = 'PC0000000000000000000A'

function meta(id: string, patch: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id,
    projectId: 'p1',
    title: `Chat ${id}`,
    titleSource: 'user',
    provider: 'claude',
    model: 'opus',
    effort: 'high',
    permissionMode: 'ask',
    createdAt: 1,
    updatedAt: 1,
    cli: {},
    ...patch,
  }
}

function user(id: string, text = id): ChatItem {
  return { id, kind: 'user', text, ts: 1, provider: 'claude' }
}

function answer(id: string, text = ''): ChatItem {
  return { id, kind: 'assistant', text, ts: 1, provider: 'claude' }
}

const running: SessionRuntime = { status: 'running', connected: true }

/** A computer that answers from `handlers`; each answer waits for `release` while `held`. */
class FakeRemote implements HostRemote {
  watches: RemoteWatch[][] = []
  calls: { instance: string; ch: string; args: unknown[] }[] = []
  handlers: Record<string, (args: unknown[]) => unknown> = {
    [IpcInvoke.sessionsList]: () => [meta('a'), meta('b')],
    [IpcInvoke.sessionsRuntimes]: () => ({ a: running }),
    [IpcInvoke.projectsList]: () => [{ id: 'p1', name: 'Nexa', path: '/x', createdAt: 1, updatedAt: 1 }],
    [IpcInvoke.sessionsOpen]: ([id]) => ({ meta: meta(id as string), items: [user('u1'), answer('a1', 'Hallo')], runtime: running, older: 3 }) satisfies SessionDetail,
  }
  held: (() => void)[] | null = null

  async invoke(instance: string, ch: string, args: unknown[]): Promise<unknown> {
    this.calls.push({ instance, ch, args })
    if (this.held) await new Promise<void>((resolve) => this.held!.push(resolve))
    const handler = this.handlers[ch]
    if (!handler) throw new Error(`no handler for ${ch}`)
    return handler(args)
  }

  setWatch(list: readonly RemoteWatch[]): void {
    this.watches.push(list.map((w) => ({ instance: w.instance, ids: [...w.ids] })))
  }

  get lastWatch(): RemoteWatch[] | undefined {
    return this.watches.at(-1)
  }
}

function event(e: SessionEvent) {
  return { ch: IpcEvent.sessionEvent, args: [e] }
}

describe('host store', () => {
  it('watches the computer it shows and reads its lists once', async () => {
    const remote = new FakeRemote()
    const host = createHostStore(remote)
    await host.show(PC)
    expect(remote.lastWatch).toEqual([{ instance: PC, ids: [] }])
    expect(host.sessions.value.map((m) => m.id)).toEqual(['a', 'b'])
    expect(host.projects.value[0]?.name).toBe('Nexa')
    expect(host.runtime('a').status).toBe('running')
    expect(host.runtime('b').status).toBe('idle')

    await host.show(PC)
    expect(remote.calls.filter((c) => c.ch === IpcInvoke.sessionsList)).toHaveLength(1)

    host.onEvents(PC, [{ ch: IpcEvent.sessionsChanged, args: [[meta('c'), { broken: true }]] }])
    expect(host.sessions.value.map((m) => m.id)).toEqual(['c'])
    // Another computer's events aren't this one's.
    host.onEvents('OTHER00000000000000000', [{ ch: IpcEvent.sessionsChanged, args: [[]] }])
    expect(host.sessions.value).toHaveLength(1)
  })

  it('says why the lists did not come', async () => {
    const remote = new FakeRemote()
    remote.handlers[IpcInvoke.sessionsList] = () => {
      throw new Error('Das Gerät hat nicht geantwortet.')
    }
    const host = createHostStore(remote)
    await host.show(PC)
    expect(host.list.error).toBe('Das Gerät hat nicht geantwortet.')
    expect(host.list.loaded).toBe(false)
  })

  it('opens a chat watched first, and takes its events only once its items are there', async () => {
    const remote = new FakeRemote()
    const host = createHostStore(remote)
    await host.show(PC)
    remote.held = []
    const opening = host.open('a')
    await Promise.resolve()
    // The watch names the chat before it is opened: nothing after the answer is lost.
    expect(remote.lastWatch).toEqual([{ instance: PC, ids: ['a'] }])
    expect(remote.calls.at(-1)).toMatchObject({ ch: IpcInvoke.sessionsOpen, args: ['a'] })
    // Still loading: in the answer already.
    host.onEvents(PC, [event({ type: 'item', sessionId: 'a', item: user('early') })])
    for (const release of remote.held) release()
    remote.held = null
    await opening

    const chat = host.chats.get('a')!
    expect(chat.loaded).toBe(true)
    expect(chat.items.map((i) => i.id)).toEqual(['u1', 'a1'])
    expect(chat.older).toBe(3)

    host.onEvents(PC, [
      event({ type: 'item', sessionId: 'a', item: answer('a2') }),
      event({ type: 'delta', sessionId: 'a', itemId: 'a2', field: 'text', text: 'Moin' }),
      event({ type: 'delta', sessionId: 'a', itemId: 'a2', field: 'text', text: ' du' }),
      event({ type: 'item', sessionId: 'a', item: answer('a1', 'Hallo neu') }),
      event({ type: 'runtime', sessionId: 'b', runtime: running }),
    ])
    expect(chat.items.map((i) => i.id)).toEqual(['u1', 'a1', 'a2'])
    expect((chat.items[2] as { text: string }).text).toBe('Moin du')
    expect((chat.items[1] as { text: string }).text).toBe('Hallo neu')
    expect(chat.textShown).toBe(1)
    expect(host.runtime('b').status).toBe('running')

    // `length` counts the 3 older items too: keep 3 + 2.
    host.onEvents(PC, [event({ type: 'truncated', sessionId: 'a', length: 5 })])
    expect(chat.items.map((i) => i.id)).toEqual(['u1', 'a1'])
    expect(chat.index.has('a2')).toBe(false)
  })

  it('fetches the items before the first one as the user scrolls up', async () => {
    const remote = new FakeRemote()
    remote.handlers[SESSIONS_OLDER] = ([, first]) => {
      expect(first).toBe('u1')
      return { items: [user('u0'), answer('x0', 'früher'), user('u1')], older: 0 }
    }
    const host = createHostStore(remote)
    await host.show(PC)
    await host.open('a')
    await host.loadOlder('a')
    const chat = host.chats.get('a')!
    expect(chat.items.map((i) => i.id)).toEqual(['u0', 'x0', 'u1', 'a1'])
    expect(chat.index.get('a1')).toBe(3)
    expect(chat.older).toBe(0)
    await host.loadOlder('a')
    expect(remote.calls.filter((c) => c.ch === SESSIONS_OLDER)).toHaveLength(1)
  })

  it(`keeps only the last ${CHATS_KEPT} chats loaded, the one on screen always`, async () => {
    const remote = new FakeRemote()
    const host = createHostStore(remote)
    await host.show(PC)
    await host.open('c0')
    for (let i = 1; i <= CHATS_KEPT; i++) await host.open(`c${i}`)
    expect([...host.chats.keys()]).toEqual(['c1', 'c2', 'c3', 'c4'])
    // Looked at again: the newest, so another goes first.
    await host.open('c1')
    await host.open('c5')
    expect([...host.chats.keys()]).toEqual(['c3', 'c4', 'c1', 'c5'])
    expect(remote.lastWatch?.[0]?.ids).toEqual(['c3', 'c4', 'c1', 'c5'])
  })

  it('shows why a chat did not open, watches it no more, and tries again', async () => {
    const remote = new FakeRemote()
    const open = remote.handlers[IpcInvoke.sessionsOpen]!
    remote.handlers[IpcInvoke.sessionsOpen] = () => {
      throw new Error('Das gibt es auf dem anderen Gerät nicht.')
    }
    const host = createHostStore(remote)
    await host.show(PC)
    await host.open('gone')
    expect(host.chats.get('gone')?.error).toBe('Das gibt es auf dem anderen Gerät nicht.')
    expect(remote.lastWatch).toEqual([{ instance: PC, ids: [] }])
    remote.handlers[IpcInvoke.sessionsOpen] = open
    await host.open('gone')
    expect(host.chats.get('gone')?.loaded).toBe(true)
  })

  it('reads anew what it shows when the computer lost track of it', async () => {
    const remote = new FakeRemote()
    const host = createHostStore(remote)
    await host.show(PC)
    await host.open('a')
    await host.open('b')
    host.leave('b')
    await host.open('a')
    remote.handlers[IpcInvoke.sessionsList] = () => [meta('a', { title: 'Neu' })]
    remote.handlers[IpcInvoke.sessionsOpen] = ([id]) => ({ meta: meta(id as string), items: [user('u9')], runtime: running })
    await host.resync(PC)
    expect([...host.chats.keys()]).toEqual(['a'])
    expect(host.sessions.value[0]?.title).toBe('Neu')
    expect(host.chats.get('a')?.items.map((i) => i.id)).toEqual(['u9'])
    expect(host.chats.get('a')?.older).toBe(0)
  })

  it('drops late answers of the computer shown before', async () => {
    const remote = new FakeRemote()
    const host = createHostStore(remote)
    remote.held = []
    const first = host.show(PC)
    await Promise.resolve()
    const releases = remote.held
    remote.held = null
    remote.handlers[IpcInvoke.sessionsList] = () => [meta('z')]
    await host.show('PC0000000000000000000B')
    for (const release of releases) release()
    await first
    expect(host.instance.value).toBe('PC0000000000000000000B')
    expect(host.sessions.value.map((m) => m.id)).toEqual(['z'])
    expect(remote.lastWatch).toEqual([{ instance: 'PC0000000000000000000B', ids: [] }])

    host.reset()
    expect(remote.lastWatch).toEqual([])
    expect(host.sessions.value).toEqual([])
  })
})
