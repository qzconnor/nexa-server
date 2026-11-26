import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DB_FILE, runCli, type CliIo } from './cli.ts'
import { Store } from './store.ts'

let dir: string
let out: string[]
let err: string[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nexa-server-cli-'))
  out = []
  err = []
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

function io(extra: Partial<CliIo> = {}): CliIo {
  return {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    env: { NEXA_DATA_DIR: dir, NEXA_LOG_LEVEL: 'error', NEXA_PORT: '0' },
    ...extra,
  }
}

const run = (...args: string[]): Promise<number> => runCli(args, io())
const text = (lines: string[]): string => lines.join('\n')

function withStore<T>(fn: (store: Store) => T): T {
  const store = new Store(join(dir, DB_FILE), { maxInstances: 20 })
  try {
    return fn(store)
  } finally {
    store.close()
  }
}

describe('cli', () => {
  it('creates, lists and deletes a namespace', async () => {
    expect(await run('namespace', 'create', 'connor')).toBe(0)
    expect(text(out)).toContain('Namespace „connor“ angelegt.')
    expect(text(out)).toMatch(/([0-9A-Z]{4}-){7}[0-9A-Z]{4}/)

    out = []
    expect(await run('namespace', 'list')).toBe(0)
    expect(out[0]).toMatch(/^Name\s+Instanzen\s+Einladungen\s+Angelegt$/)
    expect(out[1]).toMatch(/^connor\s+0\s+1\s+/)

    expect(await run('namespace', 'delete', 'connor')).toBe(1)
    expect(text(err)).toContain('--yes')
    expect(await run('namespace', 'delete', 'connor', '--yes')).toBe(0)
    expect(withStore((store) => store.hasNamespace('connor'))).toBe(false)
  })

  it('prints invites that a device can redeem', async () => {
    await run('namespace', 'create', 'connor')
    out = []
    expect(await run('invite', 'connor')).toBe(0)
    const code = text(out).match(/([0-9A-Z]{4}-){7}[0-9A-Z]{4}/)![0]
    const instance = withStore((store) => store.redeemInvite(code, { name: 'Desktop', role: 'host', signKey: 's', dhKey: 'd' }))

    out = []
    expect(await run('instances', 'connor')).toBe(0)
    expect(out[1]).toMatch(new RegExp(`^${instance.id}\\s+Desktop\\s+Host\\s+nie\\s+`))

    expect(await run('instance', 'remove', instance.id)).toBe(1)
    expect(await run('instance', 'remove', instance.id, '--yes')).toBe(0)
    expect(withStore((store) => store.hasInstance(instance.id))).toBe(false)
  })

  it('explains mistakes in German with exit codes 1 and 2', async () => {
    expect(await run('namespace', 'create', 'Böse')).toBe(1)
    expect(text(err)).toContain('geht nicht als Name')
    expect(await run('invite', 'nobody')).toBe(1)
    expect(text(err)).toContain('Den Namespace „nobody“ gibt es nicht.')
    expect(await run('frobnicate')).toBe(2)
    expect(await run('namespace', 'list', '--force')).toBe(2)
    expect(await run('invite')).toBe(2)
    expect(await runCli(['namespace', 'list'], { ...io(), env: { NEXA_DATA_DIR: dir, NEXA_PORT: 'x' } })).toBe(1)
    expect(text(err)).toContain('NEXA_PORT')
  })

  it('serves until told to stop', async () => {
    let stop!: () => void
    const stopped = new Promise<void>((resolve) => (stop = resolve))
    const running = runCli(['serve'], io({ untilStop: () => stopped }))
    // Port 0 picks a free port the test cannot see, so give the start a moment instead of polling it.
    await new Promise((resolve) => setTimeout(resolve, 200))
    stop()
    expect(await running).toBe(0)
    expect(err).toEqual([])
  })
})
