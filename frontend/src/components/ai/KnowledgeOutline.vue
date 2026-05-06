<template>
  <div class="outline-container">
    <div class="outline-header">
      <h3 class="outline-title">选择要学习的主题</h3>
      <p class="outline-subtitle">
        共提取了 {{ totalCount }} 个知识点，已按主题分组
      </p>
    </div>

    <div class="outline-groups">
      <div
        v-for="(group, index) in groups"
        :key="index"
        class="group-card"
        :class="{ selected: selectedGroups.has(index) }"
        @click="toggleGroup(index)"
      >
        <div class="group-header">
          <div class="group-checkbox">
            <span v-if="selectedGroups.has(index)">✓</span>
          </div>
          <div class="group-info">
            <div class="group-name">{{ group.group_name }}</div>
            <div class="group-count">{{ group.knowledge_points.length }} 个知识点</div>
          </div>
        </div>

        <div class="group-points">
          <div
            v-for="kp in group.knowledge_points"
            :key="kp.id"
            class="point-item"
          >
            <span class="point-type">{{ getTypeLabel(kp.type) }}</span>
            <span class="point-title">{{ kp.title }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="outline-actions">
      <button class="outline-btn outline-btn-secondary" @click="selectAll">
        全选
      </button>
      <button
        class="outline-btn outline-btn-primary"
        :disabled="selectedGroups.size === 0"
        @click="confirm"
      >
        开始学习（{{ selectedKnowledgePoints.length }} 个知识点）
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { KnowledgeGroup, KnowledgePoint } from '../../composables/useFileGenerate';

interface Props {
  groups: KnowledgeGroup[];
  totalCount: number;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  confirm: [knowledgePoints: KnowledgePoint[]];
}>();

const selectedGroups = ref<Set<number>>(new Set());

function toggleGroup(index: number) {
  if (selectedGroups.value.has(index)) {
    selectedGroups.value.delete(index);
  } else {
    selectedGroups.value.add(index);
  }
}

function selectAll() {
  if (selectedGroups.value.size === props.groups.length) {
    selectedGroups.value.clear();
  } else {
    selectedGroups.value = new Set(props.groups.map((_, i) => i));
  }
}

const selectedKnowledgePoints = computed(() => {
  const points: KnowledgePoint[] = [];
  selectedGroups.value.forEach(index => {
    points.push(...props.groups[index].knowledge_points);
  });
  return points;
});

function confirm() {
  if (selectedKnowledgePoints.value.length > 0) {
    emit('confirm', selectedKnowledgePoints.value);
  }
}

function getTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    concept: '概念',
    principle: '原理',
    application: '应用',
    comparison: '对比',
  };
  return labels[type] || type;
}
</script>

<style scoped>
.outline-container {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.outline-header {
  text-align: center;
}

.outline-title {
  margin: 0 0 8px 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--color-primary);
}

.outline-subtitle {
  margin: 0;
  font-size: 14px;
  color: var(--color-primary);
  opacity: 0.6;
}

.outline-groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 400px;
  overflow-y: auto;
  padding: 4px;
}

.group-card {
  border: 2px solid var(--color-glass-border);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.04);
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.group-card:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(102, 255, 229, 0.4);
}

.group-card.selected {
  background: rgba(102, 255, 229, 0.12);
  border-color: rgba(102, 255, 229, 0.6);
}

.group-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.group-checkbox {
  width: 24px;
  height: 24px;
  border: 2px solid var(--color-glass-border);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}

.group-card.selected .group-checkbox {
  background: rgba(102, 255, 229, 0.3);
  border-color: rgba(102, 255, 229, 0.8);
}

.group-info {
  flex: 1;
}

.group-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-primary);
  margin-bottom: 4px;
}

.group-count {
  font-size: 13px;
  color: var(--color-primary);
  opacity: 0.6;
}

.group-points {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-left: 36px;
}

.point-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--color-primary);
}

.point-type {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(102, 255, 229, 0.2);
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

.point-title {
  opacity: 0.8;
}

.outline-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 8px;
}

.outline-btn {
  padding: 10px 22px;
  border-radius: 14px;
  border: 1px solid var(--color-glass-border);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.outline-btn-secondary {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-primary);
}

.outline-btn-secondary:hover {
  background: rgba(255, 255, 255, 0.16);
}

.outline-btn-primary {
  background: rgba(102, 255, 229, 0.28);
  color: var(--color-primary);
}

.outline-btn-primary:hover:not(:disabled) {
  background: rgba(102, 255, 229, 0.44);
}

.outline-btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
