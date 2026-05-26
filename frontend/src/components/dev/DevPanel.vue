<template>
  <Teleport to="body">
    <div v-if="isExpanded" class="dev-panel-glass">
      <div class="dev-panel-header">
        <span class="dev-panel-title">开发者面板</span>
        <button class="dev-panel-close" @click="isExpanded = false">−</button>
      </div>
      <div class="dev-panel-body">
        <div class="dev-toggle-row">
          <span class="dev-toggle-label">页面切换动画</span>
          <button
            type="button"
            class="dev-toggle"
            :class="{ on: devStore.enableTransition }"
            @click.stop="devStore.toggleTransition()"
          >
            <span class="dev-toggle-thumb" />
          </button>
        </div>
        <div class="dev-toggle-row">
          <span class="dev-toggle-label">手动 Scene Ready</span>
          <button
            type="button"
            class="dev-toggle"
            :class="{ on: devStore.manualSceneReady }"
            @click.stop="devStore.toggleManualSceneReady()"
          >
            <span class="dev-toggle-thumb" />
          </button>
        </div>
        <div class="dev-toggle-row">
          <span class="dev-toggle-label">当前风格</span>
          <span class="dev-style-name">{{ currentStyleName }}</span>
        </div>
        <button
          type="button"
          class="dev-action-btn"
          :disabled="styleRegenRunning"
          @click="onStyleRegen"
        >
          {{ styleRegenRunning ? '生成中...' : '重新生成风格' }}
        </button>
        <button
          type="button"
          class="dev-action-btn dev-reset-style-btn"
          @click="onResetStyle"
        >
          重置为默认风格
        </button>
        <button
          type="button"
          class="dev-action-btn"
          :disabled="treeFadeRunning"
          @click="onTreeFadeTest"
        >
          {{ treeFadeRunning ? '动画中...' : '测试树消失动画' }}
        </button>
        <button
          type="button"
          class="dev-action-btn dev-reset-growth-btn"
          :disabled="resetGrowthRunning"
          @click="onResetGrowth"
        >
          {{ resetGrowthRunning ? '重置中...' : '重置今日成长状态' }}
        </button>
        <button
          type="button"
          class="dev-action-btn dev-logout-btn"
          :disabled="logoutRunning"
          @click="onLogout"
        >
          {{ logoutRunning ? '退出中...' : '退出登录' }}
        </button>
        <button
          type="button"
          class="dev-action-btn dev-profile-btn"
          :disabled="profileLoading"
          @click="onShowProfileText"
        >
          {{ profileLoading ? '加载中...' : '查看知识画像' }}
        </button>
      </div>
    </div>
    <!-- 知识画像文本弹层 -->
    <Teleport to="body">
      <div v-if="profileVisible" class="dev-profile-overlay" @click.self="profileVisible = false">
        <div class="dev-profile-modal">
          <div class="dev-profile-header">
            <span class="dev-profile-title">知识画像文本 (Profile Text)</span>
            <button class="dev-profile-close" @click="profileVisible = false">×</button>
          </div>
          <div class="dev-profile-body" v-if="profileData">
            <div class="dev-profile-cards">
              <div class="dev-profile-card">
                <div class="dev-profile-card-label">知识点数</div>
                <div class="dev-profile-card-value">{{ profileData.nodeCount }}</div>
              </div>
              <div class="dev-profile-card">
                <div class="dev-profile-card-label">画像文本长度</div>
                <div class="dev-profile-card-value">{{ profileData.profileTextLength }} 字符</div>
              </div>
              <div class="dev-profile-card">
                <div class="dev-profile-card-label">SHA256 哈希</div>
                <div class="dev-profile-card-value dev-profile-hash">{{ profileData.hashShort }}</div>
              </div>
            </div>
            <div class="dev-profile-section">
              <div class="dev-profile-section-title">完整画像文本 <span class="dev-profile-hint">(按节点名排序后用 "|" 拼接)</span></div>
              <pre class="dev-profile-text">{{ profileData.profileText }}</pre>
            </div>
            <div class="dev-profile-section">
              <div class="dev-profile-section-title">逐节点分解 <span class="dev-profile-hint">(每个节点: name + ":" + content前200字)</span></div>
              <table class="dev-profile-table">
                <thead>
                  <tr>
                    <th class="dev-profile-th-num">#</th>
                    <th class="dev-profile-th-name">节点名</th>
                    <th class="dev-profile-th-content">content 前200字</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(n, i) in profileData.nodes" :key="i" :class="{ 'dev-profile-empty-row': !n.hasContent }">
                    <td class="dev-profile-td-num">{{ i + 1 }}</td>
                    <td class="dev-profile-td-name">{{ n.name }}</td>
                    <td class="dev-profile-td-content">{{ n.contentPreview || '(空)' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
    <!-- Floating Scene Ready button — always visible when waiting -->
    <button
      v-if="waitingForScene"
      type="button"
      class="scene-ready-btn"
      @click="emitSceneReady"
    >
      Scene Ready
    </button>
    <button v-if="!isExpanded && !waitingForScene" class="dev-panel-trigger" @click="isExpanded = true">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="9" cy="9" r="2.5" />
        <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M3.7 14.3l1.4-1.4M12.9 5.1l1.4-1.4" />
      </svg>
    </button>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, inject } from 'vue';
import { useDevStore } from '../../stores/devStore';
import { useAuthStore } from '../../stores/authStore';
import { useNodeStore } from '../../stores/nodeStore';
import { useStyleStore } from '../../stores/styleStore';
import { getToken } from '../../utils/api';
import { invalidateSkeleton } from '../../composables/useTreeSkeleton';

const devStore = useDevStore();
const authStore = useAuthStore();
const nodeStore = useNodeStore();
const styleStore = useStyleStore();
const isExpanded = ref(false);
const waitingForScene = ref(false);
const treeFadeRunning = ref(false);
const logoutRunning = ref(false);
const styleRegenRunning = ref(false);
const resetGrowthRunning = ref(false);
const profileLoading = ref(false);
const profileVisible = ref(false);
const profileData = ref<{
  nodeCount: number;
  profileTextLength: number;
  hash: string;
  hashShort: string;
  profileText: string;
  nodes: { name: string; contentPreview: string; hasContent: boolean }[];
} | null>(null);

const currentStyleName = computed(() => styleStore.style || 'default');

async function onLogout() {
  if (logoutRunning.value) return;
  logoutRunning.value = true;
  try {
    const ok = await authStore.logout();
    if (ok) {
      nodeStore.resetAfterLogout();
      invalidateSkeleton();
    }
  } finally {
    logoutRunning.value = false;
  }
}

const triggerTreeFadeTest = inject<() => Promise<void>>('triggerTreeFadeTest', () => Promise.resolve());

async function onTreeFadeTest() {
  if (treeFadeRunning.value) return;
  treeFadeRunning.value = true;
  try {
    await triggerTreeFadeTest();
  } finally {
    treeFadeRunning.value = false;
  }
}

function emitSceneReady() {
  window.dispatchEvent(new CustomEvent('dev-scene-ready'));
  waitingForScene.value = false;
}

async function onStyleRegen() {
  if (styleRegenRunning.value) return;
  const userId = authStore.user?.id;
  if (!userId) return;
  styleRegenRunning.value = true;
  try {
    await styleStore.forceRegenerateStyle(userId);
  } finally {
    styleRegenRunning.value = false;
  }
}

function onResetStyle() {
  styleStore.resetAndLock();
}

function getBackendUrl(): string {
  return import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:7860';
}

async function onResetGrowth() {
  if (resetGrowthRunning.value) return;
  resetGrowthRunning.value = true;
  try {
    const token = getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const url = `${getBackendUrl()}/daily-quiz/reset`;
    const res = await fetch(url, { method: 'POST', headers });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as any).detail ?? '重置失败');
    }
    await nodeStore.checkDailyQuizStatus();
  } catch (e: unknown) {
    console.error('重置今日成长状态失败:', e);
  } finally {
    resetGrowthRunning.value = false;
  }
}

async function onShowProfileText() {
  if (profileLoading.value) return;
  profileLoading.value = true;
  try {
    const token = getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const url = `${getBackendUrl()}/debug/profile-text`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error('Failed to fetch profile text');
    profileData.value = await res.json();
    profileVisible.value = true;
  } catch (e: unknown) {
    console.error('获取知识画像失败:', e);
  } finally {
    profileLoading.value = false;
  }
}

function onWaitingForScene() {
  if (devStore.manualSceneReady) {
    waitingForScene.value = true;
  }
}

onMounted(() => {
  window.addEventListener('dev-waiting-for-scene', onWaitingForScene);
});

onBeforeUnmount(() => {
  window.removeEventListener('dev-waiting-for-scene', onWaitingForScene);
});
</script>

<style scoped>
.dev-panel-glass {
  position: fixed;
  bottom: 20px;
  left: 20px;
  z-index: 1000;
  min-width: 220px;
  border: 1px solid var(--color-glass-border);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow:
    5px 5px 10px var(--shadow-raised-a),
    -5px -5px 10px var(--shadow-raised-b);
  overflow: hidden;
}

.dev-panel-trigger {
  position: fixed;
  bottom: 20px;
  left: 20px;
  z-index: 1000;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow:
    5px 5px 10px var(--shadow-raised-a),
    -5px -5px 10px var(--shadow-raised-b);
  color: var(--color-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: box-shadow 160ms ease, background 160ms ease;
}

.dev-panel-trigger:hover {
  background: rgba(255, 255, 255, 0.12);
}

.dev-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px 6px;
}

.dev-panel-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-primary);
  opacity: 0.7;
}

.dev-panel-close {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-primary);
  opacity: 0.5;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  line-height: 1;
}

.dev-panel-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 14px 12px;
}

.dev-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  user-select: none;
}

.dev-toggle-label {
  font-size: 13px;
  color: var(--color-primary);
  opacity: 0.75;
}

.dev-style-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-hint);
  opacity: 0.85;
}

.dev-toggle {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: 11px;
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 160ms ease, border-color 160ms ease;
}

.dev-toggle.on {
  background: rgba(102, 255, 229, 0.25);
  border-color: rgba(102, 255, 229, 0.35);
}

.dev-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-primary);
  opacity: 0.6;
  transition: transform 160ms ease, opacity 160ms ease;
}

.dev-toggle.on .dev-toggle-thumb {
  transform: translateX(18px);
  opacity: 1;
  background: rgba(102, 255, 229, 0.9);
}

.dev-action-btn {
  margin-top: 4px;
  padding: 6px 12px;
  border: 1px solid rgba(102, 255, 229, 0.35);
  border-radius: 10px;
  background: rgba(102, 255, 229, 0.15);
  color: var(--color-hint);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  transition: background 160ms ease;
}

.dev-action-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.dev-action-btn:not(:disabled):hover {
  background: rgba(102, 255, 229, 0.25);
}

.dev-logout-btn {
  border-color: rgba(255, 120, 120, 0.35);
  background: rgba(255, 120, 120, 0.12);
}

.dev-logout-btn:not(:disabled):hover {
  background: rgba(255, 120, 120, 0.22);
}

.dev-reset-growth-btn {
  border-color: rgba(255, 200, 80, 0.35);
  background: rgba(255, 200, 80, 0.12);
}

.dev-reset-growth-btn:not(:disabled):hover {
  background: rgba(255, 200, 80, 0.22);
}

.dev-reset-style-btn {
  border-color: rgba(255, 170, 0, 0.35);
  background: rgba(255, 170, 0, 0.12);
  color: #FFAA00;
}

.dev-reset-style-btn:not(:disabled):hover {
  background: rgba(255, 170, 0, 0.22);
}

.scene-ready-btn {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1001;
  padding: 10px 28px;
  border: 1px solid rgba(102, 255, 229, 0.5);
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: var(--color-hint);
  cursor: pointer;
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  transition: background 160ms ease;
}

.scene-ready-btn:hover {
  background: rgba(0, 0, 0, 0.8);
}

/* ── 知识画像弹层 ─────────────────────────────────────── */

.dev-profile-btn {
  border-color: rgba(180, 160, 255, 0.35);
  background: rgba(180, 160, 255, 0.12);
  color: #b4a0ff;
}

.dev-profile-btn:not(:disabled):hover {
  background: rgba(180, 160, 255, 0.22);
}

.dev-profile-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.dev-profile-modal {
  width: min(900px, 100%);
  max-height: 85vh;
  border: 1px solid var(--color-glass-border);
  border-radius: 20px;
  background: rgba(18, 18, 30, 0.92);
  backdrop-filter: blur(20px);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.dev-profile-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.dev-profile-title {
  font-size: 15px;
  font-weight: 700;
  color: #b4a0ff;
}

.dev-profile-close {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 120ms ease, color 120ms ease;
}

.dev-profile-close:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.dev-profile-body {
  overflow-y: auto;
  padding: 16px 20px 20px;
  flex: 1;
}

.dev-profile-cards {
  display: flex;
  gap: 12px;
  margin-bottom: 18px;
}

.dev-profile-card {
  flex: 1;
  padding: 12px 16px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
}

.dev-profile-card-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.dev-profile-card-value {
  font-size: 15px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.85);
}

.dev-profile-hash {
  font-size: 12px;
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  word-break: break-all;
}

.dev-profile-section {
  margin-bottom: 16px;
}

.dev-profile-section-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.55);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.dev-profile-hint {
  font-weight: 400;
  text-transform: none;
  color: rgba(255, 255, 255, 0.3);
  font-size: 11px;
}

.dev-profile-text {
  padding: 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.3);
  color: rgba(255, 255, 255, 0.65);
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}

.dev-profile-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.dev-profile-table th {
  text-align: left;
  padding: 8px 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.4);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.dev-profile-table td {
  padding: 7px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.7);
  vertical-align: top;
}

.dev-profile-td-num {
  width: 32px;
  color: rgba(255, 255, 255, 0.3) !important;
  text-align: right;
}

.dev-profile-td-name {
  width: 160px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8) !important;
}

.dev-profile-td-content {
  color: rgba(255, 255, 255, 0.5) !important;
  line-height: 1.5;
}

.dev-profile-empty-row .dev-profile-td-content {
  color: rgba(255, 255, 255, 0.2) !important;
  font-style: italic;
}
</style>
