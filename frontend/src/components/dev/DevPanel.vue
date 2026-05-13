<template>
  <Teleport to="body">
    <div v-if="isExpanded" class="dev-panel-glass">
      <div class="dev-panel-header">
        <span class="dev-panel-title">开发者面板</span>
        <button class="dev-panel-close" @click="isExpanded = false">−</button>
      </div>
      <div class="dev-panel-body">
        <div class="dev-toggle-row">
          <span class="dev-toggle-label">页面切换动画</span>
          <button
            type="button"
            class="dev-toggle"
            :class="{ on: devStore.enableTransition }"
            @click.stop="devStore.toggleTransition()"
          >
            <span class="dev-toggle-thumb" />
          </button>
        </div>
        <div class="dev-toggle-row">
          <span class="dev-toggle-label">上升/下沉动画</span>
          <button
            type="button"
            class="dev-toggle"
            :class="{ on: devStore.enableRiseSink }"
            @click.stop="devStore.toggleRiseSink()"
          >
            <span class="dev-toggle-thumb" />
          </button>
        </div>
      </div>
    </div>
    <button v-else class="dev-panel-trigger" @click="isExpanded = true">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="9" cy="9" r="2.5" />
        <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M3.7 14.3l1.4-1.4M12.9 5.1l1.4-1.4" />
      </svg>
    </button>
  </Teleport>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useDevStore } from '../../stores/devStore';

const devStore = useDevStore();
const isExpanded = ref(false);
</script>

<style scoped>
.dev-panel-glass {
  position: fixed;
  bottom: 20px;
  left: 20px;
  z-index: 1000;
  min-width: 220px;
  border: 1px solid var(--color-glass-border);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow:
    5px 5px 10px var(--shadow-raised-a),
    -5px -5px 10px var(--shadow-raised-b);
  overflow: hidden;
}

.dev-panel-trigger {
  position: fixed;
  bottom: 20px;
  left: 20px;
  z-index: 1000;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow:
    5px 5px 10px var(--shadow-raised-a),
    -5px -5px 10px var(--shadow-raised-b);
  color: var(--color-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: box-shadow 160ms ease, background 160ms ease;
}

.dev-panel-trigger:hover {
  background: rgba(255, 255, 255, 0.12);
}

.dev-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px 6px;
}

.dev-panel-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-primary);
  opacity: 0.7;
}

.dev-panel-close {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-primary);
  opacity: 0.5;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  line-height: 1;
}

.dev-panel-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 14px 12px;
}

.dev-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  user-select: none;
}

.dev-toggle-label {
  font-size: 13px;
  color: var(--color-primary);
  opacity: 0.75;
}

.dev-toggle {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: 11px;
  border: 1px solid var(--color-glass-border);
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 160ms ease, border-color 160ms ease;
}

.dev-toggle.on {
  background: rgba(102, 255, 229, 0.25);
  border-color: rgba(102, 255, 229, 0.35);
}

.dev-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-primary);
  opacity: 0.6;
  transition: transform 160ms ease, opacity 160ms ease;
}

.dev-toggle.on .dev-toggle-thumb {
  transform: translateX(18px);
  opacity: 1;
  background: rgba(102, 255, 229, 0.9);
}
</style>
