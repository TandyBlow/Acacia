<template>
  <div
    class="glass"
    :class="[
      inset ? 'glass-inset' : 'glass-raised',
      shape === 'circle' ? 'glass-circle' : 'glass-rect',
      {
        'glass-pressed': (pressed || isBusy) && !inset,
        'glass-interactive': interactive,
      },
    ]"
  >
    <div class="glass-content">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, type Ref } from 'vue';

const props = defineProps<{
  inset?: boolean;
  pressed?: boolean;
  interactive?: boolean;
  shape?: 'rect' | 'circle';
}>();

const injectedBusy = inject<Ref<boolean> | null>('isBusy', null);
const isBusy = computed(() => injectedBusy?.value ?? false);
</script>

<style scoped>
.glass {
  width: 100%;
  height: 100%;
  transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease,
              background 160ms ease, backdrop-filter 160ms ease, -webkit-backdrop-filter 160ms ease;
  border: 1px solid var(--color-glass-border);
  overflow: hidden;
  will-change: transform, box-shadow;
}

.glass-rect {
  border-radius: 24px;
}

.glass-circle {
  border-radius: 50%;
}

.glass-content {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: var(--color-glass-bg);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.glass-raised {
  box-shadow:
    5px 5px 10px var(--shadow-raised-a),
    -5px -5px 10px var(--shadow-raised-b);
}

.glass-inset {
  box-shadow:
    inset 9px 9px 18px var(--shadow-inset-a),
    inset -9px -9px 18px var(--shadow-inset-b);
  border-color: var(--color-glass-border);
}

.glass-pressed {
  transform: none;
  box-shadow: none;
  border-color: rgba(255, 255, 255, 0.12);
}

.glass-pressed .glass-content {
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.glass-interactive {
  cursor: pointer;
}
</style>
