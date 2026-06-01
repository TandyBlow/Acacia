<template>
  <div class="streaming-panel">
    <div class="stream-header">
      <span class="stream-stage-name">{{ stageLabel }}</span>
      <span class="stream-elapsed">{{ elapsedDisplay }}</span>
    </div>
    <div class="stream-stage-detail">{{ stageDetail }}</div>
    <div class="stream-bar-track">
      <div class="stream-bar-fill" :style="{ width: percent + '%' }" :class="{ done: isDone }"></div>
    </div>
    <div class="stream-stats">
      <span v-if="pageCount > 0">{{ $t('pipeline.pages', { n: pageCount }) }}</span>
      <span v-if="totalChars > 0">{{ $t('pipeline.chars', { n: totalChars }) }}</span>
      <span v-if="formulaCount > 0">{{ $t('pipeline.formulas', { n: formulaCount }) }}</span>
    </div>
    <div class="stream-timeline" v-if="timeline.length > 0">
      <div class="tl-row" v-for="(entry, i) in timeline" :key="i">
        <span class="tl-stage">{{ entry.label }}</span>
        <span class="tl-time">{{ entry.duration }}</span>
        <span class="tl-detail">{{ entry.detail }}</span>
      </div>
    </div>
    <button class="cancel-btn" @click="$emit('cancel')" v-if="!isDone">
      {{ $t('editor.cancel') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  fileId: string;
}>();

const emit = defineEmits<{
  complete: [markdown: string];
  error: [message: string];
  cancel: [];
}>();

const { t } = useI18n();

// State
const currentStage = ref('');
const stageDetail = ref('');
const percent = ref(0);
const pageCount = ref(0);
const totalChars = ref(0);
const formulaCount = ref(0);
const isDone = ref(false);
const streamingMarkdown = ref('');
const hasEmittedComplete = ref(false);

const timeline = ref<{ label: string; duration: string; detail: string }[]>([]);

// Elapsed timer
const startTime = ref(0);
const elapsedMs = ref(0);
let elapsedTimer: ReturnType<typeof setInterval> | null = null;
const elapsedDisplay = computed(() => {
  const s = Math.floor(elapsedMs.value / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
});

// Stage label mapping
const stageLabels: Record<string, string> = {
  extract: 'pipeline.stage.extract',
  ocr: 'pipeline.stage.ocr',
  spans: 'pipeline.stage.spans',
  formula: 'pipeline.stage.formula',
  metadata: 'pipeline.stage.metadata',
  segment: 'pipeline.stage.segment',
  annotate: 'pipeline.stage.annotate',
  merge: 'pipeline.stage.merge',
  review: 'pipeline.stage.review',
};

const stageLabel = computed(() => {
  if (!currentStage.value) return t('pipeline.starting');
  return t(stageLabels[currentStage.value] || currentStage.value);
});

// SSE connection
let abortController: AbortController | null = null;

function connect() {
  const token = localStorage.getItem('acacia_backend_token');
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:7860';
  const url = `${backendUrl}/extract-stream/${props.fileId}`;

  abortController = new AbortController();
  startTime.value = Date.now();
  elapsedTimer = setInterval(() => {
    elapsedMs.value = Date.now() - startTime.value;
  }, 200);

  fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: abortController.signal,
  })
    .then((response) => {
      if (!response.ok) {
        emit('error', `HTTP ${response.status}`);
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) {
        emit('error', 'Response body is not readable');
        return;
      }
      const decoder = new TextDecoder();
      let buffer = '';

      function processChunk() {
        reader!.read().then(({ done, value }) => {
          if (done) return;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = 'message';
          let dataBuffer = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              dataBuffer = line.slice(6);
              try {
                const data = JSON.parse(dataBuffer);
                handleEvent(currentEvent, data);
              } catch {
                // Skip unparseable lines
              }
              currentEvent = 'message';
            }
          }
          processChunk();
        }).catch(() => {
          // Reader cancelled or errored
        });
      }
      processChunk();
    })
    .catch((err) => {
      if (err.name === 'AbortError') return;
      emit('error', err.message);
    });
}

function handleEvent(event: string, data: Record<string, any>) {
  switch (event) {
    case 'pipeline_start':
      pageCount.value = data.page_count || 0;
      totalChars.value = data.total_chars || 0;
      break;

    case 'stage_progress':
      currentStage.value = data.stage;
      if (data.detail) stageDetail.value = data.detail;
      if (data.percent > 0) percent.value = data.percent;
      if (data.stageMs > 0 || data.totalMs > 0) {
        const dur = data.stageMs > 0 ? `${(data.stageMs / 1000).toFixed(1)}s` : '';
        timeline.value.push({
          label: t(stageLabels[data.stage] || data.stage),
          duration: dur,
          detail: data.detail || '',
        });
      }
      break;

    case 'ocr_progress':
      stageDetail.value = `OCR page ${data.page}/${data.total_pages}`;
      break;

    case 'formula_progress':
      formulaCount.value = data.formulas_found || 0;
      break;

    case 'annotation_progress':
      stageDetail.value = `Sentences: ${data.sentences_done}/${data.total_sentences}`;
      break;

    case 'sentence_result':
      streamingMarkdown.value += data.markdown_fragment || '';
      break;

    case 'review_issue':
      // Just note it in timeline
      timeline.value.push({
        label: t('pipeline.stage.review'),
        duration: '',
        detail: `${data.issue} [${data.status}]`,
      });
      break;

    case 'pipeline_complete':
      isDone.value = true;
      percent.value = 100;
      currentStage.value = '';
      stageDetail.value = t('pipeline.complete');
      void completePipeline(typeof data.final_markdown === 'string' ? data.final_markdown : '');
      break;

    case 'pipeline_error':
      if (!data.recoverable) {
        isDone.value = true;
        currentStage.value = '';
        stageDetail.value = data.message;
        percent.value = 0;
        disconnect();
        emit('error', data.message || t('pipeline.failed'));
      }
      break;
  }
}

function disconnect() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

async function fetchFormattedResult(): Promise<string | null> {
  const token = localStorage.getItem('acacia_backend_token');
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:7860';

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const resp = await fetch(`${backendUrl}/file-content/${props.fileId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        if (typeof data.full_text === 'string') {
          return data.full_text;
        }
      }
    } catch {
      // If fetch fails, fall back to the SSE payload or accumulated fragments.
    }

    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  return null;
}

async function completePipeline(finalMarkdown: string): Promise<void> {
  if (hasEmittedComplete.value) return;
  hasEmittedComplete.value = true;

  const formatted = await fetchFormattedResult();
  const markdown = formatted ?? finalMarkdown ?? streamingMarkdown.value;
  streamingMarkdown.value = markdown;
  disconnect();
  emit('complete', markdown);
}

onMounted(() => {
  connect();
});

onUnmounted(() => {
  disconnect();
});
</script>

<style scoped>
.streaming-panel {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.stream-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stream-stage-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-primary);
}

.stream-elapsed {
  font-size: 13px;
  color: var(--color-primary);
  opacity: 0.5;
  font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace;
}

.stream-stage-detail {
  font-size: 14px;
  color: var(--color-primary);
  opacity: 0.7;
  min-height: 20px;
}

.stream-bar-track {
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: hidden;
}

.stream-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary), #4ade80);
  border-radius: 2px;
  transition: width 0.3s ease;
  width: 0%;
}

.stream-bar-fill.done {
  background: #4ade80;
}

.stream-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 13px;
  color: var(--color-primary);
  opacity: 0.6;
}

.stream-timeline {
  max-height: 140px;
  overflow-y: auto;
  font-size: 12px;
  font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace;
}

.stream-timeline::-webkit-scrollbar {
  width: 4px;
}

.stream-timeline::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}

.tl-row {
  display: flex;
  gap: 8px;
  padding: 3px 0;
  color: rgba(255, 255, 255, 0.4);
}

.tl-stage {
  color: rgba(255, 255, 255, 0.6);
  min-width: 80px;
  flex-shrink: 0;
}

.tl-time {
  color: var(--color-primary);
  opacity: 0.7;
  min-width: 45px;
  text-align: right;
  flex-shrink: 0;
}

.tl-detail {
  color: rgba(255, 255, 255, 0.35);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cancel-btn {
  align-self: center;
  padding: 6px 16px;
  border-radius: 8px;
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-primary);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s;
}

.cancel-btn:hover {
  background: rgba(255, 80, 80, 0.15);
  border-color: rgba(255, 80, 80, 0.3);
}
</style>
