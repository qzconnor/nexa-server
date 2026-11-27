import { describe, expect, it } from 'vitest'
import type { RemoteWatch } from './shared/remote-ipc'
import { createWatches } from './watches'

describe('watches', () => {
  it('gives the client what all parts watch together', () => {
    const calls: RemoteWatch[][] = []
    const watches = createWatches((list) => calls.push([...list]))
    watches.set('host', [{ instance: 'A', ids: ['c1'] }])
    watches.set('inbox', [
      { instance: 'A', ids: [] },
      { instance: 'B', ids: [] },
    ])
    expect(calls.at(-1)).toEqual([
      { instance: 'A', ids: ['c1'] },
      { instance: 'A', ids: [] },
      { instance: 'B', ids: [] },
    ])
    watches.set('host', [])
    expect(calls.at(-1)).toEqual([
      { instance: 'A', ids: [] },
      { instance: 'B', ids: [] },
    ])
    watches.set('inbox', [])
    expect(calls.at(-1)).toEqual([])
  })
})
