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

    <section class="merged-area">
      <div class="merged-shell inset-shell static-shell">
        <section class="navigation-area">
          <div class="inset-shell static-shell navigation-shell">
            <Navigation />
          </div>
        </section>

        <section class="content-area">
          <GlassWrapper inset class="content-well content-shell">
            <GlassWrapper class="content-surface">
              <Transition name="content-fade" mode="out-in">
                <component :is="currentContent" :key="contentKey" class="content-host" />
              </Transition>
            </GlassWrapper>
          </GlassWrapper>
        </section>
      </div>
    </section>

    <section class="knob-area">
      <Knob />
    </section>

    <div v-if="isBusy" class="busy-mask" />
  </main>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import GlassWrapper from '../components/ui/GlassWrapper.vue';
import LogoArea from '../components/layout/LogoArea.vue';
import Breadcrumbs from '../components/layout/Breadcrumbs.vue';
import Navigation from '../components/layout/Navigation.vue';
import Knob from '../components/layout/Knob.vue';
import ConfirmPanel from '../components/ui/ConfirmPanel.vue';
import GlobalTree from '../components/tree/GlobalTree.vue';
import TreeCanvas from '../components/tree/TreeCanvas.vue';
import MarkdownEditor from '../components/editor/MarkdownEditor.vue';
import AuthPanel from '../components/auth/AuthPanel.vue';
import { useNodeStore } from '../stores/nodeStore';
import { useAuthStore } from '../stores/authStore';
import { useAppInit } from '../composables/useAppInit';
import { useKnobDispatch } from '../composables/useKnobDispatch';

const nodeStore = useNodeStore();
const authStore = useAuthStore();
const { activeNode } = storeToRefs(nodeStore);
const {
  mode: authMode,
  isAuthenticated,
} = storeToRefs(authStore);

const { isBusy } = useAppInit();
const { isLoggingOut } = useKnobDispatch();

const currentContent = computed(() => {
  if (!isAuthenticated.value) {
    return AuthPanel;
  }
  if (nodeStore.isTreeState) {
    return GlobalTree;
  }
  if (nodeStore.isConfirmState || isLoggingOut.value) {
    return ConfirmPanel;
  }
  if (!activeNode.value) {
    return TreeCanvas;
  }
  return MarkdownEditor;
});

const contentKey = computed(() => {
  if (!isAuthenticated.value) {
    return `auth:${authMode.value}`;
  }
  const state = isLoggingOut.value ? 'logout' : nodeStore.viewState;
  return `${state}:${activeNode.value?.id ?? 'home'}`;
});

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
.merged-area,
.navigation-area,
.content-area,
.knob-area {
  min-width: 0;
  min-height: 0;
}

.merged-area,
.merged-shell {
  display: contents;
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
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.06);
  box-shadow:
    inset 9px 9px 18px var(--shadow-inset-a),
    inset -9px -9px 18px var(--shadow-inset-b);
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
    grid-template-rows: minmax(0, 1fr) minmax(0, 9fr) 132px;
    row-gap: 10px;
    column-gap: 10px;
  }

  .logo-area {
    grid-column: 1;
    grid-row: 1;
  }

  .breadcrumbs-area {
    grid-column: 2;
    grid-row: 1;
  }

  .merged-area {
    display: block;
    grid-column: 1 / span 2;
    grid-row: 2;
    min-width: 0;
    min-height: 0;
  }

  .merged-shell {
    display: grid;
    width: 100%;
    height: 100%;
    grid-template-columns: 241px minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    column-gap: 0;
    row-gap: 0;
  }

  .navigation-shell,
  .content-shell {
    display: contents;
  }

  .navigation-area {
    grid-column: 1;
    grid-row: 1;
  }

  .content-area {
    grid-column: 2;
    grid-row: 1;
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
