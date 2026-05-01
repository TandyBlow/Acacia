import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import App from './App.vue';
import router from './router';
import { setAuthAdapter } from './stores/authStore';
import { setNavigator, setDataAdapter } from './stores/nodeStore';
import { loadAdapters } from './adapters';
import './style.css';

// ── Keyboard-stable layout ──────────────────────────────────────────
// Strategy: capture viewport height BEFORE keyboard appears (on focusin),
// lock html to that height while keyboard is visible, unlock on focusout.
// This is the approach used by production PWAs and hybrid apps.

let preKeyboardHeight = 0;
let keyboardActive = false;

function lockHeight(): void {
  document.documentElement.style.setProperty('--app-height', `${preKeyboardHeight}px`);
}

function unlockHeight(): void {
  document.documentElement.style.removeProperty('--app-height');
}

// Capture height before keyboard opens
document.addEventListener('focusin', (e: Event) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    if (!keyboardActive) {
      preKeyboardHeight = window.innerHeight;
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

// Reinforce lock during keyboard — the browser may fire resize events
// while keyboard is open; we keep pushing the pre-keyboard height back.
window.addEventListener('resize', () => {
  if (keyboardActive) {
    lockHeight();
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
  setNavigator(
    (path, replace) => {
      if (replace) {
        router.replace(path);
      } else {
        router.push(path);
      }
    },
    () => (router.currentRoute.value.params.id as string) || null,
  );

  app.use(router);
  app.mount('#app');
}

bootstrap();
