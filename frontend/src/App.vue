<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue';
import MainLayout from './views/MainLayout.vue';

const hasError = ref(false);

onErrorCaptured(() => {
  hasError.value = true;
  return false;
});

function retry() {
  hasError.value = false;
}
</script>

<template>
  <MainLayout v-if="!hasError" />
  <div v-else class="error-boundary">
    <p>应用遇到了一个错误，请重试。</p>
    <button type="button" @click="retry">重试</button>
  </div>
</template>

<style scoped>
.error-boundary {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  gap: 16px;
  color: var(--color-primary);
  font-size: 16px;
  text-align: center;
}

.error-boundary button {
  padding: 10px 24px;
  border: 1px solid var(--color-glass-border);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.34);
  color: var(--color-primary);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.error-boundary button:hover {
  background: rgba(255, 255, 255, 0.5);
}
</style>
