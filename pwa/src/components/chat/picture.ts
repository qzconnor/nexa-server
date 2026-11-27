/** The longest side a picture goes to the computer with: the models look at no more than that anyway. */
const MAX_SIDE = 2048
/** Pictures up to this size go as they are, in a format every CLI reads. */
const KEEP_BYTES = 1_500_000
const KEPT_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/**
 * A picture as it goes to the computer: a photo of a phone's camera has several megabytes and goes
 * through the relay in pieces, so it is made smaller first, as a JPEG. Small ones go as they are.
 */
export async function preparePicture(file: Blob): Promise<Blob> {
  if (file.size <= KEEP_BYTES && KEPT_TYPES.has(file.type)) return file
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error('Dieses Bild kann der Browser nicht lesen.')
  })
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Das Bild lässt sich nicht verkleinern.')
    // A JPEG has no transparency: what was transparent turns white, not black.
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Das Bild lässt sich nicht verkleinern.'))), 'image/jpeg', 0.85),
    )
  } finally {
    bitmap.close()
  }
}

/** Bytes as base64, the way a picture goes to the computer (`app:save-image`): JSON carries no bytes. */
export async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  // In slices: one spread of megabytes overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
