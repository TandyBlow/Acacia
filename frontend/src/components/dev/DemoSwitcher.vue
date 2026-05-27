<template>
  <div class="demo-switcher">
    <span class="demo-label">DEMO</span>
    <button
      v-for="acct in accounts"
      :key="acct.username"
      class="demo-btn"
      :class="{ active: acct.username === currentUser }"
      :style="{ '--dot-color': acct.dotColor }"
      :disabled="switching"
      :title="`${acct.domain} · ${acct.style}`"
      @click="switchTo(acct)"
    >
      <span class="dot" />
      <span class="name">{{ acct.style }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '../../stores/authStore';

const accounts = [
  { username: 'demo_cs',  password: 'demo123', domain: '计算机科学', style: '蔚蓝', dotColor: '#4488cc' },
  { username: 'demo_math', password: 'demo123', domain: '数学逻辑', style: '金辉', dotColor: '#dda830' },
  { username: 'demo_lit', password: 'demo123', domain: '文学艺术', style: '樱粉', dotColor: '#ee88aa' },
  { username: 'demo_bio', password: 'demo123', domain: '生物学',   style: '翠绿', dotColor: '#33aa55' },
  { username: 'demo_phil', password: 'demo123', domain: '哲学思辨', style: '紫晶', dotColor: '#8855bb' },
];

const authStore = useAuthStore();
const { initialized, isAuthenticated } = storeToRefs(authStore);
const switching = ref(false);
const currentUser = computed(() => authStore.user?.username || '');

async function loginAs(acct: typeof accounts[0]) {
  authStore.mode = 'login';
  authStore.username = acct.username;
  authStore.password = acct.password;
  await authStore.submitByKnob();
}

async function switchTo(acct: typeof accounts[0]) {
  if (switching.value || acct.username === currentUser.value) return;
  switching.value = true;
  try {
    await authStore.logout();
    await new Promise(r => setTimeout(r, 600));
    await loginAs(acct);
  } finally {
    switching.value = false;
  }
}

// Auto-login IMMEDIATELY when auth initializes — before AuthPanel renders
watch(initialized, async (val) => {
  if (!val) return;
  if (!isAuthenticated.value) {
    await loginAs(accounts[0]);
  }
}, { immediate: true });
</script>

<style scoped>
.demo-switcher {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 20px;
  background: rgba(0,0,0,0.45);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,0.12);
}
.demo-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: rgba(255,255,255,0.4);
  margin-right: 4px;
}
.demo-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px 4px 6px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.06);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 12px;
  color: rgba(255,255,255,0.65);
}
.demo-btn:hover { background: rgba(255,255,255,0.14); color: #fff; }
.demo-btn.active { background: rgba(255,255,255,0.18); border-color: rgba(255,255,255,0.3); color: #fff; }
.demo-btn:disabled { opacity: 0.4; cursor: wait; }
.dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--dot-color);
  box-shadow: 0 0 6px var(--dot-color);
  flex-shrink: 0;
}
.name { white-space: nowrap; }
</style>
