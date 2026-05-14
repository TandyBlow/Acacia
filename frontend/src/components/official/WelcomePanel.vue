<template>
  <div class="welcome-panel">
    <div class="welcome-content">
      <h1>? 欢迎来到 Acacia</h1>

      <section class="welcome-section">
        <h2>这是什么？</h2>
        <p>Acacia 是一个知识管理工具，帮助你记录、组织和巩固学到的知识。你的知识会组织成一棵树，每个知识点都是树上的一个节点。</p>
      </section>

      <section class="welcome-section">
        <h2>基本操作</h2>
        <ul>
          <li><strong>浏览节点</strong>：点击导航栏中的节点名称即可查看其内容</li>
          <li><strong>添加知识点</strong>：点击导航栏底部的"+ 新的知识点"按钮</li>
          <li><strong>编辑内容</strong>：在内容区直接编辑 Markdown 文本</li>
          <li><strong>移动/删除</strong>：右键点击导航栏中的节点，选择移动或删除</li>
        </ul>
      </section>

      <section class="welcome-section">
        <h2>旋钮操作</h2>
        <ul>
          <li><strong>单击旋钮</strong>：返回主页</li>
          <li><strong>长按旋钮</strong>：确认当前操作（添加/删除/移动节点时）</li>
        </ul>
      </section>

      <section class="welcome-section">
        <h2>官方知识点</h2>
        <p>导航栏顶部金色的条目是官方知识点，它们由系统提供，内容不可编辑：</p>
        <ul>
          <li><strong>? 今日成长</strong>：每天一道基于你的知识点生成的练习题，完成后当日隐藏，次日刷新</li>
        </ul>
      </section>

      <section class="welcome-section">
        <h2>核心理念</h2>
        <p>每个人心里都有一棵树。它可能枯萎，也可能繁茂参天。</p>
        <p>记录知识这件事本身不应该有学习成本。Acacia 只做两件事：</p>
        <ol>
          <li><strong>输入</strong>：从一个想法、一段文本中提取出属于自己的知识点</li>
          <li><strong>输出</strong>：通过答题巩固已有知识点，发现新的疑问</li>
        </ol>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
</script>

<style scoped>
.welcome-panel {
  width: 100%;
  height: 100%;
  overflow-y: auto;
}

.welcome-content {
  padding: 32px;
  max-width: 680px;
  margin: 0 auto;
}

.welcome-content h1 {
  margin: 0 0 28px;
  font-size: 26px;
  font-weight: 700;
  color: #FFBB33;
}

.welcome-section {
  margin-bottom: 24px;
}

.welcome-section h2 {
  margin: 0 0 10px;
  font-size: 18px;
  font-weight: 700;
  color: var(--color-primary);
}

.welcome-section p {
  margin: 0 0 8px;
  font-size: 15px;
  line-height: 1.7;
  color: var(--color-primary);
  opacity: 0.85;
}

.welcome-section ul,
.welcome-section ol {
  margin: 0;
  padding-left: 20px;
}

.welcome-section li {
  font-size: 15px;
  line-height: 1.8;
  color: var(--color-primary);
  opacity: 0.85;
}

.welcome-section li strong {
  font-weight: 700;
  color: var(--color-primary);
  opacity: 1;
}
</style>
