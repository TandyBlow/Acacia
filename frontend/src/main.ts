import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import App from './App.vue';
import router from './router';
import { setAuthAdapter } from './stores/authStore';
import { setDataAdapter } from './stores/nodeStore';
import { loadAdapters } from './adapters';
import './style.css';
import './styles/transition.css';

// ── Safe area detection ──────────────────────────────────────────────
// env(safe-area-inset-bottom) works on Safari/iOS and Chrome/Android
// but returns 0 on Firefox, Xiaomi browsers, and many WebViews.
// Measure it via JS so we can apply a fallback when the CSS env()
// doesn't deliver a real value.

function measureSafeAreaBottom(): number {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;bottom:0;height:1px;' +
    'padding-bottom:env(safe-area-inset-bottom,0px);' +
    'pointer-events:none;z-index:-1;';
  document.body.appendChild(el);
  const val = parseFloat(getComputedStyle(el).paddingBottom) || 0;
  document.body.removeChild(el);
  return val;
}

const safeBottom = measureSafeAreaBottom();

if (safeBottom > 0) {
  document.documentElement.style.setProperty('--safe-bottom', `${safeBottom}px`);
} else if (window.innerWidth <= 600) {
  // env() returned 0 on a mobile-width viewport — likely a browser
  // that doesn't report safe-area-inset (Firefox, Xiaomi, WebView).
  // Estimate persistent bars from the gap between screen height and
  // viewport height, with a 16px floor.
  const screenGap = (window.screen?.height || 0) - window.innerHeight;
  const fallback = Math.max(16, Math.min(48, Math.round(screenGap)));
  document.documentElement.style.setProperty('--safe-bottom', `${fallback}px`);
}

// ── Keyboard-stable layout ──────────────────────────────────────────
// Strategy: detect keyboard appearance by the signature of a sudden
// height drop (>100px) without a significant width change (<50px).
// This works regardless of whether focusin or resize fires first —
// on phones focusin usually leads, on tablets resize often leads.

let preKeyboardHeight = window.innerHeight;
let keyboardActive = false;
// Track last known dimensions to detect sudden drops
let lastKnownFullHeight = window.innerHeight;
let lastKnownFullWidth = window.innerWidth;

function lockHeight(): void {
  document.documentElement.style.setProperty('--app-height', `${preKeyboardHeight}px`);
}

function unlockHeight(): void {
  document.documentElement.style.removeProperty('--app-height');
}

// focusin serves as a confirmation signal — if the resize-based
// detection missed the keyboard (unusual tablet behavior), this
// catches it.  Does NOT re-capture preKeyboardHeight; resize handler
// already set it before the height dropped.
document.addEventListener('focusin', (e: Event) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    if (!keyboardActive) {
      keyboardActive = true;
      lockHeight();
    }
  }
});

// Restore after keyboard closes.  Delay and re-check so that
// tapping between two inputs doesn't briefly unlock the height.
document.addEventListener('focusout', () => {
  if (keyboardActive) {
    setTimeout(() => {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
        return;
      }
      keyboardActive = false;
      unlockHeight();
    }, 300);
  }
});

// Primary keyboard detection: height drops >100px with stable width
// is the keyboard appearing.  Height recovering to near pre-keyboard
// level is the keyboard closing.
window.addEventListener('resize', () => {
  const h = window.innerHeight;
  const w = window.innerWidth;

  if (keyboardActive) {
    // Height recovered? Keyboard closed (covers both dismissing the
    // keyboard and rotating the device while keyboard is open).
    if (h >= preKeyboardHeight - 50) {
      keyboardActive = false;
      unlockHeight();
      lastKnownFullHeight = h;
      lastKnownFullWidth = w;
    } else {
      lockHeight();
    }
  } else {
    const heightDrop = lastKnownFullHeight - h;
    const widthChange = Math.abs(lastKnownFullWidth - w);

    if (heightDrop > 100 && widthChange < 50) {
      // Keyboard appeared — lock to the last full height
      preKeyboardHeight = lastKnownFullHeight;
      keyboardActive = true;
      lockHeight();
    } else {
      // Update tracking, but skip gradual height decreases with stable
      // width: those are keyboard animation intermediate frames.  Only
      // update on rotation (large width change) or height increase.
      const isGradualDrop = heightDrop > 0 && heightDrop <= 100 && widthChange < 50;
      if (!isGradualDrop) {
        lastKnownFullHeight = h;
        lastKnownFullWidth = w;
        preKeyboardHeight = h;
      }
    }
  }
});

// visualViewport also fires when keyboard appears — same logic
window.visualViewport?.addEventListener('resize', () => {
  if (keyboardActive) {
    lockHeight();
  }
});

// VirtualKeyboard API (Chrome/Edge) — tell browser to overlay
if ('virtualKeyboard' in navigator) {
  (navigator as { virtualKeyboard?: { overlaysContent: boolean } }).virtualKeyboard!.overlaysContent = true;
}

// ── App bootstrap ────────────────────────────────────────────────────

const app = createApp(App);
const pinia = createPinia();

pinia.use(piniaPluginPersistedstate);

app.use(pinia);

async function bootstrap(): Promise<void> {
  const { data, auth } = await loadAdapters();

  setAuthAdapter(auth);
  setDataAdapter(data);
  app.use(router);
  app.mount('#app');
}

bootstrap();
