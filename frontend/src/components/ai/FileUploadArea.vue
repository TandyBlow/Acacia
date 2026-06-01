<template>
  <div class="upload-area">
    <div
      class="upload-zone"
      :class="{ 'drag-over': isDragOver, 'uploading': isUploading }"
      @drop.prevent="handleDrop"
      @dragover.prevent="isDragOver = true"
      @dragleave.prevent="isDragOver = false"
      @click="triggerFileInput"
    >
      <input
        ref="fileInput"
        type="file"
        accept=".txt,.md,.pdf,.docx,.ipynb,.py"
        @change="handleFileSelect"
        style="display: none"
      />

      <template v-if="!isUploading && !isProcessing && !uploadedFile">
        <div class="upload-icon">📄</div>
        <div class="upload-text">
          <div class="upload-primary">{{ $t('upload.clickOrDrag') }}</div>
          <div class="upload-secondary">{{ $t('upload.supportedFormats') }}</div>
        </div>
      </template>

      <template v-else-if="isUploading">
        <div class="upload-icon">⏳</div>
        <div class="upload-text">
          <div class="upload-primary">{{ $t('upload.uploading') }}</div>
          <div class="upload-secondary">{{ uploadProgress }}%</div>
        </div>
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: uploadProgress + '%' }"></div>
        </div>
      </template>

      <template v-else-if="isProcessing">
        <StreamingExtractPanel
          :file-id="processingFileId"
          @complete="onPipelineComplete"
          @error="onPipelineError"
          @cancel="onPipelineCancel"
        />
      </template>

      <template v-else-if="uploadedFile">
        <div class="upload-icon">✓</div>
        <div class="upload-text">
          <div class="upload-primary">{{ uploadedFile.filename }}</div>
          <div class="upload-secondary">
            {{ formatFileSize(uploadedFile.size) }} · {{ $t('upload.chars', { n: uploadedFile.text_length }) }}
            <span v-if="uploadedFile.ocr_status === 'pending'" class="ocr-badge ocr-badge-pending">OCR...</span>
            <span v-else-if="uploadedFile.ocr_applied" class="ocr-badge">OCR</span>
          </div>
          <div v-if="uploadedFile.text_length === 0 && uploadedFile.ocr_status === 'pending'" class="upload-warning">
            {{ $t('upload.ocrPending') }}
          </div>
          <div v-else-if="uploadedFile.text_length === 0" class="upload-warning">
            {{ $t('upload.emptyWarning') }}
          </div>
        </div>
        <button class="remove-btn" @click.stop="removeFile">✕</button>
      </template>
    </div>

    <div v-if="errorMessage" class="upload-error">{{ errorMessage }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import StreamingExtractPanel from './StreamingExtractPanel.vue';

interface UploadedFile {
  file_id: string;
  filename: string;
  size: number;
  extension: string;
  text_length: number;
  text_preview: string;
  formatted_text?: string;
  ocr_applied?: boolean;
  ocr_reason?: string | null;
  ocr_status?: string;
  total_pages?: number;
}

const emit = defineEmits<{
  uploaded: [file: UploadedFile];
  removed: [];
}>();

const { t } = useI18n();

const fileInput = ref<HTMLInputElement | null>(null);
const isDragOver = ref(false);
const isUploading = ref(false);
const isProcessing = ref(false);
const uploadProgress = ref(0);
const uploadedFile = ref<UploadedFile | null>(null);
const errorMessage = ref('');
const processingFileId = ref('');
const pipelineMarkdown = ref('');
const pendingFileMeta = ref<{ filename: string; size: number; extension: string } | null>(null);

function shouldPreserveSource(extension: string): boolean {
  return ['.md', '.markdown'].includes(extension.toLowerCase());
}

async function fetchUploadedContent(fileId: string): Promise<string> {
  const token = localStorage.getItem('acacia_backend_token');
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:7860';

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const resp = await fetch(`${backendUrl}/file-content/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.ok) {
      const data = await resp.json();
      return typeof data.full_text === 'string' ? data.full_text : '';
    }
    if (attempt < 19) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  throw new Error(t('upload.parseFailed'));
}

function triggerFileInput() {
  if (!isUploading.value && !isProcessing.value && !uploadedFile.value) {
    fileInput.value?.click();
  }
}

function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) {
    uploadFile(file);
  }
}

function handleDrop(event: DragEvent) {
  isDragOver.value = false;
  const file = event.dataTransfer?.files[0];
  if (file) {
    uploadFile(file);
  }
}

async function uploadFile(file: File) {
  errorMessage.value = '';

  // Validate file size
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB
  if (file.size > MAX_SIZE) {
    errorMessage.value = t('upload.sizeExceeded');
    return;
  }

  // Validate file extension
  const validExtensions = ['.txt', '.md', '.pdf', '.docx', '.ipynb', '.py'];
  const fileExt = '.' + file.name.split('.').pop()?.toLowerCase();
  if (!validExtensions.includes(fileExt)) {
    errorMessage.value = t('upload.unsupportedType', { ext: fileExt });
    return;
  }

  isUploading.value = true;
  uploadProgress.value = 0;

  // Save file metadata for pipeline completion
  pendingFileMeta.value = {
    filename: file.name,
    size: file.size,
    extension: fileExt,
  };

  const token = localStorage.getItem('acacia_backend_token');
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:7860';

  // Phase 1: upload with real progress via XHR
  let initialResponse: any;
  try {
    initialResponse = await new Promise<any>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append('file', file);

      xhr.upload.onprogress = (e: ProgressEvent) => {
        if (e.lengthComputable && e.total > 0) {
          uploadProgress.value = Math.round((e.loaded / e.total) * 100);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new Error(t('upload.uploadFailed')));
          }
        } else {
          let detail = t('upload.uploadFailed');
          try {
            const err = JSON.parse(xhr.responseText);
            detail = err.detail || t('upload.uploadFailed');
          } catch {
            console.error('[FileUploadArea] failed to parse error response');
          }
          if (xhr.status === 413) detail = t('upload.sizeLimitExceeded');
          reject(new Error(detail));
        }
      };

      xhr.onerror = () => reject(new Error(t('upload.uploadFailed')));

      xhr.open('POST', `${backendUrl}/upload-file`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    });
  } catch (err) {
    isUploading.value = false;
    errorMessage.value = err instanceof Error ? err.message : t('upload.uploadFailed');
    return;
  }

  isUploading.value = false;
  uploadProgress.value = 0;

  if (shouldPreserveSource(fileExt)) {
    try {
      const markdown = await fetchUploadedContent(initialResponse.file_id);
      onPipelineComplete(markdown);
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : t('upload.parseFailed');
    }
    return;
  }

  // Phase 2: start streaming markdown pipeline
  isProcessing.value = true;
  processingFileId.value = initialResponse.file_id;
  pipelineMarkdown.value = '';

  // Pipeline result is handled by onPipelineComplete/onPipelineError/onPipelineCancel
}

function onPipelineComplete(markdown: string) {
  pipelineMarkdown.value = markdown;
  isProcessing.value = false;

  const meta = pendingFileMeta.value;
  const result: UploadedFile = {
    file_id: processingFileId.value,
    filename: meta?.filename || '',
    size: meta?.size || 0,
    extension: meta?.extension || '',
    text_length: markdown.length,
    text_preview: markdown.slice(0, 200) + (markdown.length > 200 ? '...' : ''),
    formatted_text: markdown,
  };
  pendingFileMeta.value = null;
  uploadedFile.value = result;
  emit('uploaded', result);
}

function onPipelineError(message: string) {
  isProcessing.value = false;
  errorMessage.value = message;
}

function onPipelineCancel() {
  isProcessing.value = false;
  // Reset to pre-upload state
  if (fileInput.value) {
    fileInput.value.value = '';
  }
}

function removeFile() {
  uploadedFile.value = null;
  pendingFileMeta.value = null;
  pipelineMarkdown.value = '';
  errorMessage.value = '';
  if (fileInput.value) {
    fileInput.value.value = '';
  }
  emit('removed');
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
</script>

<style scoped>
.upload-area {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.upload-zone {
  position: relative;
  width: 100%;
  min-height: 180px;
  border: 2px dashed var(--color-glass-border);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.04);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 24px;
}

.upload-zone:hover:not(.uploading) {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(102, 255, 229, 0.4);
}

.upload-zone.drag-over {
  background: rgba(102, 255, 229, 0.12);
  border-color: rgba(102, 255, 229, 0.6);
  transform: scale(1.02);
}

.upload-zone.uploading {
  cursor: default;
  opacity: 0.7;
}

.upload-icon {
  font-size: 48px;
  opacity: 0.8;
}

.upload-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
}

.upload-primary {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-primary);
}

.upload-secondary {
  font-size: 14px;
  color: var(--color-primary);
  opacity: 0.6;
}

.remove-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.12);
  color: var(--color-primary);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.remove-btn:hover {
  background: rgba(255, 80, 80, 0.2);
  border-color: rgba(255, 80, 80, 0.4);
}

.upload-error {
  padding: 10px 14px;
  border-radius: 12px;
  background: rgba(255, 80, 80, 0.12);
  color: #c0392b;
  font-size: 14px;
  text-align: center;
}

.ocr-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(102, 255, 229, 0.2);
  color: #66ffe5;
  font-size: 11px;
  font-weight: 600;
  vertical-align: middle;
}

.ocr-badge-pending {
  background: rgba(255, 180, 50, 0.2);
  color: #e6a23c;
  animation: ocr-pulse 1.5s ease-in-out infinite;
}

@keyframes ocr-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.upload-warning {
  margin-top: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(255, 180, 50, 0.15);
  color: #e6a23c;
  font-size: 12px;
  font-weight: 500;
}

.progress-track {
  width: 80%;
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--color-primary, #66ffe5);
  border-radius: 2px;
  transition: width 0.15s linear;
}

.progress-indeterminate {
  width: 30%;
  animation: progress-slide 1.2s ease-in-out infinite;
}

@keyframes progress-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(433%); }
}
</style>
