<script setup lang="ts">
import { CircleHelp, ClipboardList, ShieldQuestion } from '@lucide/vue'
import { computed } from 'vue'
import type { InteractionItem } from '../../shared/chat'
import MarkdownText from './MarkdownText.vue'

/** A question of the agent: what it asks, and what became of it. Answered at the computer for now. */
const props = defineProps<{ item: InteractionItem }>()

const DECISIONS = { allow: 'Erlaubt', 'allow-session': 'Für die Sitzung erlaubt', deny: 'Abgelehnt' } as const

const heading = computed(() => {
  const request = props.item.request
  switch (request.type) {
    case 'permission':
      return { icon: ShieldQuestion, text: `Freigabe: ${request.title}` }
    case 'question':
      return { icon: CircleHelp, text: request.questions.length === 1 ? request.questions[0]!.header || 'Frage' : `${request.questions.length} Fragen` }
    case 'plan':
      return { icon: ClipboardList, text: 'Plan' }
    case 'elicitation':
      return { icon: CircleHelp, text: `Frage von ${request.server}` }
    case 'form':
      return { icon: ClipboardList, text: request.title }
  }
  return { icon: CircleHelp, text: 'Frage' }
})

/** What was answered, in words. */
const outcome = computed(() => {
  const { state, response } = props.item
  if (state === 'cancelled') return 'Abgebrochen'
  if (state === 'pending' || !response) return null
  switch (response.type) {
    case 'permission':
      return DECISIONS[response.decision]
    case 'question':
      return Object.values(response.answers).flat().join(', ') || 'Beantwortet'
    case 'plan':
      return response.approve ? 'Plan angenommen' : 'Plan abgelehnt'
    case 'elicitation':
      return response.action === 'accept' ? 'Angenommen' : response.action === 'decline' ? 'Abgelehnt' : 'Abgebrochen'
    case 'form':
      return response.action === 'submit' ? 'Ausgefüllt' : 'Abgelehnt'
  }
  return 'Beantwortet'
})
</script>

<template>
  <div
    class="rounded-xl border px-3 py-2.5 text-sm"
    :class="item.state === 'pending' ? 'border-primary/50 bg-primary/10' : 'border-border bg-card'"
  >
    <p class="flex items-center gap-2 font-medium">
      <component :is="heading.icon" class="size-4 shrink-0 text-primary" />
      <span class="min-w-0 break-words">{{ heading.text }}</span>
    </p>

    <div class="mt-1.5 space-y-2">
      <template v-if="item.request.type === 'permission'">
        <p v-if="item.request.description" class="text-muted-foreground">{{ item.request.description }}</p>
        <pre v-if="item.request.detail" class="code-block">{{ item.request.detail }}</pre>
        <p v-if="item.request.reason" class="text-xs text-muted-foreground">{{ item.request.reason }}</p>
      </template>
      <template v-else-if="item.request.type === 'question'">
        <div v-for="question in item.request.questions" :key="question.id">
          <p>{{ question.question }}</p>
          <ul v-if="question.options.length" class="mt-1 space-y-0.5 text-muted-foreground">
            <li v-for="option in question.options" :key="option.label">· {{ option.label }}</li>
          </ul>
        </div>
      </template>
      <div v-else-if="item.request.type === 'plan'" class="max-h-80 overflow-y-auto">
        <MarkdownText :text="item.request.plan" />
      </div>
      <p v-else-if="item.request.type === 'elicitation'">{{ item.request.message }}</p>
      <template v-else-if="item.request.type === 'form'">
        <MarkdownText v-if="item.request.description" :text="item.request.description" />
        <ul class="space-y-0.5 text-muted-foreground">
          <li v-for="field in item.request.fields" :key="field.key">· {{ field.label }}</li>
        </ul>
      </template>
    </div>

    <p v-if="item.state === 'pending'" class="mt-2 text-xs text-primary">Wartet auf eine Antwort. Antworten kannst du am Computer.</p>
    <p v-else-if="outcome" class="mt-2 text-xs text-muted-foreground">{{ outcome }}</p>
  </div>
</template>
