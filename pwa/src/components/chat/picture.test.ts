import { describe, expect, it } from 'vitest'
import { base64Of, preparePicture } from './picture'

describe('base64Of', () => {
  it('gives the bytes of a picture as base64, also beyond one slice', async () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 7) % 256)
    const encoded = await base64Of(new Blob([bytes]))
    expect(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))).toEqual(bytes)
  })
})

describe('preparePicture', () => {
  it('leaves a small picture of a usual format as it is', async () => {
    const small = new Blob([new Uint8Array(1000)], { type: 'image/png' })
    expect(await preparePicture(small)).toBe(small)
  })
})
