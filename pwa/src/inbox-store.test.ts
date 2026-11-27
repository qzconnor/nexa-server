import { describe, expect, it } from 'vitest'
import { createInboxStore, type InboxRemote } from './inbox-store'
import type { InteractionItem } from './shared/chat'
import type { InboxEntry } from './shared/inbox'
import { IpcEvent, IpcInvoke } from './shared/ipc'
import type { RemoteWatch } from './shared/remote-ipc'

const A = 'PC0000000000000000000A'
const B = 'PC0000000000000000000B'

const question: InteractionItem = {
  id: 'q1',
  kind: 'interaction',
  ts: 1,
  provider: 'claude',
  state: 'pending',
  request: { type: 'permission', toolName: 'Bash', title: 'Befehl ausführen', options: [{ id: 'allow', label: 'Erlauben' }] },
}

function entry(id: string, section: InboxEntry['section'], updatedAt: number, patch: Partial<InboxEntry> = {}): InboxEntry {
  return { id, section, title: `Chat ${id}`, projectId: 'p1', provider: 'claude', updatedAt, ...patch }
}

class FakeRemote implements InboxRemote {
  watches: RemoteWatch[][] = []
  calls: { instance: string; ch: string; args: unknown[] }[] = []
  inbox: Record<string, unknown> = {
    [A]: [entry('a1', 'waiting', 5, { pending: [question] }), entry('a2', 'unread', 3)],
    [B]: [entry('b1', 'unread', 4), entry('b2', 'running', 1)],
  }

  async invoke(instance: string, ch: string, args: unknown[]): Promise<unknown> {
    this.calls.push({ instance, ch, args })
    if (ch === IpcInvoke.sessionsInbox) {
      const value = this.inbox[instance]
      if (value instanceof Error) throw value
      return value
    }
    if (ch === IpcInvoke.projectsList) return [{ id: 'p1', name: instance === A ? 'nexa' : 'Website' }]
    if (ch === IpcInvoke.sessionsRespond) return null
    throw new Error(`no handler for ${ch}`)
  }

  setWatch(list: readonly RemoteWatch[]): void {
    this.watches.push([...list])
  }

  count(ch: string, instance?: string): number {
    return this.calls.filter((c) => c.ch === ch && (!instance || c.instance === instance)).length
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('inbox store', () => {
  it('lists what waits on every computer, by section, the newest first', async () => {
    const remote = new FakeRemote()
    const inbox = createInboxStore(remote, 0)
    inbox.setComputers([A, B])
    await settle()
    expect(remote.watches.at(-1)).toEqual([
      { instance: A, ids: [] },
      { instance: B, ids: [] },
    ])
    expect(inbox.sections.value.waiting.map((r) => r.entry.id)).toEqual(['a1'])
    expect(inbox.sections.value.unread.map((r) => [r.instance, r.entry.id, r.project])).toEqual([
      [B, 'b1', 'Website'],
      [A, 'a2', 'nexa'],
    ])
    expect(inbox.sections.value.running).toHaveLength(1)
    expect(inbox.attention.value).toBe(1)

    // The same computers again: no new watch, no new question.
    inbox.setComputers([B, A])
    expect(remote.watches).toHaveLength(1)
    expect(remote.count(IpcInvoke.sessionsInbox)).toBe(2)

    inbox.setComputers([A])
    expect(inbox.sections.value.unread.map((r) => r.entry.id)).toEqual(['a2'])
    expect(remote.watches.at(-1)).toEqual([{ instance: A, ids: [] }])
  })

  it('asks again after changes, once for a burst', async () => {
    const remote = new FakeRemote()
    const inbox = createInboxStore(remote, 5)
    inbox.setComputers([A])
    await settle()
    remote.inbox[A] = [entry('a1', 'running', 6)]
    inbox.onEvents(A, [
      { ch: IpcEvent.sessionEvent, args: [{ type: 'runtime', sessionId: 'a1', runtime: { status: 'running', connected: true } }] },
      { ch: IpcEvent.sessionEvent, args: [{ type: 'delta', sessionId: 'a1', itemId: 'x', field: 'text', text: 'hi' }] },
      { ch: IpcEvent.sessionsChanged, args: [[]] },
    ])
    inbox.onEvents(A, [{ ch: IpcEvent.sessionsChanged, args: [[]] }])
    // Another computer's events, or one not listed: nothing to ask.
    inbox.onEvents(B, [{ ch: IpcEvent.sessionsChanged, args: [[]] }])
    await settle()
    expect(remote.count(IpcInvoke.sessionsInbox, A)).toBe(2)
    expect(remote.count(IpcInvoke.sessionsInbox, B)).toBe(0)
    expect(inbox.sections.value.running.map((r) => r.entry.id)).toEqual(['a1'])
    expect(inbox.sections.value.waiting).toEqual([])

    inbox.onEvents(A, [{ ch: IpcEvent.projectsChanged, args: [[{ id: 'p1', name: 'umbenannt' }]] }])
    expect(inbox.sections.value.running[0]?.project).toBe('umbenannt')
  })

  it('answers a question and drops it from its entry at once', async () => {
    const remote = new FakeRemote()
    const inbox = createInboxStore(remote, 0)
    inbox.setComputers([A])
    await settle()
    await inbox.respond(A, 'a1', 'q1', { type: 'permission', decision: 'allow' })
    expect(remote.calls.find((c) => c.ch === IpcInvoke.sessionsRespond)).toMatchObject({ instance: A, args: ['a1', 'q1', { type: 'permission', decision: 'allow' }] })
    expect(inbox.sections.value.waiting[0]?.entry.pending).toEqual([])
  })

  it('says why a computer sent nothing, and keeps the others', async () => {
    const remote = new FakeRemote()
    remote.inbox[A] = new Error('Das darf dieses Gerät dort nicht.')
    remote.inbox[B] = [entry('b1', 'unread', 4), { id: 'broken' }, null]
    const inbox = createInboxStore(remote, 0)
    inbox.setComputers([A, B])
    await settle()
    expect(inbox.computers.get(A)?.error).toBe('Das darf dieses Gerät dort nicht.')
    expect(inbox.sections.value.unread.map((r) => r.entry.id)).toEqual(['b1'])
  })
})
