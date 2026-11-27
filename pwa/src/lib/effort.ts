/** The thinking effort of a model: its levels as the composer names and colours them. */

const LABELS: Record<string, string> = {
  none: 'Keins',
  minimal: 'Minimal',
  low: 'Niedrig',
  medium: 'Mittel',
  high: 'Hoch',
  xhigh: 'Sehr hoch',
  max: 'Maximal',
}

const DESCRIPTIONS: Record<string, string> = {
  none: 'Antwortet ohne nachzudenken, am schnellsten.',
  minimal: 'Denkt kaum nach, für einfache Aufgaben.',
  low: 'Schnelle Antworten mit wenig Nachdenken.',
  medium: 'Ausgewogen zwischen Tempo und Gründlichkeit.',
  high: 'Denkt gründlicher nach und braucht länger.',
  xhigh: 'Sehr gründlich, für schwierige Aufgaben.',
  max: 'Kann sehr viele Tokens verbrauchen, lange brauchen oder sich verdenken. Nur für die schwersten Aufgaben.',
}

export const effortLabel = (effort: string): string => LABELS[effort] ?? effort

/** What a level does; the model's own default says so instead (max keeps its warning). */
export function effortDescription(effort: string, isDefault: boolean): string {
  if (isDefault && effort !== 'max') return 'Standard für dieses Modell.'
  return DESCRIPTIONS[effort] ?? ''
}

/**
 * The colour of a level, as the CLI shows it: from medium up green, blue, purple and a rainbow for the
 * highest. `text` colours its name, `fill` the slider's track and knob.
 */
export function effortTone(effort: string): { text: string; fill: string } {
  switch (effort) {
    case 'medium':
      return { text: 'text-success', fill: 'bg-success' }
    case 'high':
      return { text: 'text-(--syn-blue)', fill: 'bg-(--syn-blue)' }
    case 'xhigh':
      return { text: 'text-(--syn-magenta)', fill: 'bg-(--syn-magenta)' }
    case 'max':
      return { text: 'effort-rainbow effort-rainbow-text', fill: 'effort-rainbow' }
    default:
      return { text: 'text-muted-foreground', fill: 'bg-muted-foreground' }
  }
}
