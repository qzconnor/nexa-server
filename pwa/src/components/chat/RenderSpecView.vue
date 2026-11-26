<script setup lang="ts">
import { computed } from 'vue'
import type { RenderSpec } from '../../shared/chat'
import MarkdownText from './MarkdownText.vue'

/**
 * What Nexa's drawing tools made, as far as a phone shows it without the app's chart and diagram
 * libraries: tables, key figures, notes and code as they are, a chart as the table of its data, a
 * diagram as its Mermaid source.
 */
const props = defineProps<{ spec: RenderSpec }>()

const TONES = {
  info: 'border-chart-2/40 bg-chart-2/10',
  success: 'border-success/40 bg-success/10',
  warning: 'border-warning/40 bg-warning/10',
  danger: 'border-destructive/40 bg-destructive/10',
} as const

/** A chart's data as a table: the categories, then a column per series. */
const chartTable = computed(() => {
  if (props.spec.type !== 'chart') return null
  const { x, series, data } = props.spec
  return {
    columns: [{ key: x, label: x }, ...series.map((s) => ({ key: s.key, label: s.label ?? s.key }))],
    rows: data,
  }
})
const table = computed(() => (props.spec.type === 'table' ? { columns: props.spec.columns, rows: props.spec.rows } : chartTable.value))

function cell(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}
</script>

<template>
  <figure class="space-y-2">
    <figcaption v-if="'title' in spec && spec.title" class="font-medium">{{ spec.title }}</figcaption>
    <p v-if="'description' in spec && spec.description" class="text-xs text-muted-foreground">{{ spec.description }}</p>

    <div v-if="spec.type === 'callout'" class="rounded-lg border px-3 py-2" :class="TONES[spec.tone]">
      <MarkdownText :text="spec.text" />
    </div>

    <pre v-else-if="spec.type === 'code'" class="code-block">{{ spec.code }}</pre>

    <pre v-else-if="spec.type === 'diagram'" class="code-block">{{ spec.mermaid }}</pre>

    <dl v-else-if="spec.type === 'stats'" class="grid grid-cols-2 gap-2">
      <div v-for="(item, i) in spec.items" :key="i" class="rounded-lg border border-border bg-card px-3 py-2">
        <dt class="text-xs text-muted-foreground">{{ item.label }}</dt>
        <dd class="text-lg font-semibold">{{ item.value }}</dd>
        <dd v-if="item.hint" class="text-xs text-muted-foreground">{{ item.hint }}</dd>
      </div>
    </dl>

    <div v-if="table" class="markdown">
      <div class="md-table">
        <table>
          <thead>
            <tr>
              <th v-for="column in table.columns" :key="column.key">{{ column.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in table.rows" :key="i">
              <td v-for="column in table.columns" :key="column.key">{{ cell(row[column.key]) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <p v-if="spec.type === 'diagram'" class="text-xs text-muted-foreground">Das Diagramm zeichnet die App am Computer.</p>
  </figure>
</template>
