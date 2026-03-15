<template>
  <main class="layout">
    <section class="logo-area">
      <GlassWrapper inset class="cell-shell">
        <LogoArea />
      </GlassWrapper>
    </section>

    <section class="breadcrumbs-area">
      <GlassWrapper inset class="cell-shell">
        <Breadcrumbs />
      </GlassWrapper>
    </section>

    <section class="navigation-area">
      <GlassWrapper inset class="cell-shell">
        <Navigation />
      </GlassWrapper>
    </section>

    <section class="content-area">
      <GlassWrapper inset class="cell-shell">
        <div class="content-host">
          <GlobalTree v-if="viewState === 'move'" />
          <ConfirmPanel v-else-if="viewState === 'add' || viewState === 'delete'" />
          <MarkdownEditor v-else />
        </div>
      </GlassWrapper>
    </section>

    <section class="knob-area">
      <Knob />
    </section>

    <div v-if="isBusy" class="busy-mask">处理中...</div>
    <p v-if="errorMessage" class="error-msg">{{ errorMessage }}</p>
    <p class="status-msg">{{ statusMessage }}</p>
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
const { viewState, isBusy, errorMessage, statusMessage } = storeToRefs(store);

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
  grid-template-rows: 182px 1fr;
  gap: 12px;
}

.logo-area {
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
  min-height: 0;
}

.breadcrumbs-area {
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  min-height: 0;
}

.navigation-area {
  grid-column: 1;
  grid-row: 2;
  min-width: 0;
  min-height: 0;
}

.content-area {
  grid-column: 2;
  grid-row: 2;
  min-width: 0;
  min-height: 0;
}

.knob-area {
  grid-column: 3;
  grid-row: 1 / span 2;
  align-self: stretch;
  justify-self: stretch;
  min-width: 0;
  min-height: 0;
}

.cell-shell {
  width: 100%;
  height: 100%;
  padding: 6px;
}

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
  background: rgba(9, 44, 56, 0.25);
  backdrop-filter: blur(3px);
  z-index: 20;
  font-size: 18px;
}

.error-msg,
.status-msg {
  position: absolute;
  left: 48px;
  right: 120px;
  margin: 0;
  font-size: 12px;
  pointer-events: none;
}

.error-msg {
  bottom: 40px;
  color: #ffd2d2;
}

.status-msg {
  bottom: 22px;
  opacity: 0.85;
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

  .error-msg,
  .status-msg {
    left: 22px;
    right: 22px;
  }
}
</style>
