<template>
  <div :ref="ctx.editorRef" class="editor-root">
    <!-- Single activity area: always visible -->
    <div class="activity-layout">
      <div class="activity-glass-host">
        <GlassWrapper>
          <div class="activity-scroll">
            <div v-if="activeNode && sameNameNodePaths.length > 1" class="same-name-paths" aria-live="polite">
              <div class="same-name-paths-title">{{ t('editor.sameNamePathsTitle') }}</div>
              <div class="same-name-paths-list">
                <div
                  v-for="(path, index) in sameNameNodePaths"
                  :key="`${path}-${index}`"
                  class="same-name-path"
                >
                  {{ path }}
                </div>
              </div>
            </div>

            <!-- text_input mode: inline chat prompt in editor -->
            <template v-if="chatMode === 'text_input'">
              <EditorContent
                :editor="editor"
                class="editor-input"
                spellcheck="false"
              />
            </template>

            <!-- file_upload mode: file upload UI -->
            <div v-else-if="chatMode === 'file_upload'" class="chat-input-form">
              <FileUploadArea @uploaded="onFileUploaded" @removed="onFileRemoved" />
            </div>

            <!-- file_uploaded mode: file received, show action choice -->
            <MarkdownEditorFileChoice
              v-else-if="chatMode === 'file_uploaded' && pendingFile"
              :pending-file="pendingFile"
              :error-message="errorMessage"
              @fill="fillContentFromFile()"
              @line-by-line="startLineByLineChat()"
              @cancel="cancelFileUpload()"
            />

            <!-- idle or conversing: editor + optional conversation controls -->
            <template v-else>
              <EditorContent
                :editor="editor"
                class="editor-input"
                :class="{ 'editor-readonly': chatMode === 'conversing' }"
                spellcheck="false"
              />

              <MarkdownEditorConversing
                v-if="chatMode === 'conversing'"
                :total-kp="totalKp"
                :current-kp-index="currentKpIndex"
                :is-completed="isCompleted"
                :current-sub-topic="currentSubTopic"
                v-model:user-input="userInput"
                :is-busy="isBusy"
                :can-send="canSend"
                :progress-percent="progressPercent"
                @conv-keydown="onConvKeydown"
                @skip="onSkipTurn"
                @end="onEndConversation"
                @send="sendAnswer"
              />
            </template>
          </div>
        </GlassWrapper>
      </div>
    </div>

    <!-- Concept chips: clickable knowledge points extracted from conversation -->
    <div
      v-if="chatMode === 'text_input' && mentionedConcepts.length > 0"
      class="concept-chips-row"
    >
      <span
        v-for="concept in mentionedConcepts"
        :key="concept.name"
        class="concept-chip"
        :class="{
          'concept-chip-marked': markedConceptNames.has(concept.name),
          'concept-chip-verified': concept.verified,
        }"
        :title="concept.wiki_summary || concept.definition"
        @click="onConceptClick(concept.name)"
      >
        <span v-if="concept.verified" class="concept-chip-w-badge">W</span>
        {{ concept.name }}
        <span v-if="markedConceptNames.has(concept.name)" class="concept-chip-check">&#10003;</span>
      </span>
    </div>

    <!-- Bottom action bar: context-sensitive -->
    <MarkdownEditorBottomBar
      v-if="showBottomBar"
      :chat-mode="chatMode"
      :is-busy="isBusy"
      :is-chat-sunk="isChatSunk"
      :is-file-sunk="isFileSunk"
      @toggle-chat="toggleChat()"
      @start-chat-file="startChatFile()"
      @regenerate="onRegenerate"
      @mark-concept="onMarkConcept"
    />
  </div>
</template>

<script setup lang="ts">
import { EditorContent } from '@tiptap/vue-3'
import FileUploadArea from '../ai/FileUploadArea.vue'
import GlassWrapper from '../ui/GlassWrapper.vue'
import MarkdownEditorConversing from './MarkdownEditorConversing.vue'
import MarkdownEditorBottomBar from './MarkdownEditorBottomBar.vue'
import MarkdownEditorFileChoice from './MarkdownEditorFileChoice.vue'
import { createMarkdownEditorContext } from './MarkdownEditorContext'
import { useMarkdownEditorChatDoc } from './MarkdownEditorChatDoc'
import { useMarkdownEditorSave } from './MarkdownEditorSave'
import { useMarkdownEditorChat } from './MarkdownEditorChat'
import { useMarkdownEditorChatToggle } from './MarkdownEditorChatToggle'
import { useMarkdownEditorConcept } from './MarkdownEditorConcept'
import { useMarkdownEditorFile } from './MarkdownEditorFile'
import { createMarkdownEditorHandlers } from './MarkdownEditorPaste'
import { createMarkdownEditorEditor } from './MarkdownEditorEditor'
import { useMarkdownEditorWatchers } from './MarkdownEditorWatchers'
import 'highlight.js/styles/github.css'
import 'katex/dist/katex.min.css'

const ctx = createMarkdownEditorContext()
const doc = useMarkdownEditorChatDoc(ctx)
const save = useMarkdownEditorSave(ctx)
const chat = useMarkdownEditorChat(ctx, doc, save)
const toggle = useMarkdownEditorChatToggle(ctx, doc, save)
const concept = useMarkdownEditorConcept(ctx, doc)
const file = useMarkdownEditorFile(ctx, doc, save)
const handlers = createMarkdownEditorHandlers(ctx, chat)
const editor = createMarkdownEditorEditor(ctx, handlers)
useMarkdownEditorWatchers(ctx, { save, editor, onCinemaChatMode: toggle.onCinemaChatMode })

// Template bindings
const {
  t,
  activeNode,
  sameNameNodePaths,
  chatMode,
  pendingFile,
  errorMessage,
  userInput,
  isBusy,
  canSend,
  progressPercent,
  isChatSunk,
  isFileSunk,
  showBottomBar,
  currentKpIndex,
  totalKp,
  isCompleted,
  currentSubTopic,
  markedConceptNames,
  mentionedConcepts,
} = ctx

const { onFileUploaded, onFileRemoved, fillContentFromFile, startLineByLineChat, cancelFileUpload } = file
const { onConceptClick, onRegenerate, onMarkConcept } = concept
const { toggleChat, startChatFile } = toggle
const { onSkipTurn, onEndConversation, sendAnswer, onConvKeydown } = chat
</script>

<style scoped src="./MarkdownEditor.1.css"></style>
<style scoped src="./MarkdownEditor.2.css"></style>
<style scoped src="./MarkdownEditor.3.css"></style>
<style scoped src="./MarkdownEditor.4.css"></style>
