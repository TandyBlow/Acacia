<template>
  <form class="login-form" @submit.prevent="handleLogin">
    <div class="form-field">
      <label for="username">用户名</label>
      <input id="username" v-model="authStore.username" type="text" required autocomplete="username" />
    </div>
    <div class="form-field">
      <label for="password">密码</label>
      <input id="password" v-model="authStore.password" type="password" required autocomplete="current-password" />
    </div>
    <div v-if="authStore.errorMessage" class="form-error">{{ authStore.errorMessage }}</div>
    <button type="submit" :disabled="authStore.isBusy" class="btn-login">
      {{ authStore.isBusy ? '登录中...' : '登录' }}
    </button>
  </form>
</template>

<script setup lang="ts">
import { useAuthStore } from '../stores/authStore';

const emit = defineEmits<{ 'logged-in': [] }>();

const authStore = useAuthStore();

async function handleLogin() {
  const ok = await authStore.submitByKnob();
  if (ok) {
    emit('logged-in');
  }
}
</script>

<style scoped>
.login-form {
  width: 320px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-field label {
  font-size: 14px;
  font-weight: 500;
  color: #444;
}

.form-field input {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 15px;
  outline: none;
  transition: border-color 0.2s;
}

.form-field input:focus {
  border-color: #4a90d9;
}

.form-error {
  font-size: 14px;
  color: #e53935;
}

.btn-login {
  padding: 10px;
  background: #4a90d9;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-login:hover {
  background: #357abd;
}

.btn-login:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
