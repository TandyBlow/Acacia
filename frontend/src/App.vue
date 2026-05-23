<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue';
import MainLayout from './views/MainLayout.vue';
import { UI } from './constants/uiStrings';

const hasError = ref(false);
const errorMessage = ref('');

onErrorCaptured((err) => {
  hasError.value = true;
  errorMessage.value = err instanceof Error ? err.message : String(err);
  console.error('App error:', err);
  return false;
});

function retry() {
  hasError.value = false;
  errorMessage.value = '';
}
</script>

<template>
  <MainLayout v-if="!hasError" />
  <div v-else class="error-boundary">
    <p>{{ UI.app.errorOccurred }}</p>
    <pre class="error-detail" v-if="errorMessage">{{ errorMessage }}</pre>
    <button type="button" @click="retry">{{ UI.app.retry }}</button>
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
  align-content: center;
}

.error-detail {
  max-width: 600px;
  padding: 12px 16px;
  border-radius: 10px;
  background: rgba(255, 0, 0, 0.1);
  border: 1px solid rgba(255, 0, 0, 0.3);
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  white-space: pre-wrap;
  word-break: break-all;
  text-align: left;
  margin: 0;
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
