<template>
  <div class="picker-mask" @mousedown.self="emit('cancel')">
    <div class="picker-panel" role="dialog" aria-modal="true" aria-label="Link node picker">
      <header class="picker-header">
        <h3>Link To Node</h3>
        <button type="button" class="close-btn" @click="emit('cancel')">Close</button>
      </header>

      <div class="search-row">
        <input
          ref="searchInput"
          v-model.trim="query"
          type="text"
          class="search-input"
          placeholder="Search nodes"
          @keydown.esc.prevent="emit('cancel')"
          @keydown.enter.prevent="confirmByEnter"
        />
      </div>

      <ul v-if="filteredOptions.length > 0" class="option-list">
        <li v-for="option in filteredOptions" :key="option.id" class="option-item">
          <button
            type="button"
            class="option-btn"
            :class="{ selected: selectedId === option.id }"
            :style="{ paddingLeft: `${12 + option.depth * 14}px` }"
            @click="selectOption(option.id)"
            @dblclick="confirmOption(option.id)"
          >
            <span class="option-name">{{ option.name }}</span>
            <span class="option-path">{{ option.path }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="empty-text">No matching nodes.</p>

      <footer class="picker-footer">
        <button type="button" class="footer-btn cancel" @click="emit('cancel')">Cancel</button>
        <button
          type="button"
          class="footer-btn confirm"
          :disabled="!selectedId"
          @click="confirmSelected"
        >
          Insert Link
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';

interface NodeLinkOption {
  id: string;
  name: string;
  path: string;
  depth: number;
}

const props = defineProps<{
  options: NodeLinkOption[];
}>();

const emit = defineEmits<{
  (event: 'cancel'): void;
  (event: 'confirm', nodeId: string): void;
}>();

const query = ref('');
const selectedId = ref<string | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

const filteredOptions = computed(() => {
  const keyword = normalize(query.value);
  if (!keyword) {
    return props.options;
  }
  return props.options.filter((option) => {
    const nameHit = normalize(option.name).includes(keyword);
    const pathHit = normalize(option.path).includes(keyword);
    return nameHit || pathHit;
  });
});

function alignSelection(): void {
  if (filteredOptions.value.length === 0) {
    selectedId.value = null;
    return;
  }

  if (
    selectedId.value &&
    filteredOptions.value.some((option) => option.id === selectedId.value)
  ) {
    return;
  }

  const firstOption = filteredOptions.value[0];
  selectedId.value = firstOption ? firstOption.id : null;
}

function selectOption(nodeId: string): void {
  selectedId.value = nodeId;
}

function confirmOption(nodeId: string): void {
  emit('confirm', nodeId);
}

function confirmSelected(): void {
  if (!selectedId.value) {
    return;
  }
  emit('confirm', selectedId.value);
}

function confirmByEnter(): void {
  if (filteredOptions.value.length === 0) {
    return;
  }

  if (!selectedId.value) {
    const firstOption = filteredOptions.value[0];
    if (firstOption) {
      emit('confirm', firstOption.id);
    }
    return;
  }
  emit('confirm', selectedId.value);
}

watch(filteredOptions, () => {
  alignSelection();
});

watch(
  () => props.options,
  () => {
    alignSelection();
  },
  { immediate: true },
);

onMounted(() => {
  void nextTick(() => {
    searchInput.value?.focus();
    searchInput.value?.select();
  });
});
</script>

<style scoped>
.picker-mask {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(24, 38, 91, 0.22);
  backdrop-filter: blur(3px);
}

.picker-panel {
  width: min(760px, 100%);
  max-height: min(80vh, 680px);
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 10px;
  padding: 14px;
  border: 1px solid rgba(109, 138, 255, 0.3);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 16px 42px rgba(41, 69, 143, 0.28);
  color: #20306f;
}

.picker-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.picker-header h3 {
  margin: 0;
  font-size: 18px;
  line-height: 1.2;
}

.close-btn,
.footer-btn {
  border: 1px solid rgba(109, 138, 255, 0.32);
  border-radius: 10px;
  padding: 7px 12px;
  background: rgba(255, 255, 255, 0.88);
  color: #2e4297;
  cursor: pointer;
}

.close-btn:hover,
.footer-btn:hover {
  background: rgba(255, 255, 255, 1);
}

.footer-btn:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}

.search-row {
  min-height: 0;
}

.search-input {
  width: 100%;
  border: 1px solid rgba(109, 138, 255, 0.3);
  border-radius: 10px;
  padding: 9px 11px;
  font-size: 14px;
  line-height: 1.3;
  background: rgba(255, 255, 255, 0.9);
}

.search-input:focus-visible {
  outline: 2px solid rgba(82, 111, 233, 0.52);
  outline-offset: 1px;
}

.option-list {
  margin: 0;
  padding: 0;
  list-style: none;
  min-height: 0;
  overflow: auto;
  border: 1px solid rgba(109, 138, 255, 0.24);
  border-radius: 10px;
  background: rgba(245, 250, 255, 0.72);
}

.option-item + .option-item {
  border-top: 1px solid rgba(109, 138, 255, 0.14);
}

.option-btn {
  width: 100%;
  display: grid;
  gap: 3px;
  border: 0;
  background: transparent;
  color: #20306f;
  text-align: left;
  padding-top: 8px;
  padding-right: 12px;
  padding-bottom: 8px;
  cursor: pointer;
}

.option-btn:hover {
  background: rgba(148, 171, 255, 0.14);
}

.option-btn.selected {
  background: rgba(102, 128, 255, 0.18);
}

.option-name {
  font-weight: 600;
  line-height: 1.3;
}

.option-path {
  font-size: 12px;
  color: rgba(46, 66, 151, 0.8);
  line-height: 1.2;
}

.empty-text {
  margin: 0;
  border: 1px dashed rgba(109, 138, 255, 0.35);
  border-radius: 10px;
  padding: 12px;
  color: rgba(46, 66, 151, 0.85);
  text-align: center;
}

.picker-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.footer-btn.confirm {
  background: rgba(102, 128, 255, 0.18);
}
</style>
