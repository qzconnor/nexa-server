/** A first name for this device in the list of devices; the user can change it before pairing. */
export function guessDeviceName(userAgent: string = navigator.userAgent): string {
  if (/iPhone/.test(userAgent)) return 'iPhone'
  if (/iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && /Mobile/.test(userAgent))) return 'iPad'
  if (/Android/.test(userAgent)) return /Mobile/.test(userAgent) ? 'Android-Handy' : 'Android-Tablet'
  return 'Web-App'
}
