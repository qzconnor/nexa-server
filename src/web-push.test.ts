import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { encryptPayload, generateVapidKeys, isPushService, WebPush, type PushTarget } from './web-push.ts'

const b64 = (text: string) => Buffer.from(text, 'base64url')

/** The user agent's side, written out once more from RFC 8291: what a browser does with a push. */
function decrypt(body: Buffer, uaPrivate: Buffer, authSecret: Buffer): string {
  const salt = body.subarray(0, 16)
  const idLength = body[20]!
  const asPublic = body.subarray(21, 21 + idLength)
  const record = body.subarray(21 + idLength)
  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(uaPrivate)
  const uaPublic = ecdh.getPublicKey()
  const secret = ecdh.computeSecret(asPublic)
  const ikm = Buffer.from(hkdfSync('sha256', secret, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32))
  const cek = hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12)
  const decipher = createDecipheriv('aes-128-gcm', Buffer.from(cek), Buffer.from(nonce))
  decipher.setAuthTag(record.subarray(-16))
  const padded = Buffer.concat([decipher.update(record.subarray(0, -16)), decipher.final()])
  expect(padded.at(-1)).toBe(0x02)
  return padded.subarray(0, -1).toString('utf8')
}

function subscriber(): { target: PushTarget; uaPrivate: Buffer; authSecret: Buffer } {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const authSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(16)))
  return {
    target: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: ecdh.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') },
    uaPrivate: ecdh.getPrivateKey(),
    authSecret,
  }
}

describe('web push', () => {
  it('encrypts exactly as the example of RFC 8291', () => {
    const body = encryptPayload(
      b64('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24'),
      b64('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'),
      b64('BTBZMqHH6r4Tts7J_aSIgg'),
      { asPrivate: b64('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'), salt: b64('DGv6ra1nlYgDCS1FRnbzlw') },
    )
    expect(body.toString('base64url')).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    )
  })

  it('encrypts what the subscriber opens, up to the largest payload', () => {
    const { target, uaPrivate, authSecret } = subscriber()
    const text = '{"t":"msg","body":"' + 'ä'.repeat(1980) + '"}'
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(3993)
    const body = encryptPayload(Buffer.from(text), b64(target.p256dh), authSecret)
    expect(body.length).toBeLessThanOrEqual(4096)
    expect(decrypt(body, uaPrivate, authSecret)).toBe(text)
  })

  it('knows the push services and nothing else', () => {
    expect(isPushService('https://fcm.googleapis.com/fcm/send/abc')).toBe(true)
    expect(isPushService('https://web.push.apple.com/QGx')).toBe(true)
    expect(isPushService('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true)
    expect(isPushService('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true)
    expect(isPushService('http://fcm.googleapis.com/fcm/send/abc')).toBe(false)
    expect(isPushService('https://fcm.googleapis.com:8443/x')).toBe(false)
    expect(isPushService('https://user@fcm.googleapis.com/x')).toBe(false)
    expect(isPushService('https://evil-push.apple.com.example.org/x')).toBe(false)
    expect(isPushService('https://127.0.0.1/x')).toBe(false)
    expect(isPushService('not a url')).toBe(false)
  })

  it('posts with VAPID and the headers of RFC 8030, and says what came of it', async () => {
    const keys = generateVapidKeys()
    const calls: { url: string; init: RequestInit }[] = []
    let status = 201
    const push = new WebPush({
      keys,
      subject: 'mailto:admin@example.org',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init! })
        return new Response(null, { status })
      },
    })
    const { target, uaPrivate, authSecret } = subscriber()

    expect(await push.send(target, '{"hello":1}', { ttl: 60, urgency: 'high' })).toEqual({ outcome: 'ok', status: 201 })
    const { url, init } = calls[0]!
    expect(url).toBe(target.endpoint)
    expect(init.redirect).toBe('error')
    const headers = init.headers as Record<string, string>
    expect(headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', TTL: '60', Urgency: 'high' })
    expect(decrypt(Buffer.from(init.body as Uint8Array), uaPrivate, authSecret)).toBe('{"hello":1}')

    const [, token, key] = /^vapid t=([^,]+), k=(\S+)$/.exec(headers.Authorization!)!
    expect(key).toBe(keys.publicKey)
    const [header, claims, signature] = token!.split('.')
    expect(JSON.parse(b64(claims!).toString())).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'mailto:admin@example.org' })
    const raw = b64(keys.publicKey)
    const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' })
    expect(verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, b64(signature!))).toBe(true)

    // The token is kept for the next push to the same service.
    await push.send(target, 'x', { ttl: 60, urgency: 'normal' })
    expect((calls[1]!.init.headers as Record<string, string>).Authorization).toBe(headers.Authorization)

    const outcome = async (code: number) => {
      status = code
      return (await push.send(target, 'x', { ttl: 60, urgency: 'normal' })).outcome
    }
    expect(await outcome(410)).toBe('gone')
    expect(await outcome(404)).toBe('gone')
    expect(await outcome(413)).toBe('too-large')
    expect(await outcome(429)).toBe('rate-limited')
    expect(await outcome(403)).toBe('rejected')
    expect(await outcome(503)).toBe('unreachable')
  })

  it('counts a push service that does not answer as unreachable', async () => {
    const push = new WebPush({ keys: generateVapidKeys(), subject: 'mailto:a@example.org', fetch: () => Promise.reject(new TypeError('fetch failed')) })
    expect(await push.send(subscriber().target, 'x', { ttl: 0, urgency: 'normal' })).toEqual({ outcome: 'unreachable' })
  })
})
