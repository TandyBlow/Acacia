<template>
  <div class="editor-shell">
    <div v-if="activeNode" class="editor-grid">
      <div class="header-row">
        <h2>{{ activeNode.name }}</h2>
        <button class="save-btn" :disabled="isBusy" @click="saveContent">
          Save
        </button>
      </div>

      <textarea
        v-model="draft"
        class="editor-input"
        spellcheck="false"
        placeholder="Write markdown..."
      />

      <section class="preview">
        <h3>Preview</h3>
        <div class="preview-body" v-html="previewHtml" />
      </section>
    </div>

    <div v-else class="home-state">
      <h2>Home</h2>
      <p>Select a node from the left list, or create a new one.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useNodeStore } from '../../stores/nodeStore';

const store = useNodeStore();
const { activeNode, isBusy } = storeToRefs(store);

const draft = ref('');

watch(
  () => activeNode.value?.id,
  () => {
    draft.value = activeNode.value?.content ?? '';
  },
  { immediate: true },
);

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const previewHtml = computed(() => {
  const escaped = escapeHtml(draft.value);
  return escaped
    .replace(/^### (.*)$/gim, '<h3>$1</h3>')
    .replace(/^## (.*)$/gim, '<h2>$1</h2>')
    .replace(/^# (.*)$/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/^- (.*)$/gim, '<li>$1</li>')
    .replace(/\n/g, '<br>');
});

async function saveContent(): Promise<void> {
  await store.saveActiveNodeContent(draft.value);
}
</script>

<style scoped>
.editor-shell {
  width: 100%;
  height: 100%;
  padding: 12px;
}

.editor-grid {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-rows: auto 1fr 1fr;
  gap: 8px;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

h2,
h3 {
  margin: 0;
}

.save-btn {
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.12);
  color: #f4fbff;
  padding: 6px 14px;
  cursor: pointer;
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.editor-input {
  width: 100%;
  min-height: 0;
  border: 1px solid rgba(236, 251, 255, 0.2);
  border-radius: 16px;
  background: rgba(8, 44, 57, 0.24);
  color: #f1fcff;
  padding: 12px;
  resize: none;
  line-height: 1.4;
}

.editor-input:focus {
  outline: 2px solid rgba(183, 235, 251, 0.42);
}

.preview {
  border: 1px solid rgba(236, 251, 255, 0.2);
  border-radius: 16px;
  background: rgba(8, 44, 57, 0.18);
  padding: 10px 12px;
  overflow: auto;
}

.preview-body {
  margin-top: 8px;
  font-size: 14px;
  line-height: 1.45;
  white-space: normal;
  word-break: break-word;
}

.home-state {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  text-align: center;
}

.home-state p {
  margin: 0;
  opacity: 0.85;
}
</style>
