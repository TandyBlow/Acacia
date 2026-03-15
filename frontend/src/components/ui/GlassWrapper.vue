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
  transition: transform 140ms ease, box-shadow 160ms ease, border-color 160ms ease;
  border: 1px solid var(--color-glass-border);
  overflow: hidden;
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
    7px 7px 14px rgba(26, 64, 83, 0.35),
    -7px -7px 14px rgba(143, 237, 255, 0.35);
}

.glass-inset {
  box-shadow:
    inset 9px 9px 18px rgba(38, 85, 108, 0.56),
    inset -9px -9px 18px rgba(148, 241, 255, 0.52);
  border-color: rgba(109, 138, 255, 0.28);
}

.glass-pressed {
  transform: translateY(2px) scale(0.994);
  box-shadow:
    inset 6px 6px 10px rgba(30, 69, 89, 0.65),
    inset -5px -5px 10px rgba(127, 224, 247, 0.35);
}

.glass-interactive {
  cursor: pointer;
}
</style>
