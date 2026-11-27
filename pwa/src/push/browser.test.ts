import { describe, expect, it } from 'vitest'
import { pushSupport, sameKey, subscriptionKeys } from './browser'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'
const ANDROID = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'

describe('pushSupport', () => {
  it('sends Safari on iPhone and iPad to the home screen first', () => {
    expect(pushSupport({ apis: false, userAgent: IPHONE, touchPoints: 5, standalone: false })).toBe('home-screen')
    expect(pushSupport({ apis: false, userAgent: IPAD, touchPoints: 5, standalone: false })).toBe('home-screen')
    // From the home screen and still without push: too old an iOS.
    expect(pushSupport({ apis: false, userAgent: IPHONE, touchPoints: 5, standalone: true })).toBe('no')
    // A Mac without push is just an old Safari.
    expect(pushSupport({ apis: false, userAgent: IPAD, touchPoints: 0, standalone: false })).toBe('no')
  })

  it('takes the APIs where they are', () => {
    expect(pushSupport({ apis: true, userAgent: IPHONE, touchPoints: 5, standalone: true })).toBe('yes')
    expect(pushSupport({ apis: true, userAgent: ANDROID, touchPoints: 5, standalone: false })).toBe('yes')
    expect(pushSupport({ apis: false, userAgent: ANDROID, touchPoints: 5, standalone: false })).toBe('no')
  })
})

describe('subscriptionKeys', () => {
  it('encodes the raw keys as base64url without padding', () => {
    const p256dh = new Uint8Array(65).fill(0xfb)
    const auth = new Uint8Array(16).fill(0xff)
    const keys = subscriptionKeys({
      endpoint: 'https://fcm.googleapis.com/fcm/send/x',
      getKey: (name: PushEncryptionKeyName) => (name === 'p256dh' ? p256dh.buffer : auth.buffer),
    })
    expect(keys.endpoint).toBe('https://fcm.googleapis.com/fcm/send/x')
    expect(keys.p256dh).toMatch(/^[A-Za-z0-9_-]{87}$/)
    expect(keys.auth).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })

  it('refuses a subscription without keys', () => {
    expect(() => subscriptionKeys({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', getKey: () => null })).toThrow(/keine Schlüssel/)
  })
})

describe('sameKey', () => {
  it('compares the VAPID key a subscription was made with', () => {
    const key = new Uint8Array([4, 1, 2, 3])
    const made = (applicationServerKey: ArrayBuffer | null) => ({ options: { applicationServerKey, userVisibleOnly: true } })
    expect(sameKey(made(new Uint8Array([4, 1, 2, 3]).buffer), key)).toBe(true)
    expect(sameKey(made(new Uint8Array([4, 1, 2, 4]).buffer), key)).toBe(false)
    expect(sameKey(made(new Uint8Array([4, 1, 2]).buffer), key)).toBe(false)
    expect(sameKey(made(null), key)).toBe(false)
  })
})
