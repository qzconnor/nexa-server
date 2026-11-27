import { describe, expect, it } from 'vitest'
import { ConfigError, DEFAULT_VAPID_SUBJECT, loadConfig } from './config.ts'

describe('config', () => {
  it('takes the VAPID subject as push services accept it', () => {
    expect(loadConfig({}).vapidSubject).toBe(DEFAULT_VAPID_SUBJECT)
    expect(loadConfig({ NEXA_VAPID_SUBJECT: ' mailto:admin@example.org ' }).vapidSubject).toBe('mailto:admin@example.org')
    expect(loadConfig({ NEXA_VAPID_SUBJECT: 'https://nexa.example.org' }).vapidSubject).toBe('https://nexa.example.org')
    for (const wrong of ['admin@example.org', 'mailto:admin', 'http://nexa.example.org', 'https://localhost']) {
      expect(() => loadConfig({ NEXA_VAPID_SUBJECT: wrong })).toThrow(ConfigError)
    }
  })
})
