<template>
  <div class="cinema-overlay">
    <!-- Loading -->
    <Transition name="fade">
      <div v-if="demoPhase === 'loading'" class="cinema-loading">
        <div class="loading-ring" />
        <p class="loading-text">{{ loadingText }}</p>
      </div>
    </Transition>

    <!-- Phase 1 control bar -->
    <div v-if="demoPhase === 'phase1' && ready" class="cinema-controls">
      <button class="ctrl-btn" @click="prevScene" :disabled="busy">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <button class="ctrl-btn" @click="togglePause">
        <svg v-if="paused" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
      </button>
      <button class="ctrl-btn" @click="nextScene" :disabled="busy">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
      <div class="ctrl-dots">
        <span v-for="(s, i) in phase1Scenes" :key="s.id" class="ctrl-dot" :class="{ active: i === phase1Idx }" @click="jumpToPhase1Scene(i)" />
      </div>
      <span class="ctrl-label" v-if="phase1Scenes[phase1Idx]">{{ phase1Scenes[phase1Idx].label }}</span>
    </div>

    <!-- Blackout transition -->
    <Transition name="fade">
      <div v-if="demoPhase === 'blackout'" class="blackout-overlay" />
    </Transition>

    <!-- Done label -->
    <Transition name="fade">
      <div v-if="demoPhase === 'done'" class="done-label">Acacia</div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue';
import { storeToRefs } from 'pinia';
import * as THREE from 'three';
import { useAuthStore } from '../../stores/authStore';
import { useNodeStore, getDataAdapter } from '../../stores/nodeStore';
import { useStyleStore } from '../../stores/styleStore';
import { usePageTransition } from '../../composables/usePageTransition';
import { cinemaTreeCanvas } from '../../composables/useCinemaBridge';
import { presetSkeleton } from '../../composables/useTreeSkeleton';
import * as nodeCache from '../../services/nodeCache';
import type { AuthUser } from '../../types/auth';
import type { NodeContext, TreeNode } from '../../types/node';
import type { SkeletonData } from '../../types/tree';

const authStore = useAuthStore();
const nodeStore = useNodeStore();
const styleStore = useStyleStore();
const { isTransitioning } = usePageTransition();
const { initialized, isAuthenticated } = storeToRefs(authStore);

// ── Phase state machine ──────────────────────────────────

type DemoPhase = 'loading' | 'phase1' | 'blackout' | 'phase2' | 'done';
const demoPhase = ref<DemoPhase>('loading');
const ready = ref(false);
const loadingText = ref('正在准备演示...');
const busy = ref(false);
const paused = ref(false);

let advanceTimer: ReturnType<typeof setTimeout> | null = null;
let cancelled = false;

// ── Account cache ────────────────────────────────────────

interface AccountSnap {
  user: AuthUser;
  styleName: string;
  styleParams: Record<string, unknown> | null;
  bgUrl: string | null;
  distribution: Record<string, number>;
  treeData: TreeNode[];
  rootContext: NodeContext;
  editorNodeId: string;
  editorContext: NodeContext;
  skeleton: SkeletonData | null;
}

const snapshots = new Map<string, AccountSnap>();

const ACCOUNTS: Record<string, { username: string; password: string; editorNodeId: string }> = {
  gamedev: { username: 'alex_gamedev', password: 'demo123', editorNodeId: 'alex_gamedev_关卡设计' },
  fullstack: { username: 'jamie_fullstack', password: 'demo123', editorNodeId: 'jamie_fullstack_RESTful API' },
  piano: { username: 'emma_piano', password: 'demo123', editorNodeId: 'emma_piano_踏板技法' },
  japanese: { username: 'yuki_japanese', password: 'demo123', editorNodeId: 'yuki_japanese_N2语法' },
};

// ── Demo styles (100 AI-generated) ────────────────────────

interface DemoStyleEntry {
  index: number;
  styleName: string;
  params: Record<string, unknown>;
  bgPath: string | null;
}

const demoStyles = ref<DemoStyleEntry[]>([]);
const preloadedTextures = new Map<number, THREE.Texture>();

async function loadDemoStyles() {
  try {
    const resp = await fetch('/demo_styles.json');
    if (!resp.ok) {
      console.warn('[CinemaDemo] demo_styles.json not found, style cycling disabled');
      return;
    }
    const data = await resp.json();
    demoStyles.value = data;
    console.log(`[CinemaDemo] loaded ${data.length} styles from demo_styles.json`);
  } catch (e) {
    console.warn('[CinemaDemo] failed to load demo_styles.json:', e);
  }
}

function preloadBackgroundTextures() {
  const loader = new THREE.TextureLoader();
  for (const style of demoStyles.value) {
    const path = style.bgPath || `/backgrounds/ai/demo_style_${String(style.index).padStart(3, '0')}.png`;
    loader.load(
      path,
      (texture) => {
        preloadedTextures.set(style.index, texture);
        if (preloadedTextures.size === demoStyles.value.length) {
          console.log('[CinemaDemo] all background textures preloaded');
        }
      },
      undefined,
      () => {
        // Silently skip failed textures — they'll just use whatever is current
      },
    );
  }
}

// ── Helpers ───────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

async function waitForSettle(targetViewState: string): Promise<void> {
  const dl = Date.now() + 15000;
  while (Date.now() < dl) {
    if (cancelled) return;
    if (!isTransitioning.value) break;
    await sleep(80);
  }
  while (Date.now() < dl) {
    if (cancelled) return;
    if (nodeStore.viewState === targetViewState) break;
    await sleep(80);
  }
  await sleep(700);
}

async function waitForStyleLoaded(): Promise<void> {
  const dl = Date.now() + 30000;
  while (Date.now() < dl) {
    if (cancelled) return;
    if (styleStore.loaded) return;
    await sleep(200);
  }
}

// ── Snapshot capture ──────────────────────────────────────

async function captureSnapshot(editorNodeId: string): Promise<AccountSnap> {
  const adapter = getDataAdapter();
  const uid = authStore.user!.id;
  const user: AuthUser = { ...authStore.user! };

  const [treeData, styleResp, rootContext, editorContext, skeleton] = await Promise.all([
    adapter.getTree(),
    adapter.fetchStyle?.(uid) ?? Promise.resolve({ style: 'default', distribution: {} }),
    adapter.getNodeContext(null),
    adapter.getNodeContext(editorNodeId),
    adapter.fetchTreeSkeleton?.(uid) ?? Promise.resolve(null),
  ]);

  return {
    user,
    styleName: styleResp.style ?? 'default',
    styleParams: (styleResp.params as Record<string, unknown>) ?? null,
    bgUrl: styleResp.backgroundUrl ?? null,
    distribution: (styleResp.distribution as Record<string, number>) ?? {},
    treeData,
    rootContext,
    editorNodeId,
    editorContext,
    skeleton: skeleton as SkeletonData | null,
  };
}

// ── Inject cached account (zero API calls) ─────────────────

function injectAccount(snap: AccountSnap) {
  authStore.user = snap.user;
  styleStore.forceStyle(snap.styleName, snap.distribution, snap.styleParams, snap.bgUrl);
  nodeStore.treeNodes = snap.treeData;
  nodeCache.setCache(null, snap.rootContext);
  nodeCache.setCache(snap.editorNodeId, snap.editorContext);
  if (snap.skeleton) presetSkeleton(snap.skeleton);
}

// ── Login ──────────────────────────────────────────────────

async function loginAs(acct: { username: string; password: string }) {
  if (authStore.user?.username === acct.username) return;
  if (isAuthenticated.value) {
    await authStore.logout();
    await sleep(400);
  }
  authStore.mode = 'login';
  authStore.username = acct.username;
  authStore.password = acct.password;
  await authStore.submitByKnob();
}

// ── Phase 1: feature showcase ──────────────────────────────

interface Phase1Scene {
  id: string;
  label: string;
  accountKey: string;
  nodeId?: string | null;
  viewState?: string;
  durationMs: number;
  onEnter?: () => void;
}

const phase1Scenes = ref<Phase1Scene[]>([]);
const phase1Idx = ref(0);

async function advancePhase1Scene(idx: number) {
  if (busy.value || cancelled) return;
  busy.value = true;
  clearAdvanceTimer();

  const scene = phase1Scenes.value[idx];
  if (!scene) { busy.value = false; return; }

  const prevScene = phase1Scenes.value[phase1Idx.value];

  if (!prevScene || prevScene.accountKey !== scene.accountKey) {
    const snap = snapshots.get(scene.accountKey);
    if (snap) injectAccount(snap);
  }

  if (scene.viewState) {
    nodeStore.setViewState(scene.viewState as any);
    await waitForSettle(scene.viewState);
  } else {
    nodeStore.loadNode(scene.nodeId ?? null);
    await waitForSettle('display');
  }

  scene.onEnter?.();

  phase1Idx.value = idx;
  if (!cancelled) {
    busy.value = false;
    schedulePhase1Advance();
  }
}

function clearAdvanceTimer() {
  if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
}

function schedulePhase1Advance() {
  clearAdvanceTimer();
  if (paused.value || cancelled) return;
  const s = phase1Scenes.value[phase1Idx.value];
  if (!s) return;
  advanceTimer = setTimeout(async () => {
    if (paused.value || cancelled) return;
    const next = (phase1Idx.value + 1) % phase1Scenes.value.length;
    await advancePhase1Scene(next);
  }, s.durationMs);
}

function togglePause() {
  paused.value = !paused.value;
  if (paused.value) clearAdvanceTimer();
  else schedulePhase1Advance();
}
async function nextScene() { await advancePhase1Scene((phase1Idx.value + 1) % phase1Scenes.value.length); }
async function prevScene() { await advancePhase1Scene((phase1Idx.value - 1 + phase1Scenes.value.length) % phase1Scenes.value.length); }
async function jumpToPhase1Scene(i: number) { if (i !== phase1Idx.value && !busy.value) await advancePhase1Scene(i); }

// ── Phase 2: growth + accelerating style cycle ──────────────

let phase2AnimFrame = 0;

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

async function runPhase2() {
  const gamedevSnap = snapshots.get('gamedev')!;
  injectAccount(gamedevSnap);
  nodeStore.loadNode(null);
  await waitForSettle('display');

  const originalParams = deepClone(styleStore.styleParams);
  const originalBgUrl = styleStore.backgroundUrl;
  const styles = demoStyles.value;
  const textures = preloadedTextures;

  if (styles.length === 0) {
    console.warn('[CinemaDemo] no demo styles loaded, skipping Phase 2');
    demoPhase.value = 'done';
    return;
  }

  const totalDuration = 15000;
  const startTime = performance.now();
  let styleProgress = 0;
  let currentStyleIdx = -1;
  let lastRebuildTime = 0;
  let lastFrameTime = startTime;

  const animate = () => {
    const now = performance.now();
    const elapsed = now - startTime;
    const deltaTime = now - lastFrameTime;
    lastFrameTime = now;

    if (elapsed >= totalDuration || cancelled) {
      cancelAnimationFrame(phase2AnimFrame);
      finishPhase2(originalParams, originalBgUrl, gamedevSnap);
      return;
    }

    const progress = elapsed / totalDuration;
    const gm = 0.3 + progress * 2.2;

    // Style interval: 800ms → 30ms (quadratic acceleration)
    const interval = 800 - (800 - 30) * progress * progress;
    styleProgress += deltaTime / interval;
    const targetIdx = Math.min(styles.length - 1, Math.floor(styleProgress));

    const canvas = cinemaTreeCanvas.value;
    if (!canvas) {
      phase2AnimFrame = requestAnimationFrame(animate);
      return;
    }

    if (targetIdx > currentStyleIdx) {
      currentStyleIdx = targetIdx;
      const dur = Math.max(60, interval * 0.7);
      canvas.transitionToParamsDirect(styles[currentStyleIdx].params, dur);
      styleStore.applyThemeFromParams(styles[currentStyleIdx].params);
      const tex = textures.get(currentStyleIdx);
      if (tex) canvas.swapBackgroundTexture(tex);
    }

    // Rebuild tree geometry every 250ms at the current growth level
    if (elapsed - lastRebuildTime > 250) {
      lastRebuildTime = elapsed;
      canvas.setGrowthLevel(gm, 18, 3);
      canvas.setTreeGroupScale(1.0);
    } else {
      const baseGM = 0.3 + (lastRebuildTime / totalDuration) * 2.2;
      const scale = gm / Math.max(0.01, baseGM);
      canvas.setTreeGroupScale(Math.max(0.3, Math.min(2.0, scale)));
    }

    phase2AnimFrame = requestAnimationFrame(animate);
  };

  phase2AnimFrame = requestAnimationFrame(animate);
}

function finishPhase2(originalParams: any, originalBgUrl: string | null, gamedevSnap: AccountSnap) {
  const canvas = cinemaTreeCanvas.value;
  if (canvas) {
    canvas.setGrowthLevel(2.5, 18, 3);
    canvas.setTreeGroupScale(1.0);
    canvas.getManager()?.applyStyleParamsPublic(originalParams);
  }
  styleStore.forceStyle(gamedevSnap.styleName, gamedevSnap.distribution, originalParams, originalBgUrl);
  demoPhase.value = 'done';
}

// ── Transition to Phase 2 ──────────────────────────────────

async function transitionToPhase2() {
  demoPhase.value = 'blackout';
  await sleep(400);
  demoPhase.value = 'phase2';
  runPhase2();
}

// ── Init ───────────────────────────────────────────────────

async function start() {
  cancelled = false;

  loadingText.value = '正在初始化...';
  while (!initialized.value) {
    if (cancelled) return;
    await sleep(100);
  }

  // Step 1: login as gamedev, let MainLayout fully initialize
  loadingText.value = '正在登录...';
  await loginAs(ACCOUNTS.gamedev);
  await waitForStyleLoaded();
  await sleep(3000);
  snapshots.set('gamedev', await captureSnapshot(ACCOUNTS.gamedev.editorNodeId));

  // Step 2: prefetch remaining accounts + load demo styles in parallel
  loadingText.value = '正在预加载...';
  const prefetchTasks = ['fullstack', 'piano', 'japanese'].map(async (key) => {
    if (cancelled) return;
    const acct = ACCOUNTS[key];
    await loginAs(acct);
    await waitForStyleLoaded();
    await sleep(2000);
    snapshots.set(key, await captureSnapshot(acct.editorNodeId));
  });

  await Promise.all([...prefetchTasks, loadDemoStyles()]);

  // Preload background textures after styles are loaded
  if (demoStyles.value.length > 0) {
    loadingText.value = '正在预加载背景...';
    preloadBackgroundTextures();
    // Give textures a moment to start loading
    await sleep(500);
  }

  // Step 3: inject gamedev back so demo starts with gamedev tree
  loadingText.value = '正在准备播放...';
  const gamedevSnap = snapshots.get('gamedev')!;
  injectAccount(gamedevSnap);
  nodeStore.loadNode(null);
  await waitForSettle('display');

  // Step 4: build Phase 1 scene list
  const EDITOR_NODE = ACCOUNTS.gamedev.editorNodeId;
  phase1Scenes.value = [
    { id: 'editor',    label: '知识点详情',   accountKey: 'gamedev',   nodeId: EDITOR_NODE, durationMs: 2800 },
    { id: 'chat',      label: '对话生成',     accountKey: 'gamedev',   nodeId: EDITOR_NODE, durationMs: 2500,
      onEnter: () => window.dispatchEvent(new CustomEvent('cinema:chat-mode')) },
    { id: 'dailyquiz', label: '今日成长',     accountKey: 'gamedev',   viewState: 'daily_quiz', durationMs: 2500 },
    { id: 'overview',  label: '知识点概览',   accountKey: 'gamedev',   viewState: 'tree_overview', durationMs: 2500 },
    { id: 'tree',      label: '回到主页',     accountKey: 'gamedev',   nodeId: null, durationMs: 2000 },
  ];

  // Step 5: start Phase 1
  demoPhase.value = 'phase1';
  ready.value = true;

  // After Phase 1 scenes complete, transition to Phase 2
  // We hook into the advance timer: when the last scene timer fires, it wraps around.
  // Override: after last scene, auto-transition to Phase 2.
  const totalPhase1Ms = phase1Scenes.value.reduce((sum, s) => sum + s.durationMs, 0);
  advanceTimer = setTimeout(() => {
    transitionToPhase2();
  }, totalPhase1Ms);

  schedulePhase1Advance();
}

start();

onBeforeUnmount(() => {
  cancelled = true;
  clearAdvanceTimer();
  if (phase2AnimFrame) cancelAnimationFrame(phase2AnimFrame);
});
</script>

<style scoped>
.cinema-overlay {
  position: fixed; inset: 0; z-index: 200; pointer-events: none;
}

.cinema-loading {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px;
  z-index: 10;
  background: var(--bg-gradient, linear-gradient(180deg, #ffffff 0%, #eefaff 20%, #bfefff 55%, #66ccff 100%));
}
.loading-ring {
  width: 32px; height: 32px;
  border: 3px solid rgba(128,128,128,0.2);
  border-top-color: var(--color-primary, #6680ff);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.loading-text {
  font-size: 15px; color: var(--color-hint, #888); margin: 0;
  font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
}

.cinema-controls {
  position: absolute;
  bottom: 20px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px; border-radius: 24px;
  background: rgba(0,0,0,0.45);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.1);
  z-index: 10; pointer-events: auto;
}
.ctrl-btn {
  width: 28px; height: 28px; border: none; border-radius: 50%;
  background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; font-family: inherit;
}
.ctrl-btn:hover { background: rgba(255,255,255,0.2); color: #fff; }
.ctrl-btn:disabled { opacity: 0.3; cursor: default; }
.ctrl-dots { display: flex; align-items: center; gap: 6px; margin: 0 4px; }
.ctrl-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: rgba(255,255,255,0.3); cursor: pointer; transition: all 0.25s ease;
}
.ctrl-dot.active { width: 18px; border-radius: 3px; background: rgba(255,255,255,0.85); }
.ctrl-label {
  font-size: 12px; color: rgba(255,255,255,0.6); margin-left: 6px;
  white-space: nowrap; font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
}

.blackout-overlay {
  position: absolute; inset: 0;
  background: #000;
  z-index: 15;
}

.done-label {
  position: absolute;
  bottom: 40px; left: 50%; transform: translateX(-50%);
  font-size: 28px; font-weight: 800; letter-spacing: 0.15em;
  color: var(--color-primary, #6680ff);
  z-index: 10;
  font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
}

.fade-enter-active { transition: opacity 0.4s ease; }
.fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
