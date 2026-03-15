<template>
  <div class="logo-area">
    <div class="logo-mark">SW</div>
    <div class="logo-text-block">
      <p class="logo-title">SeeWhat</p>
      <p class="logo-subtitle">知识图谱</p>
    </div>
  </div>
</template>

<style scoped>
.logo-area {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 0 16px;
  user-select: none;
  color: var(--color-primary);
}

.logo-mark {
  font-size: 30px;
  font-weight: 800;
  letter-spacing: 1.2px;
  line-height: 1;
}

.logo-text-block {
  line-height: 1.04;
}

.logo-title,
.logo-subtitle {
  margin: 0;
}

.logo-title {
  font-size: 26px;
  font-weight: 700;
}

.logo-subtitle {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-hint);
  letter-spacing: 1px;
}
</style>
