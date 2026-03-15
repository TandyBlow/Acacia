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
  gap: 12px;
  user-select: none;
}

.logo-mark {
  width: 54px;
  height: 54px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.8px;
  background: rgba(255, 255, 255, 0.18);
  color: #eaffff;
}

.logo-text-block {
  line-height: 1.08;
}

.logo-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
}

.logo-subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  letter-spacing: 1px;
  opacity: 0.8;
  text-transform: uppercase;
}
</style>
