<template>
  <div ref="authRef" class="auth-shell">
    <div class="auth-card">
      <h2 class="auth-title">{{ isRegisterMode ? $t('auth.register') : $t('auth.login') }}</h2>
      <p class="auth-hint">
        {{ $t('auth.hint') }}
      </p>

      <label class="field">
        <span class="field-label">{{ $t('auth.username') }}</span>
        <input
          v-model="username"
          type="text"
          class="field-input"
          :disabled="isBusy"
          autocomplete="username"
          spellcheck="false"
        />
      </label>

      <label class="field">
        <span class="field-label">{{ $t('auth.password') }}</span>
        <input
          v-model="password"
          type="password"
          class="field-input"
          :disabled="isBusy"
          autocomplete="current-password"
          spellcheck="false"
        />
      </label>

      <label v-if="isRegisterMode" class="field">
        <span class="field-label">{{ $t('auth.confirmPassword') }}</span>
        <input
          v-model="confirmPassword"
          type="password"
          class="field-input"
          :disabled="isBusy"
          autocomplete="new-password"
          spellcheck="false"
        />
      </label>

      <p v-if="errorMessage" class="error-message">
        {{ errorMessage }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '../../stores/authStore';
import { usePageTransition } from '../../composables/usePageTransition';

const authStore = useAuthStore();
const {
  username,
  password,
  confirmPassword,
  isBusy,
  errorMessage,
  isRegisterMode,
} = storeToRefs(authStore);
const { registerRegion, unregisterRegion } = usePageTransition();
const authRef = ref<HTMLElement | null>(null);

onMounted(() => {
  registerRegion({
    id: 'content-auth',
    type: 'glass',
    element: authRef,
    shouldShow: (state) => !state.isAuthenticated,
    parent: 'content',
  });
});

onBeforeUnmount(() => {
  unregisterRegion('content-auth');
});
</script>

<style scoped>
.auth-shell {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--color-primary);
  padding: 24px;
}

.auth-card {
  width: min(100%, 460px);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.auth-title {
  margin: 0;
  font-size: 26px;
  font-weight: 800;
}

.auth-hint {
  margin: 0 0 6px;
  font-size: 14px;
  opacity: 0.78;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 14px;
  font-weight: 700;
}

.field-input {
  border: 1px solid rgba(109, 138, 255, 0.34);
  border-radius: 12px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.34);
  color: var(--color-primary);
}

.field-input:focus {
  outline: 2px solid rgba(102, 255, 229, 0.52);
  outline-offset: 1px;
}

.field-input:disabled {
  cursor: wait;
  opacity: 0.76;
}

.error-message {
  margin: 0;
  font-size: 13px;
  color: #d9256d;
  font-weight: 600;
}
</style>
