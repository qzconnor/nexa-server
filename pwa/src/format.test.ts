import { describe, expect, it } from 'vitest'
import { guessDeviceName } from './device-name'
import { ago, issueText } from './format'

describe('format', () => {
  it('says how long ago', () => {
    const now = Date.UTC(2026, 10, 26, 12)
    expect(ago(now - 30_000, now)).toBe('vor 30 Sekunden')
    expect(ago(now - 5 * 60_000, now)).toBe('vor 5 Minuten')
    expect(ago(now - 26 * 3600_000, now)).toBe('gestern')
  })

  it('explains why a device is not trusted', () => {
    expect(issueText({ kind: 'clock', skew: 3 * 60_000 })).toContain('3 Minuten vor')
    expect(issueText({ kind: 'clock', skew: -60_000 })).toContain('1 Minute nach')
    expect(issueText({ kind: 'key' })).toContain('Schlüssel')
  })

  it('guesses a name for this device', () => {
    expect(guessDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148')).toBe('iPhone')
    expect(guessDeviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Mobile/15E148')).toBe('iPad')
    expect(guessDeviceName('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari/537.36')).toBe('Android-Handy')
    expect(guessDeviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Web-App')
  })
})
