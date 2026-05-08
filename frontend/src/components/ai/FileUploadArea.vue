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
        accept=".txt,.md,.pdf"
        @change="handleFileSelect"
        style="display: none"
      />

      <template v-if="!isUploading && !uploadedFile">
        <div class="upload-icon">📄</div>
        <div class="upload-text">
          <div class="upload-primary">点击或拖拽文件到此处</div>
          <div class="upload-secondary">支持 .txt, .md, .pdf 文件（最大10MB）</div>
        </div>
      </template>

      <template v-else-if="isUploading">
        <div class="upload-icon">⏳</div>
        <div class="upload-text">
          <div class="upload-primary">上传中...</div>
          <div class="upload-secondary">{{ uploadProgress }}%</div>
        </div>
      </template>

      <template v-else-if="uploadedFile">
        <div class="upload-icon">✓</div>
        <div class="upload-text">
          <div class="upload-primary">{{ uploadedFile.filename }}</div>
          <div class="upload-secondary">
            {{ formatFileSize(uploadedFile.size) }} · {{ uploadedFile.text_length }} 字符
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

interface UploadedFile {
  file_id: string;
  filename: string;
  size: number;
  extension: string;
  text_length: number;
  text_preview: string;
}

const emit = defineEmits<{
  uploaded: [file: UploadedFile];
  removed: [];
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const isDragOver = ref(false);
const isUploading = ref(false);
const uploadProgress = ref(0);
const uploadedFile = ref<UploadedFile | null>(null);
const errorMessage = ref('');

function triggerFileInput() {
  if (!isUploading.value && !uploadedFile.value) {
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
    errorMessage.value = '文件大小超过10MB限制';
    return;
  }

  // Validate file extension
  const validExtensions = ['.txt', '.md', '.pdf'];
  const fileExt = '.' + file.name.split('.').pop()?.toLowerCase();
  if (!validExtensions.includes(fileExt)) {
    errorMessage.value = `不支持的文件类型：${fileExt}`;
    return;
  }

  isUploading.value = true;
  uploadProgress.value = 0;

  try {
    const formData = new FormData();
    formData.append('file', file);

    const token = localStorage.getItem('acacia_backend_token');
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:7860';

    // Simulate progress (since we can't track real upload progress easily)
    const progressInterval = setInterval(() => {
      if (uploadProgress.value < 90) {
        uploadProgress.value += 10;
      }
    }, 100);

    const response = await fetch(`${backendUrl}/upload-file`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
    });

    clearInterval(progressInterval);
    uploadProgress.value = 100;

    if (!response.ok) {
      let errorDetail = '上传失败';
      try {
        const error = await response.json();
        errorDetail = error.detail || '上传失败';
      } catch {
        errorDetail = response.status === 413
          ? '文件大小超过限制'
          : `服务器错误 (${response.status})`;
      }
      throw new Error(errorDetail);
    }

    const result = await response.json();
    uploadedFile.value = result;
    emit('uploaded', result);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '上传失败';
  } finally {
    isUploading.value = false;
    uploadProgress.value = 0;
  }
}

function removeFile() {
  uploadedFile.value = null;
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
  cursor: not-allowed;
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
</style>
