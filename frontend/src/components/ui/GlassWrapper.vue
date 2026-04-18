<template>
  <div
    class="glass"
    :class="[
      inset ? 'glass-inset' : 'glass-raised',
      shape === 'circle' ? 'glass-circle' : 'glass-rect',
      { 'glass-pressed': pressed, 'glass-interactive': interactive },
    ]"
  >
    <div class="glass-content">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  inset?: boolean;
  pressed?: boolean;
  interactive?: boolean;
  shape?: 'rect' | 'circle';
}>();
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
    5px 5px 10px rgba(49, 78, 151, 0.14),
    -5px -5px 10px rgba(255, 255, 255, 0.28);
}

.glass-inset {
  box-shadow:
    inset 9px 9px 18px rgba(38, 85, 108, 0.56),
    inset -9px -9px 18px rgba(148, 241, 255, 0.52);
  border-color: rgba(109, 138, 255, 0.28);
}

.glass-pressed {
  transform: none;
  box-shadow: none;
  border-color: transparent;
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
