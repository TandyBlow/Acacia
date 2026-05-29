<template>
  <n-config-provider :locale="zhCN" abstract>
    <div class="admin-app">
      <div v-if="loading" class="admin-loading">{{ $t('admin.loading') }}</div>
      <div v-else-if="!isAuthenticated" class="admin-login">
        <h1>{{ $t('admin.title') }}</h1>
        <LoginForm @logged-in="onLoggedIn" />
      </div>
      <div v-else-if="!isAdmin" class="admin-forbidden">
        <h1>403</h1>
        <p>{{ $t('admin.forbidden') }}</p>
      </div>
      <AdminPanel v-else @logout="onLogout" />
    </div>
  </n-config-provider>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { NConfigProvider, zhCN } from 'naive-ui';
import { useAuthStore } from '../stores/authStore';
import { apiFetch } from '../utils/api';
import AdminPanel from './AdminPanel.vue';
import LoginForm from './LoginForm.vue';

const authStore = useAuthStore();

const loading = ref(true);
const isAdmin = ref(false);
const isAuthenticated = ref(false);

onMounted(async () => {
  await authStore.initialize();
  isAuthenticated.value = authStore.isAuthenticated;
  if (isAuthenticated.value) {
    await checkAdmin();
  }
  loading.value = false;
});

async function onLoggedIn() {
  isAuthenticated.value = true;
  await checkAdmin();
}

async function checkAdmin() {
  try {
    const result = await apiFetch<{ is_admin: boolean }>('/admin/check');
    isAdmin.value = result.is_admin;
  } catch {
    isAdmin.value = false;
  }
}

async function onLogout() {
  await authStore.logout();
  isAuthenticated.value = false;
  isAdmin.value = false;
}
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f5f5f5;
  color: #333;
}

.admin-app {
  min-height: 100vh;
}

.admin-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  font-size: 18px;
  color: #666;
}

.admin-login {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  gap: 32px;
}

.admin-login h1 {
  font-size: 24px;
  font-weight: 600;
  color: #1a1a1a;
}

.admin-forbidden {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  gap: 16px;
}

.admin-forbidden h1 {
  font-size: 72px;
  font-weight: 700;
  color: #e53935;
}

.admin-forbidden p {
  font-size: 18px;
  color: #666;
}
</style>
