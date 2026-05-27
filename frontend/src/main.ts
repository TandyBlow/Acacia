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
// Strategy: always track viewport height on resize (when keyboard is
// inactive) so preKeyboardHeight is fresh regardless of whether focusin
// or resize fires first when the keyboard appears.  On phones focusin
// usually fires first; on tablets resize often fires first.

let preKeyboardHeight = window.innerHeight;
let keyboardActive = false;

function lockHeight(): void {
  document.documentElement.style.setProperty('--app-height', `${preKeyboardHeight}px`);
}

function unlockHeight(): void {
  document.documentElement.style.removeProperty('--app-height');
}

// Detect keyboard open.  Don't re-capture preKeyboardHeight here —
// the resize handler (below) already keeps it current so it is always
// the last known full-height before the keyboard appeared, even when
// resize fires before focusin on tablets.
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
        return; // focus just moved to another input — keep locked
      }
      keyboardActive = false;
      unlockHeight();
    }, 300);
  }
});

// While keyboard is open, keep pushing the pre-keyboard height back.
// While keyboard is closed, keep preKeyboardHeight current so it's
// always ready when the keyboard opens (resize fires before focusin
// on some tablets).
window.addEventListener('resize', () => {
  if (keyboardActive) {
    lockHeight();
  } else {
    preKeyboardHeight = window.innerHeight;
  }
});

// visualViewport also fires when keyboard appears — same lock
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
