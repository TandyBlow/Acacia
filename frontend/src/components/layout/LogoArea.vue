<template>
  <div class="logo-area">
    <p class="logo-title">Acacia <span class="logo-version">v0.1.{{ gitCommitCount }}</span></p>
  </div>
</template>

<script setup lang="ts">
const gitCommitCount = __GIT_COMMIT_COUNT__;
</script>

<style scoped>
.logo-area {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  padding: 0 14px;
}

.logo-title {
  margin: 0;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: 0.8px;
  color: var(--color-primary-on-light, var(--color-primary));
}

.logo-version {
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.3px;
  color: var(--color-secondary, rgba(102, 128, 255, 0.55));
  vertical-align: super;
}
</style>
