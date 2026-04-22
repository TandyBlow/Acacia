<template>
  <main class="layout" :class="layoutClasses">
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
              <div v-show="showTree" class="content-host"><TreeCanvas /></div>
              <Transition v-if="!showTree" name="content-fade" mode="out-in">
                <component :is="nonTreeContent" :key="contentKey" class="content-host" />
              </Transition>
            </GlassWrapper>
          </GlassWrapper>
          <AiGeneratePopup v-if="isAuthenticated && !isFeaturePanel" />
        </section>
      </div>
    </section>

  <section class="knob-area">
      <Knob />
    </section>

  </main>
</template>

<script setup lang="ts">
import { computed, inject, ref, onMounted, onBeforeUnmount, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import GlassWrapper from '../components/ui/GlassWrapper.vue';
import LogoArea from '../components/layout/LogoArea.vue';
import Breadcrumbs from '../components/layout/Breadcrumbs.vue';
import Navigation from '../components/layout/Navigation.vue';
import Knob from '../components/layout/Knob.vue';
import ConfirmPanel from '../components/ui/ConfirmPanel.vue';
import FeaturePanel from '../components/ui/FeaturePanel.vue';
import GlobalTree from '../components/tree/GlobalTree.vue';
import TreeCanvas from '../components/tree/TreeCanvas.vue';
import MarkdownEditor from '../components/editor/MarkdownEditor.vue';
import AuthPanel from '../components/auth/AuthPanel.vue';
import AiGeneratePopup from '../components/ai/AiGeneratePopup.vue';
import { useNodeStore } from '../stores/nodeStore';
import { useAuthStore } from '../stores/authStore';
import { useAppInit } from '../composables/useAppInit';
import { useKnobDispatch } from '../composables/useKnobDispatch';
import { COMPACT_BREAKPOINT } from '../constants/app';

const nodeStore = useNodeStore();
const authStore = useAuthStore();
const { activeNode } = storeToRefs(nodeStore);
const {
  mode: authMode,
  isAuthenticated,
} = storeToRefs(authStore);

useAppInit();
const { isLoggingOut, isFeaturePanel, compactMode, isCompactLayout } = useKnobDispatch();

const { isBusy: nodeBusy } = storeToRefs(nodeStore);
const { isBusy: authBusy } = storeToRefs(authStore);
const isBusy = computed(() => nodeBusy.value || authBusy.value);
const injectedTreeResizing = inject<Ref<boolean> | null>('isTreeResizing', null);
const isTreeResizing = computed(() => injectedTreeResizing?.value ?? false);
const isLoading = computed(() => isBusy.value || isTreeResizing.value);

// Compact layout tracking
const isCompact = ref(false);

function updateCompactState(): void {
  isCompact.value = window.innerWidth <= COMPACT_BREAKPOINT;
  isCompactLayout.value = isCompact.value;
  if (!isCompact.value) {
    compactMode.value = 'content';
  } else if (isFeaturePanel.value) {
    compactMode.value = 'feature';
  }
}

onMounted(() => {
  updateCompactState();
  window.addEventListener('resize', updateCompactState);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateCompactState);
});

watch(isFeaturePanel, (open) => {
  if (isCompact.value && open && compactMode.value !== 'feature') {
    compactMode.value = 'feature';
  }
});

const layoutClasses = computed(() => ({
  'is-loading': isLoading.value,
  'compact': isCompact.value,
  'compact-content': isCompact.value && compactMode.value === 'content',
  'compact-nav': isCompact.value && compactMode.value === 'nav',
  'compact-feature': isCompact.value && compactMode.value === 'feature',
}));

const showTree = computed(() => {
  return isAuthenticated.value && !activeNode.value && !nodeStore.isConfirmState && !isLoggingOut.value && !isFeaturePanel.value;
});

const nonTreeContent = computed(() => {
  if (!isAuthenticated.value) {
    return AuthPanel;
  }
  if (isFeaturePanel.value) {
    return FeaturePanel;
  }
  if (nodeStore.isTreeState) {
    return GlobalTree;
  }
  if (nodeStore.isConfirmState || isLoggingOut.value) {
    return ConfirmPanel;
  }
  return MarkdownEditor;
});

const contentKey = computed(() => {
  if (!isAuthenticated.value) {
    return `auth:${authMode.value}`;
  }
  if (isFeaturePanel.value) {
    return 'feature-panel';
  }
  const state = isLoggingOut.value ? 'logout' : nodeStore.viewState;
  return `${state}:${activeNode.value?.id ?? 'editor'}`;
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
  grid-template-columns: 241px minmax(0, 1fr) 82px;
  grid-template-rows: auto minmax(0, 1fr);
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
  position: relative;
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

.is-loading .breadcrumbs-area,
.is-loading .navigation-area,
.is-loading .content-area,
.is-loading .knob-area {
  color: transparent;
}

.is-loading .breadcrumbs-area :deep(*),
.is-loading .navigation-area :deep(*),
.is-loading .content-area :deep(*),
.is-loading .knob-area :deep(*) {
  color: transparent !important;
}

.is-loading .content-area :deep(input),
.is-loading .content-area :deep(textarea) {
  caret-color: transparent;
}

@media (max-width: 1100px) {
  .layout {
    padding: 16px;
    grid-template-columns: 241px minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) 100px;
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
}

@media (max-width: 600px) {
  .layout {
    padding: 8px;
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .merged-area,
  .merged-shell {
    display: contents !important;
  }

  .navigation-shell,
  .content-shell {
    display: contents !important;
  }

  /* Compact content mode: content + knob */
  .layout.compact-content {
    grid-template-rows: minmax(0, 1fr) 90px;
  }

  .layout.compact-content .logo-area,
  .layout.compact-content .breadcrumbs-area,
  .layout.compact-content .navigation-area {
    display: none;
  }

  .layout.compact-content .content-area {
    grid-column: 1;
    grid-row: 1;
  }

  .layout.compact-content .knob-area {
    grid-column: 1;
    grid-row: 2;
    justify-self: center;
    width: min(100%, 260px);
  }

  /* Compact nav mode: breadcrumbs + navigation + knob */
  .layout.compact-nav {
    grid-template-rows: auto minmax(0, 1fr) 90px;
  }

  .layout.compact-nav .logo-area,
  .layout.compact-nav .content-area {
    display: none;
  }

  .layout.compact-nav .breadcrumbs-area {
    grid-column: 1;
    grid-row: 1;
  }

  .layout.compact-nav .navigation-area {
    grid-column: 1;
    grid-row: 2;
  }

  .layout.compact-nav .knob-area {
    grid-column: 1;
    grid-row: 3;
    justify-self: center;
    width: min(100%, 260px);
  }

  /* Compact feature mode: feature panel + knob */
  .layout.compact-feature {
    grid-template-rows: minmax(0, 1fr) 90px;
  }

  .layout.compact-feature .logo-area,
  .layout.compact-feature .breadcrumbs-area,
  .layout.compact-feature .navigation-area {
    display: none;
  }

  .layout.compact-feature .content-area {
    grid-column: 1;
    grid-row: 1;
  }

  .layout.compact-feature .knob-area {
    grid-column: 1;
    grid-row: 2;
    justify-self: center;
    width: min(100%, 260px);
  }
}
</style>
