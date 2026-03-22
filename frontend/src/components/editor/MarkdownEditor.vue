<template>
  <div class="editor-shell">
    <textarea
      v-if="activeNode"
      v-model="draft"
      class="editor-input"
      spellcheck="false"
    />
    <div v-else class="home-state">
      <h2>主页</h2>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useNodeStore } from '../../stores/nodeStore';

const AUTO_SAVE_DELAY_MS = 1000;

const store = useNodeStore();
const { activeNode } = storeToRefs(store);

const draft = ref('');
const lastSavedContent = ref('');

let autoSaveTimer: number | null = null;
let saveInFlight = false;
let queuedContent: string | null = null;

function clearAutoSaveTimer(): void {
  if (autoSaveTimer !== null) {
    window.clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
}

async function enqueueSave(nodeId: string, content: string): Promise<void> {
  if (!activeNode.value || activeNode.value.id !== nodeId) {
    return;
  }
  if (content === lastSavedContent.value) {
    return;
  }

  if (saveInFlight) {
    queuedContent = content;
    return;
  }

  saveInFlight = true;
  try {
    const saved = await store.saveActiveNodeContent(nodeId, content);
    if (saved && activeNode.value?.id === nodeId) {
      lastSavedContent.value = content;
    }
  } finally {
    saveInFlight = false;
    if (queuedContent !== null) {
      const nextContent = queuedContent;
      queuedContent = null;
      if (activeNode.value?.id === nodeId && nextContent !== lastSavedContent.value) {
        await enqueueSave(nodeId, nextContent);
      }
    }
  }
}

watch(
  () => activeNode.value?.id,
  () => {
    clearAutoSaveTimer();
    saveInFlight = false;
    queuedContent = null;
    const content = activeNode.value?.content ?? '';
    lastSavedContent.value = content;
    draft.value = content;
  },
  { immediate: true },
);

watch(draft, (value) => {
  const nodeId = activeNode.value?.id;
  if (!nodeId) {
    clearAutoSaveTimer();
    return;
  }

  if (value === lastSavedContent.value) {
    clearAutoSaveTimer();
    return;
  }

  clearAutoSaveTimer();
  autoSaveTimer = window.setTimeout(() => {
    void enqueueSave(nodeId, value);
  }, AUTO_SAVE_DELAY_MS);
});

onBeforeUnmount(() => {
  clearAutoSaveTimer();
});
</script>

<style scoped>
.editor-shell {
  width: 100%;
  height: 100%;
  color: var(--color-primary);
}

.editor-input {
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--color-primary);
  padding: 14px 16px;
  resize: none;
  line-height: 1.5;
  font: inherit;
}

.editor-input:focus {
  outline: none;
}

.home-state {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--color-primary);
}
</style>
