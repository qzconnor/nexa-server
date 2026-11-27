<script setup lang="ts">
import { ExternalLink, GitPullRequest, GitPullRequestDraft, RefreshCw } from '@lucide/vue'
import { pullRequestState, pullRequestToneClass } from '../../lib/pull-requests'
import { webLink } from '../../pull-requests'
import type { PullRequestInfo } from '../../shared/pull-requests'

/**
 * The open pull requests of the chat's repository, as the menu of the app's chip under the composer
 * (ComposerPullRequests.vue): number, title, how it stands, `branch → base` and who opened it, the one
 * of the checked-out branch first. A tap opens one on GitHub in the browser.
 */
defineProps<{
  pullRequests: PullRequestInfo[]
  branch: string | null
  /** The repository's page, for „Alle auf GitHub“. */
  webUrl: string | null
  loading: boolean
}>()
const emit = defineEmits<{ refresh: []; done: [] }>()

const iconOf = (pr: PullRequestInfo) => (pr.draft ? GitPullRequestDraft : GitPullRequest)

/** The state's word in its colour; an open or draft one stays grey like the rest of the line. */
function labelClass(pr: PullRequestInfo): string {
  const { tone } = pullRequestState(pr)
  return tone === 'open' || tone === 'draft' ? '' : pullRequestToneClass[tone]
}
</script>

<template>
  <div class="flex min-h-0 flex-col">
    <div class="flex shrink-0 items-baseline justify-between gap-3 px-2.5 pt-1.5 pb-1">
      <h2 class="text-[0.95rem] font-semibold">Offene Pull Requests</h2>
      <span class="text-[0.8rem] text-muted-foreground tabular-nums">{{ pullRequests.length }}</span>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <a
        v-for="pr in pullRequests"
        :key="pr.number"
        :href="webLink(pr.url)"
        target="_blank"
        rel="noopener noreferrer"
        class="menu-row h-auto items-start gap-2.5 py-2"
        @click="emit('done')"
      >
        <component :is="iconOf(pr)" class="mt-0.5 size-4 shrink-0" :class="pullRequestToneClass[pullRequestState(pr).tone]" />
        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="line-clamp-2 break-words">
            <span class="text-muted-foreground tabular-nums">#{{ pr.number }}</span>
            {{ pr.title }}
          </span>
          <span class="flex min-w-0 items-center gap-1.5 text-[0.8rem] text-muted-foreground">
            <span class="shrink-0" :class="labelClass(pr)">{{ pullRequestState(pr).label }}</span>
            <span aria-hidden="true">·</span>
            <span class="truncate">{{ pr.branch }} → {{ pr.base }}</span>
            <template v-if="pr.author">
              <span aria-hidden="true">·</span>
              <span class="max-w-[35%] shrink-0 truncate">{{ pr.author }}</span>
            </template>
          </span>
        </span>
        <span v-if="branch && pr.branch === branch" class="mt-0.5 shrink-0 rounded-md bg-foreground/10 px-1.5 py-px text-[0.7rem] text-muted-foreground">
          Dieser Branch
        </span>
      </a>
    </div>
    <div class="menu-separator" />
    <a v-if="webLink(webUrl)" :href="webLink(`${webUrl}/pulls`)" target="_blank" rel="noopener noreferrer" class="menu-row" @click="emit('done')">
      <ExternalLink class="menu-icon" />
      <span class="flex-1">Alle auf GitHub</span>
    </a>
    <button type="button" class="menu-row" :disabled="loading" @click="emit('refresh')">
      <RefreshCw class="menu-icon" :class="{ 'animate-spin': loading }" />
      <span class="flex-1">{{ loading ? 'Wird aktualisiert …' : 'Aktualisieren' }}</span>
    </button>
  </div>
</template>
