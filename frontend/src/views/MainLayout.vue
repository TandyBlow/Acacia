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
          <div class="content-host">
            <GlobalTree v-if="viewState === 'move'" />
            <ConfirmPanel v-else-if="viewState === 'add' || viewState === 'delete'" />
            <MarkdownEditor v-else />
          </div>
        </GlassWrapper>
      </GlassWrapper>
    </section>

    <section class="knob-area">
      <Knob />
    </section>

    <div v-if="isBusy" class="busy-mask">处理中...</div>
    <p v-if="errorMessage" class="error-msg">{{ errorMessage }}</p>
  </main>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import GlassWrapper from '../components/ui/GlassWrapper.vue';
import LogoArea from '../components/layout/LogoArea.vue';
import Breadcrumbs from '../components/layout/Breadcrumbs.vue';
import Navigation from '../components/layout/Navigation.vue';
import Knob from '../components/layout/Knob.vue';
import ConfirmPanel from '../components/ui/ConfirmPanel.vue';
import GlobalTree from '../components/tree/GlobalTree.vue';
import MarkdownEditor from '../components/editor/MarkdownEditor.vue';
import { useNodeStore } from '../stores/nodeStore';

const store = useNodeStore();
const { viewState, isBusy, errorMessage } = storeToRefs(store);

onMounted(async () => {
  await store.initialize();
});
</script>

<style scoped>
.layout {
  position: relative;
  width: 100%;
  height: 100%;
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
  padding: 2px;
  border-radius: 24px;
  border: 1px solid rgba(109, 138, 255, 0.22);
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

.busy-mask {
  position: absolute;
  inset: 38px;
  display: grid;
  place-items: center;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(3px);
  z-index: 20;
  font-size: 18px;
  color: var(--color-hint);
}

.error-msg {
  position: absolute;
  left: 48px;
  right: 120px;
  bottom: 22px;
  margin: 0;
  font-size: 12px;
  color: var(--color-hint);
  pointer-events: none;
}

@media (max-width: 1100px) {
  .layout {
    padding: 16px;
    grid-template-columns: 1fr;
    grid-template-rows: 96px 72px minmax(220px, 1fr) minmax(280px, 1.2fr) 132px;
    gap: 10px;
  }

  .logo-area {
    grid-column: 1;
    grid-row: 1;
  }

  .breadcrumbs-area {
    grid-column: 1;
    grid-row: 2;
  }

  .navigation-area {
    grid-column: 1;
    grid-row: 3;
  }

  .content-area {
    grid-column: 1;
    grid-row: 4;
  }

  .knob-area {
    grid-column: 1;
    grid-row: 5;
    justify-self: center;
    width: min(100%, 260px);
  }

  .busy-mask {
    inset: 16px;
  }

  .error-msg {
    left: 22px;
    right: 22px;
  }
}
</style>
