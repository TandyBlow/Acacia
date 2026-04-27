<template>
  <!-- Popup overlay -->
  <Teleport to="body">
    <Transition name="overlay-fade">
      <div v-if="isOpen" class="ai-overlay" @click.self="close">
        <div class="ai-popup">
          <!-- Analysis mode -->
          <template v-if="isAnalysis">
            <h2 class="ai-title">AI 笔记分析</h2>

            <template v-if="isBusy">
              <div class="ai-loading">分析中...</div>
            </template>

            <template v-else-if="errorMessage">
              <div class="ai-error">{{ errorMessage }}</div>
              <div class="ai-actions">
                <button class="ai-btn ai-btn-cancel" @click="close">关闭</button>
              </div>
            </template>

            <template v-else-if="analyzeResult">
              <div class="ai-success">
                成功提取了 {{ createdCount }} 个子知识点！
              </div>
              <div class="ai-actions">
                <button class="ai-btn ai-btn-submit" @click="close">好的</button>
              </div>
            </template>
          </template>

          <!-- Generate mode -->
          <template v-else>
            <h2 class="ai-title">AI 知识点生成</h2>

            <textarea
              v-model="inputText"
              class="ai-textarea"
              placeholder="输入零散的词、句子或描述..."
              rows="4"
              :disabled="isBusy"
            />

            <div v-if="errorMessage" class="ai-error">{{ errorMessage }}</div>

            <div v-if="result" class="ai-success">
              成功生成 {{ generatedCount }} 个知识点！
            </div>

            <div class="ai-actions">
              <button type="button" class="ai-btn ai-btn-cancel" @click="close">
                取消
              </button>
              <button
                type="button"
                class="ai-btn ai-btn-submit"
                :disabled="!canSubmit || isBusy"
                @click="submit"
              >
                {{ isBusy ? '生成中...' : '生成' }}
              </button>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useNodeStore } from '../../stores/nodeStore';
import { useAiGenerate } from '../../composables/useAiGenerate';

const nodeStore = useNodeStore();
const { activeNode } = storeToRefs(nodeStore);
const { isBusy, errorMessage, analyzeResult, generate, analyzeNode, requestOpen, analysisRequest } = useAiGenerate();

const isOpen = ref(false);
const inputText = ref('');
const result = ref<Awaited<ReturnType<typeof generate>> | null>(null);
const isAnalysis = ref(false);

watch(requestOpen, (v) => {
  if (v) {
    isAnalysis.value = false;
    isOpen.value = true;
    requestOpen.value = false;
  }
});

watch(analysisRequest, async (v) => {
  if (v) {
    isOpen.value = true;
    isAnalysis.value = true;
    analysisRequest.value = false;
    result.value = null;
    if (activeNode.value) {
      await analyzeNode(activeNode.value.id);
      if (analyzeResult.value && !errorMessage.value) {
        nodeStore.refreshTree();
        setTimeout(close, 3000);
      }
    }
  }
});

const canSubmit = computed(() => inputText.value.trim().length > 0);

const createdCount = computed(() => {
  if (!analyzeResult.value?.created) return 0;
  return analyzeResult.value.created.filter((n) => !n.skipped).length;
});

const generatedCount = computed(() => {
  if (!result.value?.nodes) return 0;
  return result.value.nodes.filter((n) => !n.skipped).length;
});

async function submit() {
  if (!canSubmit.value) return;
  result.value = await generate(inputText.value.trim());
  if (result.value) {
    nodeStore.refreshTree();
    setTimeout(close, 2000);
  }
}

function close() {
  isOpen.value = false;
  inputText.value = '';
  result.value = null;
  isAnalysis.value = false;
}
</script>

<style scoped>
.ai-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.36);
  backdrop-filter: blur(4px);
}

.ai-popup {
  width: min(460px, 90vw);
  padding: 28px;
  border-radius: 24px;
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(16px);
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: var(--color-primary);
  box-shadow:
    8px 8px 24px rgba(49, 78, 151, 0.12),
    -4px -4px 12px rgba(255, 255, 255, 0.4);
}

.ai-title {
  margin: 0;
  font-size: 22px;
  line-height: 1.3;
}

.ai-loading {
  flex: 1;
  display: grid;
  place-items: center;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-primary);
  opacity: 0.7;
  padding: 20px 0;
}

.ai-textarea {
  width: 100%;
  border: 1px solid var(--color-glass-border);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.14);
  color: var(--color-primary);
  padding: 16px 18px;
  font-size: 16px;
  line-height: 1.5;
  resize: vertical;
  font-family: inherit;
}

.ai-textarea:focus {
  outline: 2px solid rgba(102, 255, 229, 0.35);
}

.ai-textarea:disabled {
  opacity: 0.6;
}

.ai-error {
  padding: 10px 14px;
  border-radius: 12px;
  background: rgba(255, 80, 80, 0.12);
  color: #c0392b;
  font-size: 14px;
}

.ai-success {
  padding: 10px 14px;
  border-radius: 12px;
  background: rgba(46, 204, 113, 0.14);
  color: #1e8449;
  font-size: 14px;
  font-weight: 600;
}

.ai-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.ai-btn {
  padding: 10px 22px;
  border-radius: 14px;
  border: 1px solid var(--color-glass-border);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.ai-btn-cancel {
  background: rgba(255, 255, 255, 0.18);
  color: var(--color-primary);
}

.ai-btn-cancel:hover {
  background: rgba(255, 255, 255, 0.32);
}

.ai-btn-submit {
  background: rgba(102, 255, 229, 0.28);
  color: var(--color-primary);
}

.ai-btn-submit:hover:not(:disabled) {
  background: rgba(102, 255, 229, 0.44);
}

.ai-btn-submit:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.overlay-fade-enter-active,
.overlay-fade-leave-active {
  transition: opacity 200ms ease;
}

.overlay-fade-enter-from,
.overlay-fade-leave-to {
  opacity: 0;
}
</style>
