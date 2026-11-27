<script setup lang="ts">
import { ExternalLink } from '@lucide/vue'
import { computed, reactive } from 'vue'
import type { InteractionRequest } from '../../shared/chat'
import ToggleSwitch from '../ToggleSwitch.vue'

type Elicitation = Extract<InteractionRequest, { type: 'elicitation' }>
interface Field {
  key: string
  title: string
  description?: string
  type: 'string' | 'number' | 'boolean' | 'enum'
  options?: string[]
  required: boolean
}

/** What an MCP server asks for, as in the app: the fields of its JSON schema, or a page to open. */
const props = defineProps<{ request: Elicitation; busy?: boolean }>()
const emit = defineEmits<{ answer: [action: 'accept' | 'decline' | 'cancel', content?: Record<string, unknown>] }>()

const fields = computed<Field[]>(() => {
  const schema = props.request.schema as { properties?: Record<string, Record<string, unknown>>; required?: string[] } | undefined
  const required = new Set(schema?.required ?? [])
  return Object.entries(schema?.properties ?? {}).map(([key, p]) => {
    const options = Array.isArray(p.enum) ? (p.enum as unknown[]).map(String) : undefined
    const type = options ? 'enum' : p.type === 'boolean' ? 'boolean' : p.type === 'number' || p.type === 'integer' ? 'number' : 'string'
    return { key, title: String(p.title ?? key), description: p.description ? String(p.description) : undefined, type, options, required: required.has(key) }
  })
})

const values = reactive<Record<string, string | boolean>>({})
const complete = computed(() => fields.value.every((f) => !f.required || (values[f.key] !== undefined && values[f.key] !== '')))
/** Only a web page: a link to anything else (a file, an app) means nothing on this device. */
const page = computed(() => (props.request.url && /^https?:\/\//i.test(props.request.url) ? props.request.url : null))

function submit(): void {
  const content: Record<string, unknown> = {}
  for (const field of fields.value) {
    const value = values[field.key]
    if (value === undefined || value === '') continue
    content[field.key] = field.type === 'number' ? Number(value) : value
  }
  emit('answer', 'accept', content)
}

function openPage(): void {
  if (page.value) window.open(page.value, '_blank', 'noopener,noreferrer')
  emit('answer', 'accept')
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="whitespace-pre-wrap">{{ request.message }}</p>
    <div v-if="request.url" class="flex flex-wrap gap-2">
      <button v-if="page" type="button" class="btn btn-primary" :disabled="busy" @click="openPage">
        <ExternalLink class="size-4" />
        Öffnen und fortfahren
      </button>
      <p v-else class="text-xs text-muted-foreground">Den Link öffnet nur der Computer.</p>
      <button type="button" class="btn btn-outline" :disabled="busy" @click="emit('answer', 'decline')">Ablehnen</button>
    </div>
    <form v-else class="flex flex-col gap-3" @submit.prevent="submit">
      <div v-for="field in fields" :key="field.key" class="flex flex-col gap-1">
        <label v-if="field.type === 'boolean'" class="flex items-center justify-between gap-3 py-1">
          <span class="font-medium">{{ field.title }}<span v-if="field.required" class="text-destructive"> *</span></span>
          <ToggleSwitch :model-value="!!values[field.key]" @update:model-value="(on) => (values[field.key] = on)" />
        </label>
        <label v-else :for="`elicit-${field.key}`" class="font-medium">
          {{ field.title }}<span v-if="field.required" class="text-destructive"> *</span>
        </label>
        <span v-if="field.description" class="text-xs text-muted-foreground">{{ field.description }}</span>
        <select v-if="field.type === 'enum'" :id="`elicit-${field.key}`" v-model="values[field.key]" class="field">
          <option :value="undefined" disabled>Auswählen</option>
          <option v-for="option in field.options" :key="option" :value="option">{{ option }}</option>
        </select>
        <input
          v-else-if="field.type !== 'boolean'"
          :id="`elicit-${field.key}`"
          v-model="values[field.key] as string"
          class="field"
          :type="field.type === 'number' ? 'number' : 'text'"
          autocomplete="off"
        />
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="submit" class="btn btn-primary" :disabled="busy || !complete">Senden</button>
        <button type="button" class="btn btn-outline" :disabled="busy" @click="emit('answer', 'decline')">Ablehnen</button>
      </div>
    </form>
  </div>
</template>
