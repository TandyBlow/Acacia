<template>
  <main class="layout">
    <section class="logo-area">
      <div class="inset-shell static-shell">
        <LogoArea />
      </div>
    </section>

    <section class="breadcrumbs-area">
      <div class="inset-shell static-shell">
        <Breadcrumbs />
      </div>
    </section>

    <section class="navigation-area">
      <div class="inset-shell static-shell">
        <Navigation />
      </div>
    </section>

    <section class="content-area">
      <GlassWrapper inset class="content-well">
        <GlassWrapper class="content-surface">
          <Transition name="content-fade" mode="out-in">
            <component :is="currentContent" :key="contentKey" class="content-host" />
          </Transition>
        </GlassWrapper>
      </GlassWrapper>
    </section>

    <section class="knob-area">
      <Knob />
    </section>

    <div v-if="isBusy" class="busy-mask" />
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { storeToRefs } from 'pinia';
import GlassWrapper from '../components/ui/GlassWrapper.vue';
import LogoArea from '../components/layout/LogoArea.vue';
import Breadcrumbs from '../components/layout/Breadcrumbs.vue';
import Navigation from '../components/layout/Navigation.vue';
import Knob from '../components/layout/Knob.vue';
import ConfirmPanel from '../components/ui/ConfirmPanel.vue';
import GlobalTree from '../components/tree/GlobalTree.vue';
import MarkdownEditor from '../components/editor/MarkdownEditor.vue';
import AuthPanel from '../components/auth/AuthPanel.vue';
import { useNodeStore } from '../stores/nodeStore';
import { useAuthStore } from '../stores/authStore';

const nodeStore = useNodeStore();
const authStore = useAuthStore();
const { viewState, isBusy: nodeBusy, activeNode } = storeToRefs(nodeStore);
const {
  initialized: authInitialized,
  mode: authMode,
  isAuthenticated,
  isBusy: authBusy,
} = storeToRefs(authStore);

const isBusy = computed(() => nodeBusy.value || authBusy.value);

const currentContent = computed(() => {
  if (!isAuthenticated.value) {
    return AuthPanel;
  }
  if (viewState.value === 'move') {
    return GlobalTree;
  }
  if (viewState.value === 'add' || viewState.value === 'delete' || viewState.value === 'logout') {
    return ConfirmPanel;
  }
  return MarkdownEditor;
});

const contentKey = computed(() => {
  if (!isAuthenticated.value) {
    return `auth:${authMode.value}`;
  }
  return `${viewState.value}:${activeNode.value?.id ?? 'home'}`;
});

onMounted(async () => {
  await authStore.initialize();
  if (isAuthenticated.value) {
    await nodeStore.initialize();
  }
});

watch(
  [authInitialized, isAuthenticated],
  async ([ready, authenticated], [_prevReady, prevAuthenticated]) => {
    if (!ready) {
      return;
    }
    if (authenticated && !prevAuthenticated) {
      await nodeStore.initialize();
    }
  },
);
</script>

<style scoped>
.layout {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  padding: 38px;
  display: grid;
  grid-template-columns: 241px minmax(0, 1fr) 104px;
  grid-template-rows: minmax(0, 1fr) minmax(0, 9fr);
  gap: 12px;
}

.logo-area,
.breadcrumbs-area,
.navigation-area,
.content-area,
.knob-area {
  min-width: 0;
  min-height: 0;
}

.logo-area {
  grid-column: 1;
  grid-row: 1;
}

.breadcrumbs-area {
  grid-column: 2;
  grid-row: 1;
}

.navigation-area {
  grid-column: 1;
  grid-row: 2;
}

.content-area {
  grid-column: 2;
  grid-row: 2;
}

.knob-area {
  grid-column: 3;
  grid-row: 1 / span 2;
  align-self: stretch;
  justify-self: stretch;
}

.inset-shell {
  width: 100%;
  height: 100%;
  padding: 1px;
  border-radius: 24px;
  border: 1px solid rgba(109, 138, 255, 0.2);
  background: rgba(255, 255, 255, 0.06);
  box-shadow:
    inset 9px 9px 18px rgba(38, 85, 108, 0.56),
    inset -9px -9px 18px rgba(148, 241, 255, 0.52);
  overflow: hidden;
}

.static-shell {
  min-width: 0;
  min-height: 0;
}

.content-well {
  width: 100%;
  height: 100%;
  padding: 2px;
}

.content-surface,
.content-host {
  width: 100%;
  height: 100%;
}

.content-host {
  overflow: auto;
}

.busy-mask {
  position: absolute;
  inset: 38px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(3px);
  z-index: 20;
  animation: busy-pulse 1.2s ease-in-out infinite;
}

.content-fade-enter-active,
.content-fade-leave-active {
  transition:
    opacity 240ms ease,
    transform 240ms ease;
}

.content-fade-enter-from,
.content-fade-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.985);
}

@keyframes busy-pulse {
  0%,
  100% {
    opacity: 0.5;
  }

  50% {
    opacity: 0.85;
  }
}

@media (max-width: 1100px) {
  .layout {
    padding: 16px;
    grid-template-columns: 241px minmax(0, 1fr);
    grid-template-rows: 96px minmax(0, 1fr) 132px;
    row-gap: 10px;
    column-gap: 0;
  }

  .logo-area {
    grid-column: 1;
    grid-row: 1;
  }

  .breadcrumbs-area {
    grid-column: 2;
    grid-row: 1;
  }

  .navigation-area {
    grid-column: 1;
    grid-row: 2;
  }

  .content-area {
    grid-column: 2;
    grid-row: 2;
  }

  .knob-area {
    grid-column: 1 / span 2;
    grid-row: 3;
    justify-self: center;
    width: min(100%, 260px);
  }

  .busy-mask {
    inset: 16px;
  }
}
</style>
