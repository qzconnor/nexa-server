<script setup lang="ts">
import { Check, ChevronLeft, ChevronRight, LoaderCircle } from '@lucide/vue'
import { computed, ref } from 'vue'
import { host } from '../../host'
import { chosenModel, clampPercent, usageLevel, usageTextClass, windowsOfModel } from '../../lib/usage'
import { identityLabel, planLabel, usesSecret, visibleAccounts, type Account } from '../../shared/accounts'
import { PROVIDER_IDS, type PermissionMode, type ProviderId } from '../../shared/chat'
import { enabledProviders, offeredProviders, PERMISSION_MODES, PROVIDERS } from '../../shared/providers'
import type { ModelDefaults, SessionUpdateInput } from '../../shared/types'
import ProviderIcon from '../ProviderIcon.vue'
import ToggleSwitch from '../ToggleSwitch.vue'
import EffortSlider from './EffortSlider.vue'

/**
 * The chat's settings in a pane over the composer, as the app's under its gear (ComposerSettings.vue)
 * plus its CLI and account menus (ComposerControls.vue): CLI, account, model, thinking effort, Ultracode
 * and the permission mode. CLI, account, model and permissions open as pages in the pane, as the „+“
 * menu's do. How the agent runs is the computer's own business: it lets this device change it only at
 * the level „full“.
 */
const props = defineProps<{
  provider: ProviderId
  /** The account the chat runs with (chat-limits.ts `chatAccount`). */
  account: string
  model: string
  effort: string
  mode: PermissionMode
  /** The chat's choice; missing: as the CLI's settings say (`defaults`). */
  ultracode?: boolean
  defaults: ModelDefaults | null
  full: boolean
  update: (patch: SessionUpdateInput) => Promise<void>
}>()

type Page = 'main' | 'cli' | 'account' | 'model' | 'mode'
const page = ref<Page>('main')
const TITLES: Record<Exclude<Page, 'main'>, string> = { cli: 'CLI für diesen Chat', account: 'Account', model: 'Modell', mode: 'Freigaben' }

/** Esc on a page goes back to the list (FloatingPane `back`). */
function back(): boolean {
  if (page.value === 'main') return false
  page.value = 'main'
  return true
}
defineExpose({ back })

const models = computed(() => host.limits.models[props.provider])
const current = computed(() => models.value?.find((m) => m.id === props.model) ?? models.value?.find((m) => m.isDefault))
const modelLabel = computed(() => (props.model ? (models.value?.find((m) => m.id === props.model)?.label ?? props.model) : (current.value?.label ?? 'Standard')))
const efforts = computed(() => current.value?.efforts ?? [])
/** The CLI's own answer first: Claude Code's default depends on the model and the account's settings. */
const defaultEffort = computed(() => props.defaults?.effort || current.value?.defaultEffort)
const ultracodeShown = computed(() => props.provider === 'claude' && !!props.defaults?.ultracode?.available)
const ultracodeOn = computed(() => props.ultracode ?? props.defaults?.ultracode?.on ?? false)
const modes = computed(() => PROVIDERS[props.provider].permissionModes)

// The computer's CLIs as its own menu offers them: switched on (Antigravity once installed), one that is
// off only while this chat still has it; one that isn't installed or is off can't be picked.
const installed = computed(() => host.limits.providers.filter((p) => p.installed).map((p) => p.id))
const enabled = computed(() => (host.limits.settings ? enabledProviders(host.limits.settings) : [props.provider]))
const cliChoices = computed(() => {
  const offered = host.limits.settings ? offeredProviders(host.limits.settings, installed.value) : [props.provider]
  return PROVIDER_IDS.filter((id) => offered.includes(id) || id === props.provider)
})
const canRun = (id: ProviderId) => installed.value.includes(id) && enabled.value.includes(id)

function cliDetail(id: ProviderId): string {
  if (!enabled.value.includes(id)) return 'in den Einstellungen ausgeschaltet'
  const status = host.limits.providers.find((p) => p.id === id)
  if (!status) return ''
  return status.installed ? (status.version ?? 'installiert') : 'nicht installiert'
}

const accounts = computed(() => visibleAccounts(host.limits.accounts, props.provider))
const account = computed(() => accounts.value.find((a) => a.id === props.account))

/** Who is signed in, or why the account can't run. */
function accountDetail(a: Account): string {
  if (a.authState === 'missing') return usesSecret(a.kind) ? 'Kein Secret gespeichert' : 'Nicht angemeldet'
  if (a.authState === 'dead') return 'Login abgelaufen'
  return identityLabel(a.identity) ?? (a.kind === 'apiKey' ? 'API-Key' : a.kind === 'token' ? 'Long-lived Token' : 'Angemeldet')
}

/** The fullest window of an account's limits for the chat's model: which account still has room. */
function busiest(a: Account): number | null {
  const windows = windowsOfModel(host.limits.usage.find((u) => u.accountId === a.id)?.windows ?? [], chosenModel(models.value, props.model))
  return windows.length ? Math.max(...windows.slice(0, 2).map((w) => clampPercent(w.usedPercent))) : null
}

const MODE_TONE: Partial<Record<PermissionMode, string>> = { full: 'text-destructive', plan: 'text-primary' }

// --- Changing ------------------------------------------------------------------------------------------

const saving = ref(false)
const error = ref<string | null>(null)

/** Back on the list once the computer took it, so the new value shows where it was picked from. */
async function change(patch: SessionUpdateInput): Promise<void> {
  if (!props.full || saving.value) return
  saving.value = true
  error.value = null
  try {
    await props.update(patch)
    page.value = 'main'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

function pickModel(id: string): void {
  if (id === props.model) return void (page.value = 'main')
  // An effort the new model doesn't know goes back to its default.
  const next = models.value?.find((m) => m.id === id)
  const effortGone = !!props.effort && !!next?.efforts && !next.efforts.includes(props.effort)
  void change(effortGone ? { model: id, effort: '' } : { model: id })
}

function pickCli(id: ProviderId): void {
  if (id === props.provider) return void (page.value = 'main')
  if (!canRun(id)) return
  void change({ provider: id })
}

function pickAccount(id: string): void {
  if (id === props.account) return void (page.value = 'main')
  void change({ account: id })
}

function pickMode(mode: PermissionMode): void {
  if (mode === props.mode) return void (page.value = 'main')
  void change({ permissionMode: mode })
}

function open(next: Page): void {
  if (!props.full) return
  page.value = next
  error.value = null
}
</script>

<template>
  <div class="flex min-h-0 flex-col">
    <!-- The list: what the chat runs with, each opening its choices. -->
    <div v-if="page === 'main'" class="flex min-h-0 flex-col overflow-y-auto overscroll-contain">
      <button v-if="cliChoices.length > 1" type="button" class="menu-row" :aria-disabled="!full" @click="open('cli')">
        <span class="w-24 shrink-0 text-muted-foreground">CLI</span>
        <span class="flex min-w-0 flex-1 items-center justify-end gap-2">
          <ProviderIcon :provider="provider" />
          <span class="truncate">{{ PROVIDERS[provider].name }}</span>
        </span>
        <ChevronRight class="menu-icon" :class="{ 'opacity-40': !full }" />
      </button>
      <button v-if="accounts.length > 1" type="button" class="menu-row" :aria-disabled="!full" @click="open('account')">
        <span class="w-24 shrink-0 text-muted-foreground">Account</span>
        <span class="flex min-w-0 flex-1 items-center justify-end gap-2">
          <span class="size-2 shrink-0 rounded-full ring-2 ring-foreground/10" :style="{ backgroundColor: account?.color ?? 'var(--muted-foreground)' }" />
          <span class="truncate">{{ account?.name ?? 'Account' }}</span>
          <span v-if="account && busiest(account) !== null" class="shrink-0 text-[0.8rem] tabular-nums" :class="usageTextClass[usageLevel(busiest(account)!)]">
            {{ busiest(account) }} %
          </span>
        </span>
        <ChevronRight class="menu-icon" :class="{ 'opacity-40': !full }" />
      </button>
      <button type="button" class="menu-row" :aria-disabled="!full" @click="open('model')">
        <span class="w-24 shrink-0 text-muted-foreground">Modell</span>
        <span class="min-w-0 flex-1 truncate text-right">{{ modelLabel }}</span>
        <ChevronRight class="menu-icon" :class="{ 'opacity-40': !full }" />
      </button>

      <template v-if="efforts.length">
        <div class="menu-separator" />
        <div class="px-2.5 pt-1.5 pb-0.5">
          <span class="text-[0.95rem] text-muted-foreground">Denkaufwand</span>
          <EffortSlider class="mt-1" :efforts="efforts" :value="effort" :default-effort="defaultEffort" :disabled="!full || saving" @update:value="change({ effort: $event })" />
        </div>
      </template>

      <template v-if="ultracodeShown">
        <div class="menu-separator" />
        <label class="menu-row h-auto cursor-pointer py-2" :class="{ 'cursor-default': !full }">
          <span class="flex min-w-0 flex-1 flex-col">
            <span>Ultracode</span>
            <span class="text-[0.76rem] text-muted-foreground">Dynamische Workflows bei jeder Aufgabe</span>
          </span>
          <ToggleSwitch :model-value="ultracodeOn" :disabled="!full || saving" @update:model-value="change({ ultracode: $event })" />
        </label>
      </template>

      <div class="menu-separator" />
      <button type="button" class="menu-row h-auto py-2" :aria-disabled="!full" @click="open('mode')">
        <span class="w-24 shrink-0 self-start pt-px text-muted-foreground">Freigaben</span>
        <span class="flex min-w-0 flex-1 flex-col items-end text-right">
          <span class="max-w-full truncate" :class="MODE_TONE[mode]">{{ PERMISSION_MODES[mode].label }}</span>
          <span class="text-[0.76rem] text-muted-foreground">{{ PERMISSION_MODES[mode].description }}</span>
        </span>
        <ChevronRight class="menu-icon" :class="{ 'opacity-40': !full }" />
      </button>
    </div>

    <template v-else>
      <div class="flex shrink-0 items-center gap-1 pr-1">
        <button
          type="button"
          class="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          aria-label="Zurück"
          @click="page = 'main'"
        >
          <ChevronLeft class="size-5" />
        </button>
        <h2 class="flex-1 text-[0.95rem] font-semibold">{{ TITLES[page] }}</h2>
        <LoaderCircle v-if="saving" class="size-4 animate-spin text-muted-foreground" aria-label="Wird geändert" />
      </div>
      <div class="menu-separator" />

      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <!-- The computer's CLIs: the chat goes on with another one, which gets the conversation so far. -->
        <template v-if="page === 'cli'">
          <button
            v-for="id in cliChoices"
            :key="id"
            type="button"
            class="menu-row h-auto py-2"
            :class="{ 'opacity-50': !canRun(id) }"
            :disabled="saving || (!canRun(id) && id !== provider)"
            @click="pickCli(id)"
          >
            <ProviderIcon :provider="id" class="size-4" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate">{{ PROVIDERS[id].name }}</span>
              <span v-if="cliDetail(id)" class="truncate text-[0.76rem] text-muted-foreground">{{ cliDetail(id) }}</span>
            </span>
            <Check class="size-4 shrink-0" :class="id === provider ? 'opacity-100' : 'opacity-0'" />
          </button>
          <p class="px-2.5 pt-1 pb-1 text-[0.72rem] leading-snug text-muted-foreground">Beim Wechsel bekommt die andere CLI den bisherigen Verlauf als Kontext.</p>
        </template>

        <!-- The CLI's accounts, with how full each one's limits are: where the chat can go on. -->
        <template v-else-if="page === 'account'">
          <button v-for="a in accounts" :key="a.id" type="button" class="menu-row h-auto items-start py-2" :disabled="saving" @click="pickAccount(a.id)">
            <span class="mt-1.5 size-2 shrink-0 rounded-full ring-2 ring-foreground/10" :style="{ backgroundColor: a.color ?? 'var(--muted-foreground)' }" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="flex min-w-0 items-center gap-1.5">
                <span class="truncate">{{ a.name }}</span>
                <span v-if="planLabel(a.identity.subscriptionType)" class="shrink-0 text-[0.76rem] text-muted-foreground">{{ planLabel(a.identity.subscriptionType) }}</span>
              </span>
              <span class="truncate text-[0.76rem]" :class="a.authState === 'missing' || a.authState === 'dead' ? 'text-destructive' : 'text-muted-foreground'">
                {{ accountDetail(a) }}
              </span>
            </span>
            <span v-if="busiest(a) !== null" class="mt-0.5 shrink-0 text-[0.8rem] tabular-nums" :class="usageTextClass[usageLevel(busiest(a)!)]" title="Am stärksten genutztes Limit">
              {{ busiest(a) }} %
            </span>
            <Check class="mt-0.5 size-4 shrink-0" :class="a.id === account?.id ? 'opacity-100' : 'opacity-0'" />
          </button>
          <p class="px-2.5 pt-1 pb-1 text-[0.72rem] leading-snug text-muted-foreground">Beim Wechsel geht die Unterhaltung beim anderen Account weiter.</p>
        </template>

        <!-- The CLI's models; a model of its own picks the default effort again where its levels differ. -->
        <template v-else-if="page === 'model'">
          <p v-if="!models" class="menu-note"><LoaderCircle class="size-4 animate-spin" /> Wird geladen …</p>
          <p v-else-if="!models.length" class="menu-note">{{ PROVIDERS[provider].name }} nennt keine Modelle.</p>
          <button v-for="m in models ?? []" :key="m.id || 'default'" type="button" class="menu-row h-auto items-start py-2" :disabled="saving" @click="pickModel(m.id)">
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate">{{ m.label }}</span>
              <span v-if="m.description" class="line-clamp-2 text-[0.76rem] text-muted-foreground">{{ m.description }}</span>
            </span>
            <Check class="mt-0.5 size-4 shrink-0" :class="m.id === model || (!model && m.isDefault && !models?.some((x) => x.id === '')) ? 'opacity-100' : 'opacity-0'" />
          </button>
        </template>

        <!-- How much the agent may do without asking. -->
        <template v-else-if="page === 'mode'">
          <button v-for="m in modes" :key="m" type="button" class="menu-row h-auto items-start py-2" :disabled="saving" @click="pickMode(m)">
            <span class="flex min-w-0 flex-1 flex-col">
              <span :class="m === 'full' && 'text-destructive'">{{ PERMISSION_MODES[m].label }}</span>
              <span class="text-[0.76rem] text-muted-foreground">{{ PERMISSION_MODES[m].description }}</span>
            </span>
            <Check class="mt-0.5 size-4 shrink-0" :class="m === mode ? 'opacity-100' : 'opacity-0'" />
          </button>
        </template>
      </div>
    </template>

    <template v-if="error || !full">
      <div class="menu-separator" />
      <p v-if="error" class="px-2.5 pb-1 text-[0.76rem] text-destructive" role="alert">{{ error }}</p>
      <p v-if="!full" class="px-2.5 pt-0.5 pb-1 text-[0.72rem] leading-snug text-muted-foreground">
        CLI, Modell, Account und Freigaben ändern erlaubt der Computer erst mit der Freigabe „Alles“.
      </p>
    </template>
  </div>
</template>
