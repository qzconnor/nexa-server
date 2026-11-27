import type { InboxEntry, InboxSection } from '@shared/inbox'
import { describe, expect, it } from 'vitest'
import { FRESH_MS, notificationChat, staleNotifications } from './stale'

const NOW = Date.UTC(2026, 10, 27, 12)

const entry = (id: string, section: InboxSection) => ({ id, section }) as InboxEntry
const shown = (chat: string, reason?: string, timestamp = NOW - 60_000) => ({ data: { path: `chats/computer/${chat}`, reason }, timestamp })

describe('notificationChat', () => {
  it('reads the chat and why from what the service worker noted', () => {
    expect(notificationChat({ path: 'chats/computer/s1', reason: 'input' })).toEqual({ host: 'computer', chat: 's1', reason: 'input' })
    expect(notificationChat({ path: 'chats/computer/s1' })).toEqual({ host: 'computer', chat: 's1', reason: null })
    expect(notificationChat({ path: 'chats/computer/s1', reason: 'resolved' })).toMatchObject({ reason: null })
    expect(notificationChat({ path: '' })).toBeNull()
    expect(notificationChat({ path: 'https://example.com/' })).toBeNull()
  })
})

describe('staleNotifications', () => {
  it('takes a question away once its chat waits no more', () => {
    const question = shown('s1', 'input')
    expect(staleNotifications([question], () => [entry('s1', 'waiting')], NOW)).toEqual([])
    expect(staleNotifications([question], () => [entry('s1', 'running')], NOW)).toEqual([question])
    expect(staleNotifications([question], () => [entry('s1', 'unread')], NOW)).toEqual([question])
    expect(staleNotifications([question], () => [], NOW)).toEqual([question])
  })

  it('keeps a finished chat’s until it is read, a limit’s while it holds', () => {
    const done = shown('s1', 'done')
    const limit = shown('s2', 'limit')
    expect(staleNotifications([done, limit], () => [entry('s1', 'unread'), entry('s2', 'trouble')], NOW)).toEqual([])
    expect(staleNotifications([done], () => [entry('s1', 'trouble')], NOW)).toEqual([])
    expect(staleNotifications([done, limit], () => [entry('s1', 'running')], NOW)).toEqual([done, limit])
  })

  it('takes one of an older service worker away only once the chat needs nothing', () => {
    const older = shown('s1')
    expect(staleNotifications([older], () => [entry('s1', 'unread')], NOW)).toEqual([])
    expect(staleNotifications([older], () => [entry('s1', 'running')], NOW)).toEqual([older])
  })

  it('leaves what it can’t judge: an unknown inbox, an unreadable push, one just shown', () => {
    expect(staleNotifications([shown('s1', 'input')], () => null, NOW)).toEqual([])
    expect(staleNotifications([{ data: { path: '' }, timestamp: 0 }], () => [], NOW)).toEqual([])
    expect(staleNotifications([shown('s1', 'input', NOW - FRESH_MS + 1000)], () => [], NOW)).toEqual([])
    // Browsers that don't say when: judged like an old one.
    expect(staleNotifications([{ data: { path: 'chats/computer/s1', reason: 'input' } }], () => [], NOW)).toHaveLength(1)
  })

  it('asks the inbox of the computer the notification came from', () => {
    const asked: string[] = []
    staleNotifications([shown('s1', 'input')], (host) => (asked.push(host), []), NOW)
    expect(asked).toEqual(['computer'])
  })
})
