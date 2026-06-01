import { ref, computed, onBeforeUnmount } from 'vue';
import { useAuthStore } from '../stores/authStore';
import { useStyleStore } from '../stores/styleStore';
import { useTreeSkeleton } from './useTreeSkeleton';
import { storeToRefs } from 'pinia';

export interface DemoScene {
  id: string;
  label: string;
  durationMs: number;
  /** Account to use for this scene; if different from previous, triggers logout+login */
  account?: { username: string; password: string };
}

const SCENES: DemoScene[] = [
  { id: 'tree-cs', label: '知识之树 · 蔚蓝', durationMs: 6000, account: { username: 'demo_cs', password: 'demo123' } },
  { id: 'editor-cs', label: '动态规划笔记', durationMs: 5000 },
  { id: 'tree-math', label: '知识之树 · 金辉', durationMs: 5000, account: { username: 'demo_math', password: 'demo123' } },
];

export function useCinematicDemo() {
  const authStore = useAuthStore();
  const styleStore = useStyleStore();
  const { initialized, isAuthenticated, user } = storeToRefs(authStore);

  const ready = ref(false);
  const loading = ref(true);
  const loadingText = ref('正在准备演示...');

  const currentSceneIdx = ref(0);
  const paused = ref(false);
  const transitioning = ref(false);

  let advanceTimer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  const currentScene = computed(() => SCENES[currentSceneIdx.value]);
  const totalScenes = SCENES.length;

  // ── Auto-login ──────────────────────────────────────────

  async function loginAs(acct: { username: string; password: string }) {
    if (isAuthenticated.value && user.value?.username === acct.username) return;
    if (isAuthenticated.value) {
      await authStore.logout();
      await new Promise(r => setTimeout(r, 600));
    }
    authStore.mode = 'login';
    authStore.username = acct.username;
    authStore.password = acct.password;
    await authStore.submitByKnob();
  }

  // ── Scene switching ──────────────────────────────────────

  function clearAdvanceTimer() {
    if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
  }

  async function switchToScene(idx: number) {
    if (cancelled || idx >= SCENES.length) return;
    const scene = SCENES[idx]!;
    currentSceneIdx.value = idx;

    // Switch account if needed
    if (scene.account) {
      loadingText.value = `切换至 ${scene.label}...`;
      await loginAs(scene.account);
      // Fetch style for new account
      const uid = authStore.user?.id;
      if (uid) await styleStore.fetchStyle(uid);
      // Preload tree skeleton
      if (uid) {
        try { await useTreeSkeleton().fetchSkeleton(); } catch (e) { console.error('[useCinematicDemo] fetchSkeleton failed:', e); }
      }
    }

    ready.value = true;
    loading.value = false;
    transitioning.value = false;
  }

  function scheduleAdvance() {
    clearAdvanceTimer();
    if (paused.value || cancelled) return;

    const scene = SCENES[currentSceneIdx.value]!;
    advanceTimer = setTimeout(async () => {
      if (paused.value || cancelled) return;
      transitioning.value = true;

      // Brief pause for the crossfade to be visible
      await new Promise(r => setTimeout(r, 400));

      const nextIdx = (currentSceneIdx.value + 1) % SCENES.length;
      await switchToScene(nextIdx);
      scheduleAdvance();
    }, scene.durationMs);
  }

  // ── Controls ────────────────────────────────────────────

  function togglePause() {
    paused.value = !paused.value;
    if (!paused.value) scheduleAdvance();
    else clearAdvanceTimer();
  }

  function nextScene() {
    clearAdvanceTimer();
    transitioning.value = true;
    const nextIdx = (currentSceneIdx.value + 1) % SCENES.length;
    // Use a short setTimeout to let the transition class apply
    setTimeout(async () => {
      await switchToScene(nextIdx);
      if (!paused.value) scheduleAdvance();
    }, 400);
  }

  function prevScene() {
    clearAdvanceTimer();
    transitioning.value = true;
    const prevIdx = (currentSceneIdx.value - 1 + SCENES.length) % SCENES.length;
    setTimeout(async () => {
      await switchToScene(prevIdx);
      if (!paused.value) scheduleAdvance();
    }, 400);
  }

  // ── Start ───────────────────────────────────────────────

  async function start() {
    cancelled = false;
    loading.value = true;
    loadingText.value = '正在登录演示账号...';

    // Wait for auth initialization
    if (!initialized.value) {
      await new Promise<void>(resolve => {
        const stop = () => { resolve(); /* watcher cleanup handled by store */ };
        const unwatch = setInterval(() => {
          if (initialized.value) { clearInterval(unwatch); stop(); }
        }, 100);
      });
    }

    await switchToScene(0);
    scheduleAdvance();
  }

  function stop() {
    cancelled = true;
    clearAdvanceTimer();
  }

  onBeforeUnmount(() => stop());

  return {
    ready,
    loading,
    loadingText,
    currentScene,
    currentSceneIdx,
    totalScenes,
    paused,
    transitioning,
    togglePause,
    nextScene,
    prevScene,
    start,
    stop,
  };
}
