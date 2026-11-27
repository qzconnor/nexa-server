<script setup lang="ts">
import { Check } from '@lucide/vue'
import { computed, reactive } from 'vue'
import type { Question } from '../../shared/chat'

/** Questions of the agent, each with its options (one or several) and a free answer, as in the app. */
const props = defineProps<{ questions: Question[]; busy?: boolean }>()
const emit = defineEmits<{ submit: [answers: Record<string, string[]>] }>()

const picked = reactive<Record<string, string[]>>(Object.fromEntries(props.questions.map((q) => [q.id, []])))
const other = reactive<Record<string, string>>(Object.fromEntries(props.questions.map((q) => [q.id, ''])))

function toggle(q: Question, label: string): void {
  const list = picked[q.id]!
  if (q.multiSelect) {
    const at = list.indexOf(label)
    if (at >= 0) list.splice(at, 1)
    else list.push(label)
  } else {
    picked[q.id] = list[0] === label ? [] : [label]
    other[q.id] = ''
  }
}

function typed(q: Question): void {
  // One answer only: a free one replaces the option picked.
  if (!q.multiSelect && other[q.id]!.trim()) picked[q.id] = []
}

function answersOf(q: Question): string[] {
  const free = other[q.id]!.trim()
  if (q.multiSelect) return free ? [...picked[q.id]!, free] : [...picked[q.id]!]
  return free ? [free] : [...picked[q.id]!]
}

const complete = computed(() => props.questions.every((q) => answersOf(q).length > 0))

function submit(): void {
  if (complete.value) emit('submit', Object.fromEntries(props.questions.map((q) => [q.id, answersOf(q)])))
}
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent="submit">
    <fieldset v-for="q in questions" :key="q.id" class="flex flex-col gap-2">
      <legend class="mb-1 flex flex-wrap items-center gap-2">
        <span v-if="q.header" class="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">{{ q.header }}</span>
        <span>{{ q.question }}</span>
      </legend>
      <button
        v-for="option in q.options"
        :key="option.label"
        type="button"
        class="flex items-start gap-3 rounded-[0.875rem] border px-3.5 py-2.5 text-left transition-colors"
        :class="picked[q.id]!.includes(option.label) ? 'border-primary/60 bg-primary/10' : 'border-foreground/10 bg-foreground/[0.03] hover:bg-foreground/[0.07] active:bg-foreground/10'"
        :aria-pressed="picked[q.id]!.includes(option.label)"
        @click="toggle(q, option.label)"
      >
        <span
          class="mt-0.5 flex size-4 shrink-0 items-center justify-center border"
          :class="[q.multiSelect ? 'rounded-[4px]' : 'rounded-full', picked[q.id]!.includes(option.label) ? 'border-primary bg-primary text-primary-foreground' : 'border-foreground/25']"
        >
          <Check v-if="picked[q.id]!.includes(option.label)" class="size-3" :stroke-width="3" />
        </span>
        <span class="flex min-w-0 flex-col">
          <span class="font-medium">{{ option.label }}</span>
          <span v-if="option.description" class="text-xs text-muted-foreground">{{ option.description }}</span>
        </span>
      </button>
      <input
        v-if="q.allowOther || q.options.length === 0"
        v-model="other[q.id]"
        class="field"
        :type="q.secret ? 'password' : 'text'"
        :placeholder="q.options.length ? 'Andere Antwort …' : 'Antwort …'"
        :aria-label="q.question"
        autocomplete="off"
        @input="typed(q)"
      />
    </fieldset>
    <div>
      <button type="submit" class="btn btn-primary" :disabled="busy || !complete">Antworten</button>
    </div>
  </form>
</template>
