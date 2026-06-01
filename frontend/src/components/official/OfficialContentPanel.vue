<template>
  <div class="official-content-panel">
    <div class="activity-layout">
      <div class="activity-glass-host">
        <GlassWrapper>
          <div v-if="loading" class="activity-scroll">
            <div class="loading-state">加载中...</div>
          </div>
          <div v-else-if="errorMsg" class="activity-scroll">
            <div class="error-state">{{ errorMsg }}</div>
          </div>
          <div v-else-if="!node" class="activity-scroll">
            <div class="empty-state">内容加载失败</div>
          </div>
          <div v-else class="activity-scroll">
            <div class="oc-content">
              <h1 class="oc-title">{{ node.title }}</h1>
              <div class="oc-body" v-html="renderedContent"></div>
            </div>
          </div>
        </GlassWrapper>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useNodeStore } from '../../stores/nodeStore';
import GlassWrapper from '../ui/GlassWrapper.vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const nodeStore = useNodeStore();
const { officialNodeContent } = storeToRefs(nodeStore);

const loading = ref(true);
const errorMsg = ref<string | null>(null);

const node = computed(() => officialNodeContent.value);

const renderedContent = computed(() => {
  if (!node.value?.content) return '';
  return DOMPurify.sanitize(marked.parse(node.value.content, { async: false }) as string);
});

watch(officialNodeContent, () => {
  loading.value = false;
});

onMounted(() => {
  loading.value = !officialNodeContent.value;
});
</script>

<style scoped>
.official-content-panel {
  width: 100%;
  height: 100%;
}

.loading-state,
.error-state,
.empty-state {
  padding: 48px;
  text-align: center;
  font-size: 15px;
  color: var(--color-secondary);
}

.error-state {
  color: #e53935;
}

.oc-content {
  padding: 32px;
  max-width: 720px;
  margin: 0 auto;
}

.oc-title {
  margin: 0 0 28px;
  font-size: 26px;
  font-weight: 700;
  color: var(--color-hint-on-light, var(--color-hint));
}

.oc-body {
  font-size: 15px;
  line-height: 1.8;
  color: var(--color-primary);
}

.oc-body :deep(h1) { font-size: 1.8em; margin-bottom: 0.5em; }
.oc-body :deep(h2) { font-size: 1.4em; margin: 1em 0 0.5em; font-weight: 700; }
.oc-body :deep(h3) { font-size: 1.2em; margin: 0.8em 0 0.4em; font-weight: 700; }
.oc-body :deep(p) { margin-bottom: 0.8em; opacity: 0.9; }
.oc-body :deep(ul), .oc-body :deep(ol) { padding-left: 1.5em; margin-bottom: 0.8em; }
.oc-body :deep(li) { margin-bottom: 0.4em; }
.oc-body :deep(strong) { font-weight: 700; }
.oc-body :deep(code) { background: rgba(0,0,0,0.06); padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
.oc-body :deep(pre) { background: rgba(0,0,0,0.04); padding: 16px; border-radius: 8px; overflow-x: auto; margin-bottom: 0.8em; }
.oc-body :deep(blockquote) { border-left: 3px solid rgba(0,0,0,0.15); padding-left: 16px; margin: 0.8em 0; color: var(--color-secondary); }
</style>
