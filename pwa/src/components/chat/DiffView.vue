<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { useProjectPath } from '../../composables/useProjectPath'
import { changeLines, changeStats, type DiffLine } from '../../lib/diff'
import { hasLanguage, highlightText, languageOf, loadLanguage } from '../../lib/syntax'
import type { FileChange } from '../../shared/chat'
import { baseName } from '../../shared/utils'

/**
 * The change of one file as the app's chat window shows it (DiffView.vue there): its lines with numbers,
 * coloured like the code of its language. `bare`: what is around it names the file and counts its lines
 * already (a tool row), so it has no head of its own, except for where a moved file went. A long change
 * shows its first lines only: a phone isn't the place to read a whole file.
 */
const props = defineProps<{ change: FileChange; maxHeight?: string; bare?: boolean }>()

/** Lines shown of one change at most. */
const MAX_LINES = 400

const { relative } = useProjectPath()
const shown = computed(() => relative(props.change.path))
const all = computed(() => changeLines(props.change))
const lines = computed(() => all.value.slice(0, MAX_LINES))
const more = computed(() => all.value.length - lines.value.length)
const stats = computed(() => changeStats(all.value))
const language = computed(() => languageOf(props.change.path.replace(/\\/g, '/')))
const loaded = ref(0)

watchEffect(() => {
  const lang = language.value
  if (lang && !hasLanguage(lang)) void loadLanguage(lang).then((ok) => ok && loaded.value++)
})

/** Old and new side highlighted as wholes, so a line keeps the context of those around it. */
const html = computed<(string | null)[]>(() => {
  void loaded.value
  const lang = language.value
  if (!lang || !hasLanguage(lang)) return []
  const out = new Array<string | null>(lines.value.length).fill(null)
  const side = (pick: (l: DiffLine) => boolean) => {
    const idx: number[] = []
    lines.value.forEach((l, i) => l.kind !== 'hunk' && pick(l) && idx.push(i))
    const highlighted = highlightText(
      idx.map((i) => lines.value[i]!.text),
      lang,
    )
    if (highlighted) idx.forEach((i, k) => (out[i] = highlighted[k] ?? null))
  }
  side((l) => l.kind !== 'add')
  side((l) => l.kind === 'add')
  return out
})

const typeLabel = computed(() => ({ add: 'neu', update: '', delete: 'gelöscht' })[props.change.type])
</script>

<template>
  <!-- The background of the web app's code blocks (.code-block), darker than the app's: on a phone the chat lies under glass. -->
  <div class="overflow-hidden rounded-xl border border-foreground/10 bg-(--code-bg)/80 text-(--code-fg)">
    <div v-if="bare && change.movePath" class="truncate border-b border-foreground/10 px-3 py-1.5 font-mono text-xs text-muted-foreground">
      → {{ relative(change.movePath) }}
    </div>
    <div v-else-if="!bare" class="flex items-center gap-2 border-b border-foreground/10 px-3 py-1.5 text-xs">
      <span class="shrink-0 font-mono">{{ baseName(change.path) }}</span>
      <span class="min-w-0 truncate text-muted-foreground">{{ change.movePath ? `→ ${relative(change.movePath)}` : shown }}</span>
      <span v-if="typeLabel" class="rounded bg-foreground/10 px-1.5 text-[0.7rem] text-muted-foreground">{{ typeLabel }}</span>
      <span class="ml-auto shrink-0 font-mono tabular-nums">
        <span class="text-(--syn-green)">+{{ stats.added }}</span>
        <span class="ml-1.5 text-(--syn-red)">−{{ stats.removed }}</span>
      </span>
    </div>
    <div class="syntax overflow-auto overscroll-x-contain font-mono text-[0.75rem] leading-[1.45]" :style="{ maxHeight: maxHeight ?? '22rem' }">
      <table class="w-full border-collapse">
        <tbody>
          <tr v-for="(line, i) in lines" :key="i" class="diff-line" :data-kind="line.kind">
            <!-- One number per line, as in the app: where it is now, a removed one where it was. -->
            <td class="diff-gutter w-[1%] whitespace-nowrap">{{ line.kind === 'hunk' ? '' : (line.new ?? line.old ?? '') }}</td>
            <td class="w-4 text-center text-muted-foreground select-none">{{ line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : '' }}</td>
            <!-- highlight.js escapes the code it gets: its HTML is spans around escaped text. -->
            <td v-if="html[i]" class="pr-4 whitespace-pre" v-html="html[i]" />
            <td v-else class="pr-4 whitespace-pre">{{ line.text }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="more" class="px-3 py-1 text-(--syn-comment) select-none">… {{ more }} weitere Zeilen</p>
    </div>
  </div>
</template>
