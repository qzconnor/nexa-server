/**
 * The scale of the whole window in percent (Einstellungen › Darstellung, Ctrl+plus/minus/0). Steps as
 * in Chrome; below 67 % the text is too small to read, above 200 % the window's minimum size no longer
 * leaves room for the layout.
 */
export const ZOOM_STEPS = [67, 75, 80, 90, 100, 110, 125, 150, 175, 200] as const
export const DEFAULT_ZOOM = 100

/** The step nearest to `percent`: a settings file edited by hand can't leave the window unusable. */
export function normalizeZoom(percent: number): number {
  if (!Number.isFinite(percent)) return DEFAULT_ZOOM
  return ZOOM_STEPS.reduce<number>((best, step) => (Math.abs(step - percent) < Math.abs(best - percent) ? step : best), DEFAULT_ZOOM)
}

/** The next step larger (1) or smaller (-1) than `percent`; at the ends it stays. */
export function stepZoom(percent: number, step: 1 | -1): number {
  const at = ZOOM_STEPS.indexOf(normalizeZoom(percent) as (typeof ZOOM_STEPS)[number])
  return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, at + step))]!
}
