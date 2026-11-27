<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { FormField, FormRequest, FormValue } from '../../shared/chat'
import MarkdownText from './MarkdownText.vue'

/**
 * A form of the agent (`ask_user`), as in the app: its fields prefilled with their defaults, sent as
 * values or declined. Paths are the computer's, so they are typed, not picked.
 */
const props = defineProps<{ request: FormRequest; busy?: boolean }>()
const emit = defineEmits<{ submit: [values: Record<string, FormValue>]; decline: [] }>()

function initial(field: FormField): FormValue {
  if (field.default !== undefined) return Array.isArray(field.default) ? [...field.default] : field.default
  if (field.type === 'boolean') return false
  if (field.type === 'multiselect') return []
  return ''
}

const values = reactive<Record<string, FormValue>>(Object.fromEntries(props.request.fields.map((f) => [f.key, initial(f)])))

function filled(field: FormField): boolean {
  const value = values[field.key]
  if (field.type === 'boolean') return true
  if (Array.isArray(value)) return value.length > 0
  return String(value ?? '').trim() !== ''
}

const complete = computed(() => props.request.fields.every((f) => !f.required || filled(f)))

function toggle(field: FormField, option: string, on: boolean): void {
  const list = (values[field.key] as string[]).filter((o) => o !== option)
  // In the order of the options, not of the taps.
  values[field.key] = on ? (field.options ?? []).filter((o) => o === option || list.includes(o)) : list
}

/** What the agent gets: numbers as numbers, empty fields left out. */
function submit(): void {
  if (!complete.value) return
  const out: Record<string, FormValue> = {}
  for (const field of props.request.fields) {
    const value = values[field.key]
    if (field.type === 'boolean') out[field.key] = !!value
    else if (field.type === 'multiselect') out[field.key] = value as string[]
    else if (filled(field)) {
      const text = String(value).trim()
      out[field.key] = field.type === 'number' && Number.isFinite(Number(text)) ? Number(text) : text
    }
  }
  emit('submit', out)
}

const id = (field: FormField) => `ask-${field.key}`
</script>

<template>
  <form class="flex flex-col gap-3" @submit.prevent="submit">
    <MarkdownText v-if="request.description" :text="request.description" />
    <div v-for="field in request.fields" :key="field.key" class="flex flex-col gap-1">
      <label v-if="field.type === 'boolean'" :for="id(field)" class="flex items-center justify-between gap-3 py-1">
        <span class="font-medium">{{ field.label }}</span>
        <input :id="id(field)" v-model="values[field.key]" type="checkbox" class="size-5 accent-(--primary)" />
      </label>
      <label v-else :for="id(field)" class="font-medium">
        {{ field.label }}<span v-if="field.required" class="text-destructive"> *</span>
      </label>
      <span v-if="field.description" class="text-xs text-muted-foreground">{{ field.description }}</span>
      <textarea v-if="field.type === 'textarea'" :id="id(field)" v-model="values[field.key] as string" class="field min-h-20" />
      <select v-else-if="field.type === 'select'" :id="id(field)" v-model="values[field.key]" class="field">
        <option value="" disabled>Auswählen</option>
        <option v-for="option in field.options" :key="option" :value="option">{{ option }}</option>
      </select>
      <div v-else-if="field.type === 'multiselect'" :id="id(field)" class="flex flex-col gap-1">
        <label v-for="option in field.options" :key="option" class="flex items-center gap-2.5 py-1">
          <input
            type="checkbox"
            class="size-5 accent-(--primary)"
            :checked="(values[field.key] as string[]).includes(option)"
            @change="toggle(field, option, ($event.target as HTMLInputElement).checked)"
          />
          {{ option }}
        </label>
      </div>
      <input
        v-else-if="field.type !== 'boolean'"
        :id="id(field)"
        v-model="values[field.key] as string"
        class="field"
        :class="{ 'font-mono text-sm': field.type === 'path' }"
        :type="field.type === 'number' ? 'number' : 'text'"
        :inputmode="field.type === 'number' ? 'decimal' : undefined"
        autocomplete="off"
      />
    </div>
    <div class="flex flex-wrap gap-2">
      <button type="submit" class="btn btn-primary" :disabled="busy || !complete">{{ request.submitLabel || 'Senden' }}</button>
      <button type="button" class="btn btn-outline" :disabled="busy" @click="emit('decline')">Ablehnen</button>
    </div>
  </form>
</template>
