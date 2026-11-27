<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { effortDescription, effortLabel, effortTone } from '../../lib/effort'

/**
 * The thinking effort as a slider from fast to thorough, as the app's (EffortSlider.vue): the levels of
 * the model, the chosen one in its colour. `value` '' is the model's default; choosing the default level
 * gives '' too, so the chat keeps following the CLI. Given on release: each step would restart the CLI.
 */
const props = defineProps<{ efforts: string[]; value: string; defaultEffort?: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:value': [string] }>()

const track = useTemplateRef<HTMLElement>('track')
const dragging = ref<number | null>(null)

const count = computed(() => props.efforts.length)
const chosen = computed(() => props.efforts.indexOf(props.value || props.defaultEffort || ''))
const index = computed(() => dragging.value ?? chosen.value)
const current = computed(() => props.efforts[index.value] ?? '')
const tone = computed(() => effortTone(current.value))
const description = computed(() =>
  current.value ? effortDescription(current.value, current.value === props.defaultEffort) : 'Standard für dieses Modell.',
)

// The stops sit in the middle of equal columns, so the names under them line up.
const inset = computed(() => `${50 / Math.max(count.value, 1)}%`)
const at = (i: number) => `calc(${inset.value} + (100% - 2 * ${inset.value}) * ${count.value > 1 ? i / (count.value - 1) : 0.5})`

function pick(i: number): void {
  const effort = props.efforts[i]
  if (!effort || props.disabled) return
  const value = effort === props.defaultEffort ? '' : effort
  if (value !== props.value) emit('update:value', value)
}

function indexAt(clientX: number): number {
  const rect = track.value?.getBoundingClientRect()
  if (!rect?.width) return Math.max(chosen.value, 0)
  const x = (clientX - rect.left) / rect.width
  return Math.min(count.value - 1, Math.max(0, Math.round(x * count.value - 0.5)))
}

function onPointerDown(event: PointerEvent): void {
  if (props.disabled || event.button !== 0) return
  track.value?.setPointerCapture(event.pointerId)
  track.value?.focus()
  dragging.value = indexAt(event.clientX)
}

function onPointerMove(event: PointerEvent): void {
  if (dragging.value !== null) dragging.value = indexAt(event.clientX)
}

function onPointerUp(): void {
  if (dragging.value === null) return
  const i = dragging.value
  dragging.value = null
  pick(i)
}

function onKeydown(event: KeyboardEvent): void {
  const from = Math.max(chosen.value, 0)
  const to: Record<string, number> = { ArrowLeft: from - 1, ArrowDown: from - 1, ArrowRight: from + 1, ArrowUp: from + 1, Home: 0, End: count.value - 1 }
  if (!(event.key in to)) return
  event.preventDefault()
  pick(Math.min(count.value - 1, Math.max(0, to[event.key]!)))
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-1" :class="{ 'pointer-events-none opacity-50': disabled }">
    <div class="flex justify-between text-[0.72rem] text-muted-foreground">
      <span>Schneller</span>
      <span>Gründlicher</span>
    </div>
    <!-- Taller than it looks: a finger needs room to hit and drag it. -->
    <div
      ref="track"
      role="slider"
      tabindex="0"
      aria-label="Denkaufwand"
      :aria-valuemin="0"
      :aria-valuemax="count - 1"
      :aria-valuenow="Math.max(index, 0)"
      :aria-valuetext="current ? effortLabel(current) : 'Standard'"
      :aria-disabled="disabled || undefined"
      class="group/effort relative h-7 cursor-pointer touch-none rounded-full outline-none"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="dragging = null"
      @keydown="onKeydown"
    >
      <div class="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-foreground/15" :style="{ left: inset, right: inset }" />
      <div
        v-if="index > 0"
        class="absolute top-1/2 h-1 -translate-y-1/2 rounded-full transition-[width] duration-150"
        :class="tone.fill"
        :style="{ left: inset, width: `calc(${at(index)} - ${inset})` }"
      />
      <span
        v-for="(effort, i) in efforts"
        :key="effort"
        class="absolute top-1/2 size-1.5 -translate-1/2 rounded-full"
        :class="i <= index ? 'bg-background/70' : 'bg-muted-foreground/40'"
        :style="{ left: at(i) }"
      />
      <span
        v-if="index >= 0"
        class="absolute top-1/2 size-4 -translate-1/2 rounded-full border-2 border-background shadow-sm transition-[left] duration-150 group-focus-visible/effort:ring-3 group-focus-visible/effort:ring-ring/50"
        :class="tone.fill"
        :style="{ left: at(index) }"
      />
    </div>
    <div class="grid text-center text-[0.75rem]" :style="{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }">
      <button
        v-for="(effort, i) in efforts"
        :key="effort"
        type="button"
        tabindex="-1"
        class="truncate px-0.5 py-0.5"
        :class="i === index ? ['font-medium', effortTone(effort).text] : 'text-muted-foreground hover:text-foreground'"
        @click="pick(i)"
      >
        {{ effortLabel(effort) }}
      </button>
    </div>
    <p class="min-h-4 text-[0.75rem] text-muted-foreground">{{ description }}</p>
  </div>
</template>
