<script setup lang="ts">
import { Check, CircleHelp, ClipboardList, Map as MapIcon, Plug, ShieldQuestion, X } from '@lucide/vue'
import { computed, inject, ref } from 'vue'
import { CHANGE_LABEL, changeLines } from '../../lib/diff-lines'
import type { InteractionItem, InteractionResponse, PermissionMode } from '../../shared/chat'
import { PERMISSION_MODES } from '../../shared/providers'
import { REMOTE_LEVEL_LABELS } from '../../shared/remote'
import AskForm from './AskForm.vue'
import ElicitationForm from './ElicitationForm.vue'
import MarkdownText from './MarkdownText.vue'
import QuestionForm from './QuestionForm.vue'
import { RESPONDER } from './respond'

/**
 * A question of the agent, answered right here as in the app: a permission for a tool, questions
 * with options, a plan to approve, a form of an MCP server or of the agent (`ask_user`). Once answered
 * it shrinks to what was decided. Without the level `full` it only shows what is asked.
 * A pane of glass of its own in a chat; `flat` inside one already there (the inbox's entry of its chat).
 */
const props = defineProps<{ item: InteractionItem; flat?: boolean }>()
const responder = inject(RESPONDER, null)

const PLAN_MODES: PermissionMode[] = ['edits', 'ask', 'auto', 'full']

const busy = ref(false)
const error = ref<string | null>(null)
const denyText = ref('')
const showDeny = ref(false)
const feedback = ref('')
const planMode = ref<PermissionMode>('edits')

const pending = computed(() => props.item.state === 'pending')
/** Flat, it lines up with the row of its chat above it. */
const pad = computed(() => (props.flat ? 'px-2.5' : 'px-3.5'))
const request = computed(() => props.item.request)
const allowed = computed(() => !!responder?.allowed())

async function answer(response: InteractionResponse): Promise<void> {
  if (!responder || busy.value) return
  busy.value = true
  error.value = null
  try {
    await responder.respond(props.item.id, response)
  } catch (e) {
    error.value = `Antwort ging nicht durch: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    busy.value = false
  }
}

function deny(): void {
  if (!showDeny.value) {
    showDeny.value = true
    return
  }
  const message = denyText.value.trim()
  void answer(message ? { type: 'permission', decision: 'deny', message } : { type: 'permission', decision: 'deny' })
}

const summary = computed(() => {
  const r = props.item.response
  if (props.item.state === 'cancelled') return 'Nicht mehr beantwortet'
  if (!r) return ''
  switch (r.type) {
    case 'permission':
      return r.decision === 'deny' ? `Abgelehnt${r.message ? `: ${r.message}` : ''}` : r.decision === 'allow-session' ? 'Für diese Session erlaubt' : 'Erlaubt'
    case 'question':
      return 'Beantwortet'
    case 'plan':
      return r.approve ? `Plan angenommen${r.mode ? ` · ${PERMISSION_MODES[r.mode].label}` : ''}` : 'Plan abgelehnt'
    case 'elicitation':
      return r.action === 'accept' ? 'Gesendet' : 'Abgelehnt'
    case 'form':
      return r.action === 'submit' ? 'Gesendet' : 'Abgelehnt'
  }
  return ''
})

/** What was filled into a form, field by field. */
const formAnswers = computed(() => {
  const r = props.item.response
  if (request.value.type !== 'form' || r?.type !== 'form' || r.action !== 'submit') return []
  return request.value.fields.map((field) => {
    const value = r.values?.[field.key]
    const text = Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? (value ? 'Ja' : 'Nein') : String(value ?? '')
    return { key: field.key, label: field.label, text }
  })
})

/** The answered questions, each with its answer in full: free answers run long. */
const answered = computed(() => {
  const r = props.item.response
  if (request.value.type !== 'question' || r?.type !== 'question') return []
  return request.value.questions.map((q) => ({ q, answer: q.secret ? '••••' : (r.answers[q.id] ?? []).join(', ') }))
})

const icon = computed(() => ({ permission: ShieldQuestion, question: CircleHelp, plan: MapIcon, elicitation: Plug, form: ClipboardList })[request.value.type])
const heading = computed(() => {
  const r = request.value
  switch (r.type) {
    case 'permission':
      return r.title
    case 'question':
      return r.questions.length === 1 ? 'Rückfrage' : `${r.questions.length} Rückfragen`
    case 'plan':
      return 'Plan zur Freigabe'
    case 'elicitation':
      return `Anfrage von ${r.server}`
    case 'form':
      return r.title
  }
  return ''
})
</script>

<template>
  <div
    class="text-sm"
    :class="flat ? '' : ['glass card-round pane-edge border', pending ? 'border-primary/40' : 'border-foreground/10']"
  >
    <div class="flex items-center gap-2.5" :class="[pad, pending ? 'pt-3 pb-2.5' : 'py-2.5']">
      <span v-if="pending" class="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <component :is="icon" class="size-4" />
      </span>
      <component :is="icon" v-else class="size-4 shrink-0 text-muted-foreground" />
      <span class="min-w-0 break-words" :class="pending ? 'font-semibold' : 'truncate font-medium text-muted-foreground'">{{ heading }}</span>
      <span v-if="!pending" class="ml-auto flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Check v-if="item.state === 'answered'" class="size-3.5 shrink-0" />
        <X v-else class="size-3.5 shrink-0" />
        <span class="truncate">{{ summary }}</span>
      </span>
    </div>

    <ol v-if="answered.length" class="space-y-2.5 pt-0.5 pb-3" :class="pad">
      <li v-for="{ q, answer: text } in answered" :key="q.id" class="space-y-0.5">
        <p class="flex items-baseline gap-2 text-xs text-muted-foreground">
          <span v-if="q.header" class="shrink-0 rounded-full bg-foreground/10 px-2 py-px font-medium">{{ q.header }}</span>
          <span class="line-clamp-2">{{ q.question }}</span>
        </p>
        <p class="break-words whitespace-pre-wrap">{{ text || '–' }}</p>
      </li>
    </ol>

    <dl v-if="formAnswers.length" class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 pt-0.5 pb-3 text-xs" :class="pad">
      <template v-for="entry in formAnswers" :key="entry.key">
        <dt class="text-muted-foreground">{{ entry.label }}</dt>
        <dd class="break-words whitespace-pre-wrap">{{ entry.text || '–' }}</dd>
      </template>
    </dl>

    <div v-if="pending" class="flex flex-col gap-3" :class="[pad, flat ? 'pb-2.5' : 'pb-3.5']">
      <!-- What is asked; answered here when the computer allows it, else only shown. -->
      <template v-if="request.type === 'permission'">
        <p v-if="request.description" class="text-muted-foreground">{{ request.description }}</p>
        <pre v-if="request.detail && !request.changes?.length" class="code-block max-h-48 whitespace-pre-wrap">{{ request.detail }}</pre>
        <div v-for="change in request.changes ?? []" :key="change.path" class="space-y-1">
          <p class="font-mono text-xs break-all">
            {{ change.movePath ? `${change.path} → ${change.movePath}` : change.path }}
            <span class="text-muted-foreground">({{ CHANGE_LABEL[change.type] }})</span>
          </p>
          <pre v-if="change.diff || change.oldText || change.newText" class="code-block max-h-72"><span v-for="(line, i) in changeLines(change)" :key="i" class="block" :class="line.tone">{{ line.text || ' ' }}</span></pre>
        </div>
        <p v-if="request.reason" class="text-xs text-muted-foreground">{{ request.reason }}</p>
        <template v-if="allowed">
          <textarea v-if="showDeny" v-model="denyText" class="field min-h-16" placeholder="Was soll der Agent stattdessen tun? (optional)" />
          <div class="flex flex-wrap items-center gap-2">
            <template v-for="option in request.options" :key="option.id">
              <button
                v-if="option.id !== 'deny'"
                type="button"
                class="btn"
                :class="option.id === 'allow' ? 'btn-primary' : 'btn-outline'"
                :disabled="busy"
                @click="answer({ type: 'permission', decision: option.id })"
              >
                {{ option.label }}
              </button>
            </template>
            <button type="button" class="btn btn-ghost text-destructive" :disabled="busy" @click="deny">
              {{ showDeny ? 'Ablehnen' : 'Ablehnen …' }}
            </button>
          </div>
        </template>
      </template>

      <template v-else-if="request.type === 'question'">
        <QuestionForm v-if="allowed" :questions="request.questions" :busy="busy" @submit="(answers) => answer({ type: 'question', answers })" />
        <template v-else>
          <div v-for="q in request.questions" :key="q.id" class="space-y-1">
            <p class="flex flex-wrap items-center gap-2">
              <span v-if="q.header" class="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">{{ q.header }}</span>
              <span>{{ q.question }}</span>
            </p>
            <ul v-if="q.options.length" class="space-y-0.5 text-muted-foreground">
              <li v-for="option in q.options" :key="option.label">· {{ option.label }}</li>
            </ul>
          </div>
        </template>
      </template>

      <template v-else-if="request.type === 'plan'">
        <div class="max-h-[50vh] overflow-y-auto overscroll-contain rounded-[0.75rem] border border-foreground/10 bg-foreground/[0.04] px-3.5 py-3">
          <MarkdownText :text="request.plan" />
        </div>
        <template v-if="allowed">
          <textarea v-model="feedback" class="field min-h-14" placeholder="Änderungswünsche am Plan (zum Überarbeiten)" />
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" class="btn btn-primary" :disabled="busy" @click="answer({ type: 'plan', approve: true, mode: planMode })">
              Plan annehmen
            </button>
            <select v-model="planMode" class="field h-10 w-auto rounded-full py-0 text-xs" aria-label="Danach arbeiten mit">
              <option v-for="mode in PLAN_MODES" :key="mode" :value="mode">danach: {{ PERMISSION_MODES[mode].label }}</option>
            </select>
            <button
              type="button"
              class="btn btn-outline"
              :disabled="busy"
              @click="answer({ type: 'plan', approve: false, feedback: feedback.trim() || undefined })"
            >
              {{ feedback.trim() ? 'Überarbeiten lassen' : 'Ablehnen' }}
            </button>
          </div>
        </template>
      </template>

      <template v-else-if="request.type === 'elicitation'">
        <ElicitationForm
          v-if="allowed"
          :request="request"
          :busy="busy"
          @answer="(action, content) => answer({ type: 'elicitation', action, content })"
        />
        <p v-else class="whitespace-pre-wrap">{{ request.message }}</p>
      </template>

      <template v-else-if="request.type === 'form'">
        <AskForm
          v-if="allowed"
          :request="request"
          :busy="busy"
          @submit="(values) => answer({ type: 'form', action: 'submit', values })"
          @decline="answer({ type: 'form', action: 'decline' })"
        />
        <template v-else>
          <MarkdownText v-if="request.description" :text="request.description" />
          <ul class="space-y-0.5 text-muted-foreground">
            <li v-for="field in request.fields" :key="field.key">· {{ field.label }}</li>
          </ul>
        </template>
      </template>

      <p v-if="error" role="alert" class="rounded-[0.75rem] border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{{ error }}</p>
      <p v-if="!responder" class="text-xs text-primary">Wartet auf eine Antwort.</p>
      <p v-else-if="!allowed" class="text-xs text-primary">
        Wartet auf eine Antwort. Hier antworten erlaubt der Computer mit der Stufe „{{ REMOTE_LEVEL_LABELS.full }}“ (Einstellungen › Geräte).
      </p>
    </div>
  </div>
</template>
