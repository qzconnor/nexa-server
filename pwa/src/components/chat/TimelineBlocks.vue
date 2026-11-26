<script setup lang="ts">
import type { ChatBlock } from '../../lib/tools'
import type { ChatItem } from '../../shared/chat'
import AgentCard from './AgentCard.vue'
import InteractionCard from './InteractionCard.vue'
import MarkdownText from './MarkdownText.vue'
import NoticeRow from './NoticeRow.vue'
import RenderSpecView from './RenderSpecView.vue'
import ThinkingBlock from './ThinkingBlock.vue'
import TodoCard from './TodoCard.vue'
import ToolGroup from './ToolGroup.vue'
import ToolRow from './ToolRow.vue'
import TurnFooter from './TurnFooter.vue'
import UserMessage from './UserMessage.vue'

/** The blocks of a thread (`chatBlocks`); `items`: all of the chat's, for the work of its subagents. */
defineProps<{ blocks: ChatBlock[]; items: ChatItem[] }>()

function keyOf(block: ChatBlock): string {
  return block.type === 'item' ? block.item.id : block.id
}
</script>

<template>
  <div class="space-y-3">
    <template v-for="block in blocks" :key="keyOf(block)">
      <ToolGroup v-if="block.type === 'tools'" :tools="block.tools" />
      <ToolGroup v-else-if="block.type === 'browser'" :tools="block.tools" browser />
      <ThinkingBlock v-else-if="block.type === 'thinking'" :items="block.items" />
      <template v-else>
        <!-- The context Nexa hands a CLI when a chat moves to it: not the user's words. -->
        <UserMessage v-if="block.item.kind === 'user' && !block.item.handoff" :item="block.item" />
        <MarkdownText
          v-else-if="block.item.kind === 'assistant'"
          class="px-1"
          :class="{ 'text-muted-foreground': block.item.phase === 'commentary' }"
          :text="block.item.text"
          :streaming="block.item.streaming"
        />
        <template v-else-if="block.item.kind === 'tool'">
          <div v-if="block.item.render" class="rounded-xl border border-border bg-card px-3 py-2.5 text-sm">
            <RenderSpecView :spec="block.item.render" />
          </div>
          <ToolRow v-else :tool="block.item" />
        </template>
        <AgentCard v-else-if="block.item.kind === 'agent'" :item="block.item" :items="items" />
        <InteractionCard v-else-if="block.item.kind === 'interaction'" :item="block.item" />
        <TodoCard v-else-if="block.item.kind === 'todo'" :item="block.item" />
        <NoticeRow v-else-if="block.item.kind === 'notice'" :item="block.item" />
        <TurnFooter v-else-if="block.item.kind === 'turn'" :item="block.item" />
      </template>
    </template>
  </div>
</template>
