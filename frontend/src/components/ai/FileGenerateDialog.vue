<template>
  <Teleport to="body">
    <Transition name="overlay-fade">
      <div v-if="isOpen" class="dialog-overlay" @click.self="handleClose">
        <div class="dialog-container">
          <!-- Header -->
          <div class="dialog-header">
            <h2 class="dialog-title">从文件生成知识点</h2>
            <button class="dialog-close" @click="handleClose">✕</button>
          </div>

          <!-- Content -->
          <div class="dialog-content">
            <!-- Step 1: Upload -->
            <template v-if="currentStep === 'upload'">
              <!-- Resume banner -->
              <div v-if="showResumeChoice" class="resume-banner">
                <div class="resume-info">
                  <span class="resume-icon">↩</span>
                  <span>检测到未完成的对话，是否继续？</span>
                </div>
                <div class="resume-actions">
                  <button class="step-btn step-btn-primary" @click="handleResume">
                    继续上次对话
                  </button>
                  <button class="step-btn step-btn-secondary" @click="handleStartFresh">
                    重新开始
                  </button>
                </div>
              </div>

              <FileUploadArea
                v-else
                @uploaded="handleFileUploaded"
                @removed="handleFileRemoved"
              />
              <div v-if="uploadedFile" class="step-actions">
                <button
                  class="step-btn step-btn-primary"
                  :disabled="isBusy"
                  @click="handleExtractKnowledge"
                >
                  {{ isBusy ? '提取中...' : '提取知识点' }}
                </button>
              </div>
            </template>

            <!-- Step 2: Select outline (if needed) -->
            <template v-else-if="currentStep === 'selecting'">
              <KnowledgeOutline
                v-if="extractionResult"
                :groups="extractionResult.groups"
                :total-count="extractionResult.total_count"
                @confirm="handleOutlineConfirm"
              />
            </template>

            <!-- Step 3: Conversation -->
            <template v-else-if="currentStep === 'conversing'">
              <ConversationView
                ref="conversationView"
                :session-id="sessionId || ''"
                :current-index="conversationState.currentIndex"
                :total="conversationState.total"
                :current-kp-title="conversationState.currentKpTitle"
                :current-kp-data="currentKpData"
                :is-completed="conversationState.isCompleted"
                @answer="handleUserAnswer"
                @skip="handleSkip"
                @example-feedback="handleExampleFeedback"
              />
            </template>

            <!-- Step 4: Completed -->
            <template v-else-if="currentStep === 'completed'">
              <div class="completion-message">
                <div class="completion-icon">🎉</div>
                <div class="completion-text">
                  <div class="completion-title">完成！</div>
                  <div class="completion-subtitle">
                    已生成 {{ conversationState.total }} 个知识点的内容
                  </div>
                </div>
                <button class="step-btn step-btn-primary" @click="handleClose">
                  关闭
                </button>
              </div>
            </template>

            <!-- Error message -->
            <div v-if="errorMessage" class="dialog-error">{{ errorMessage }}</div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useNodeStore } from '../../stores/nodeStore';
import { useFileGenerate } from '../../composables/useFileGenerate';
import type { KnowledgePoint, UploadedFile } from '../../composables/useFileGenerate';
import FileUploadArea from './FileUploadArea.vue';
import KnowledgeOutline from './KnowledgeOutline.vue';
import ConversationView from './ConversationView.vue';

const nodeStore = useNodeStore();
const { activeNode } = storeToRefs(nodeStore);

const {
  isOpen,
  isBusy,
  errorMessage,
  uploadedFile,
  extractionResult,
  sessionId,
  conversationState,
  needsOutlineSelection,
  hasResumableSession,
  extractKnowledgePoints,
  startConversation,
  sendAnswer,
  sendExampleFeedback,
  resumeConversation,
  abandonSession,
  insertGeneratedContent,
} = useFileGenerate();

type Step = 'upload' | 'extracting' | 'selecting' | 'conversing' | 'completed';
const currentStep = ref<Step>('upload');
const conversationView = ref<InstanceType<typeof ConversationView> | null>(null);
const selectedKnowledgePoints = ref<KnowledgePoint[]>([]);
const showResumeChoice = ref(false);

const currentKpData = computed(() => {
  const idx = conversationState.value.currentIndex;
  return selectedKnowledgePoints.value[idx] || null;
});

function handleFileUploaded(file: UploadedFile) {
  uploadedFile.value = file;
  errorMessage.value = '';
}

function handleFileRemoved() {
  uploadedFile.value = null;
  errorMessage.value = '';
}

async function handleExtractKnowledge() {
  if (!uploadedFile.value) return;

  try {
    currentStep.value = 'extracting';
    await extractKnowledgePoints(uploadedFile.value.file_id);

    // Check if outline selection is needed
    if (needsOutlineSelection.value) {
      currentStep.value = 'selecting';
    } else {
      // Start conversation directly with all knowledge points
      const allKnowledgePoints = extractionResult.value?.groups.flatMap(g => g.knowledge_points) || [];
      await startConversationWithPoints(allKnowledgePoints);
    }
  } catch (error) {
    currentStep.value = 'upload';
    console.error('Extract knowledge failed:', error);
  }
}

function handleOutlineConfirm(knowledgePoints: KnowledgePoint[]) {
  selectedKnowledgePoints.value = knowledgePoints;
  startConversationWithPoints(knowledgePoints);
}

async function startConversationWithPoints(knowledgePoints: KnowledgePoint[]) {
  if (!activeNode.value || !uploadedFile.value) return;

  try {
    const result = await startConversation(
      activeNode.value.id,
      uploadedFile.value.file_id,
      knowledgePoints
    );

    currentStep.value = 'conversing';

    // Add first question to conversation view
    setTimeout(() => {
      conversationView.value?.addAiMessage(result.question);
    }, 100);
  } catch (error) {
    console.error('Start conversation failed:', error);
    currentStep.value = 'upload';
  }
}

async function handleResume() {
  const checkpoint = loadCheckpointRaw();
  if (!checkpoint || !checkpoint.sessionId) {
    handleStartFresh();
    return;
  }

  try {
    const result = await resumeConversation(checkpoint.sessionId);

    // Restore dialog state
    uploadedFile.value = checkpoint.file;
    extractionResult.value = checkpoint.extractionResult;
    selectedKnowledgePoints.value = checkpoint.selectedKnowledgePoints;
    currentStep.value = 'conversing';

    // Load message history into ConversationView
    await nextTick();
    if (result.messages && result.messages.length > 0) {
      conversationView.value?.loadHistory(
        result.messages.map((m: any) => ({
          role: m.role,
          content: m.content,
          generatedContent: m.metadata?.generated_content || m.generatedContent,
        }))
      );
    }
    // Restore example preview if pending
    if (result.pending_example) {
      conversationView.value?.showExample(
        result.pending_example.example_content,
        result.pending_example.explanation || ''
      );
    }
  } catch (err) {
    console.error('Resume failed:', err);
    handleStartFresh();
    errorMessage.value = '之前的对话已过期，请重新开始。';
  }
}

function handleStartFresh() {
  showResumeChoice.value = false;
  abandonSession();
  currentStep.value = 'upload';
  errorMessage.value = '';
}

function loadCheckpointRaw(): { sessionId: string; file: UploadedFile; extractionResult: any; selectedKnowledgePoints: KnowledgePoint[] } | null {
  try {
    const raw = localStorage.getItem('acacia_conversation_checkpoint_v1');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function handleUserAnswer(answer: string) {
  if (!conversationView.value) return;

  try {
    const result = await sendAnswer(answer, false);

    if (result.action === 'example_preview') {
      // Show example preview for procedure-type knowledge point
      conversationView.value.showExample(result.example_content, result.example_explanation || '');
      conversationView.value.addAiMessage(result.ai_message);
    } else if (result.action === 'correct_self') {
      // AI corrected itself — show the correction prominently
      conversationView.value.addAiMessage(result.ai_message, undefined, 'correct_self');
    } else if (result.action === 'admit_uncertainty') {
      // AI admitted it doesn't know — show gently
      conversationView.value.addAiMessage(result.ai_message, undefined, 'admit_uncertainty');
    } else if (result.action === 'follow_up' || result.action === 'hint') {
      conversationView.value.addAiMessage(result.ai_message);
    } else if (result.action === 'show_source') {
      conversationView.value.addAiMessage(result.ai_message);
    } else if (result.action === 'accept_and_next') {
      conversationView.value.addAiMessage(result.ai_message, result.generated_content);
      if (result.next_question) {
        conversationView.value.addAiMessage(result.next_question);
      }
    } else if (result.action === 'completed') {
      conversationView.value.addAiMessage(result.ai_message, result.generated_content);
      insertGeneratedContent(result.total_content);
      currentStep.value = 'completed';
    }

    // Legacy handling for backward compatibility
    if (result.generated_content && result.action !== 'example_preview') {
      insertGeneratedContent(result.generated_content);
    }

    // Check if completed (legacy)
    if (conversationState.value.isCompleted) {
      setTimeout(() => {
        currentStep.value = 'completed';
      }, 1000);
    }
  } catch (error) {
    console.error('Send answer failed:', error);
    conversationView.value.resetThinking('出错了，请重试。如果多次失败，请关闭对话框后重新开始。');
  }
}

async function handleSkip() {
  try {
    const result = await sendAnswer('', true);

    // Add AI response
    conversationView.value?.addAiMessage(result.ai_message);

    // If there's a next question, add it
    if (result.next_question) {
      setTimeout(() => {
        conversationView.value?.addAiMessage(result.next_question);
      }, 500);
    }

    // Check if completed
    if (result.action === 'completed' || conversationState.value.isCompleted) {
      setTimeout(() => {
        currentStep.value = 'completed';
      }, 1000);
    }
  } catch (error) {
    console.error('Skip failed:', error);
    conversationView.value?.resetThinking('跳过失败，请重试。');
  }
}

async function handleExampleFeedback(payload: { action: string; feedback?: string }) {
  if (!conversationView.value) return;

  try {
    const result = await sendExampleFeedback(payload.action as 'accept' | 'regenerate' | 'skip', payload.feedback);

    if (result.action === 'example_preview') {
      // Show new example (regenerated)
      conversationView.value.showExample(result.example_content, result.example_explanation || '');
      conversationView.value.addAiMessage(result.ai_message);
    } else if (result.action === 'regeneration_limit') {
      // Show regeneration limit message
      conversationView.value.showExample(result.example_content, result.example_explanation || '');
      conversationView.value.addAiMessage(result.ai_message);
    } else if (result.action === 'next_question') {
      // Move to next question
      conversationView.value.addAiMessage(result.ai_message);
      if (result.next_question) {
        conversationView.value.addAiMessage(result.next_question);
      }
    } else if (result.action === 'completed') {
      // All knowledge points completed
      conversationView.value.addAiMessage(result.ai_message);
      insertGeneratedContent(result.total_content);
      currentStep.value = 'completed';
    }
  } catch (error) {
    console.error('Example feedback failed:', error);
    conversationView.value.resetThinking('反馈处理失败，请重试。');
  }
}

function handleClose() {
  if (currentStep.value === 'conversing' && !conversationState.value.isCompleted) {
    if (!confirm('对话尚未完成，确定要关闭吗？可以稍后继续。')) {
      return;
    }
  }

  isOpen.value = false;
  // Only reset state for completed conversations
  if (conversationState.value.isCompleted) {
    currentStep.value = 'upload';
    uploadedFile.value = null;
    extractionResult.value = null;
    selectedKnowledgePoints.value = [];
    errorMessage.value = '';
  }
}

// Reset step when dialog opens
watch(isOpen, (newValue) => {
  if (newValue) {
    if (hasResumableSession.value) {
      showResumeChoice.value = true;
    } else {
      currentStep.value = 'upload';
      showResumeChoice.value = false;
    }
  }
});
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.36);
  backdrop-filter: blur(4px);
}

.dialog-container {
  width: min(800px, 90vw);
  max-height: 85vh;
  border-radius: 24px;
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(16px);
  display: flex;
  flex-direction: column;
  color: var(--color-primary);
  box-shadow:
    8px 8px 24px rgba(49, 78, 151, 0.12),
    -4px -4px 12px rgba(255, 255, 255, 0.4);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 28px;
  border-bottom: 1px solid var(--color-glass-border);
}

.dialog-title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: var(--color-primary);
}

.dialog-close {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.12);
  color: var(--color-primary);
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.dialog-close:hover {
  background: rgba(255, 80, 80, 0.2);
  border-color: rgba(255, 80, 80, 0.4);
}

.dialog-content {
  flex: 1;
  overflow-y: auto;
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.step-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.step-btn {
  padding: 12px 24px;
  border-radius: 14px;
  border: 1px solid var(--color-glass-border);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.step-btn-primary {
  background: rgba(102, 255, 229, 0.28);
  color: var(--color-primary);
}

.step-btn-primary:hover:not(:disabled) {
  background: rgba(102, 255, 229, 0.44);
}

.step-btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.completion-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  padding: 40px 20px;
  text-align: center;
}

.completion-icon {
  font-size: 64px;
}

.completion-text {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.completion-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--color-primary);
}

.completion-subtitle {
  font-size: 16px;
  color: var(--color-primary);
  opacity: 0.7;
}

.dialog-error {
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(255, 80, 80, 0.12);
  color: #c0392b;
  font-size: 14px;
  text-align: center;
}

.resume-banner {
  padding: 20px;
  border-radius: 16px;
  background: rgba(102, 255, 229, 0.08);
  border: 1px solid rgba(102, 255, 229, 0.2);
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
  text-align: center;
}

.resume-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 500;
  color: var(--color-primary);
}

.resume-icon {
  font-size: 20px;
}

.resume-actions {
  display: flex;
  gap: 12px;
}

.step-btn-secondary {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-primary);
}

.step-btn-secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.16);
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
