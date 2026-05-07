# 面包屑滚轮横向滚动实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为面包屑组件添加鼠标滚轮横向滚动功能，采用与 Navigation 组件相同的动画滚动引擎

**Architecture:** 拦截 wheel 事件，将滚轮输入转换为滚动队列，用动画引擎逐步处理队列，每次滚动一个面包屑项的宽度，根据滚动速度动态调整动画时长

**Tech Stack:** Vue 3 Composition API, TypeScript

---

## File Structure

**Modify:**
- `frontend/src/components/layout/Breadcrumbs.vue` - 添加滚动引擎逻辑

**No new files needed** - 所有功能在现有组件中实现

---

### Task 1: 添加滚动状态和常量定义

**Files:**
- Modify: `frontend/src/components/layout/Breadcrumbs.vue:33-50`

- [ ] **Step 1: 在 script setup 中添加常量定义**

在 `import` 语句之后，`const store = useNodeStore()` 之前添加：

```typescript
// Scroll animation constants
const BREADCRUMB_ANIM_MS = 180;
const BREADCRUMB_SCROLL_MIN_ANIM_MS = 80;
const BREADCRUMB_SCROLL_MAX_ANIM_MS = 240;
const BREADCRUMB_SCROLL_INPUT_WINDOW_MS = 150;
```

- [ ] **Step 2: 添加滚动状态变量**

在 `const showCurrentNode = ref(true)` 之后添加：

```typescript
// Scroll engine state
const scrollQueue = ref<Array<{ direction: 'left' | 'right' }>>([]);
const isAnimating = ref(false);
const lastWheelTime = ref(0);
const currentSpeed = ref(0);
const currentAnimMs = ref(BREADCRUMB_ANIM_MS);
const crumbTrackRef = ref<HTMLElement | null>(null);
let scrollCancelToken = 0;
```

- [ ] **Step 3: 验证代码编译**

运行：`cd frontend && npm run build`
预期：编译成功，无 TypeScript 错误

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/layout/Breadcrumbs.vue
git commit -m "feat(breadcrumbs): add scroll engine state and constants"
```

---

### Task 2: 实现速度计算函数

**Files:**
- Modify: `frontend/src/components/layout/Breadcrumbs.vue:120` (在 `goTo` 函数之前)

- [ ] **Step 1: 添加速度计算函数**

在 `async function goTo(nodeId: string)` 之前添加：

```typescript
function calcAnimDuration(): number {
  const speed = currentSpeed.value;
  if (speed <= 0) return BREADCRUMB_ANIM_MS;
  
  const clampedSpeed = Math.max(1, Math.min(speed, 12));
  const duration = BREADCRUMB_SCROLL_MAX_ANIM_MS - 
    (clampedSpeed - 1) * (BREADCRUMB_SCROLL_MAX_ANIM_MS - BREADCRUMB_SCROLL_MIN_ANIM_MS) / 11;
  
  return Math.round(duration);
}
```

- [ ] **Step 2: 验证代码编译**

运行：`cd frontend && npm run build`
预期：编译成功

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/layout/Breadcrumbs.vue
git commit -m "feat(breadcrumbs): add animation duration calculation"
```

---

### Task 3: 实现目标位置查找函数

**Files:**
- Modify: `frontend/src/components/layout/Breadcrumbs.vue:120` (在 `calcAnimDuration` 之后)

- [ ] **Step 1: 添加目标位置查找函数**

在 `calcAnimDuration` 函数之后添加：

```typescript
function findNextScrollTarget(direction: 'left' | 'right'): number {
  const container = crumbTrackRef.value;
  if (!container) return 0;
  
  const currentScrollLeft = container.scrollLeft;
  const containerLeft = container.getBoundingClientRect().left;
  
  const items = Array.from(container.querySelectorAll('.crumb-wrap')) as HTMLElement[];
  
  if (direction === 'right') {
    for (const item of items) {
      const itemRect = item.getBoundingClientRect();
      const itemLeft = itemRect.left - containerLeft + currentScrollLeft;
      
      if (itemLeft > currentScrollLeft + 10) {
        return itemLeft;
      }
    }
    return container.scrollWidth - container.clientWidth;
  } else {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]!;
      const itemRect = item.getBoundingClientRect();
      const itemLeft = itemRect.left - containerLeft + currentScrollLeft;
      
      if (itemLeft < currentScrollLeft - 10) {
        return itemLeft;
      }
    }
    return 0;
  }
}
```

- [ ] **Step 2: 验证代码编译**

运行：`cd frontend && npm run build`
预期：编译成功

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/layout/Breadcrumbs.vue
git commit -m "feat(breadcrumbs): add scroll target calculation"
```

---

### Task 4: 实现单次滚动动画函数

**Files:**
- Modify: `frontend/src/components/layout/Breadcrumbs.vue:120` (在 `findNextScrollTarget` 之后)

- [ ] **Step 1: 添加单次滚动动画函数**

在 `findNextScrollTarget` 函数之后添加：

```typescript
async function animateSingleScroll(direction: 'left' | 'right', duration: number): Promise<void> {
  const container = crumbTrackRef.value;
  if (!container) return;
  
  const targetScrollLeft = findNextScrollTarget(direction);
  const token = ++scrollCancelToken;
  
  container.style.scrollBehavior = 'smooth';
  container.scrollLeft = targetScrollLeft;
  
  await new Promise(resolve => setTimeout(resolve, duration));
  
  if (token !== scrollCancelToken) return;
  
  container.style.scrollBehavior = 'auto';
}
```

- [ ] **Step 2: 验证代码编译**

运行：`cd frontend && npm run build`
预期：编译成功

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/layout/Breadcrumbs.vue
git commit -m "feat(breadcrumbs): add single scroll animation"
```

---

### Task 5: 实现滚动队列处理引擎

**Files:**
- Modify: `frontend/src/components/layout/Breadcrumbs.vue:120` (在 `animateSingleScroll` 之后)

- [ ] **Step 1: 添加队列处理函数**

在 `animateSingleScroll` 函数之后添加：

```typescript
async function processScrollQueue(): Promise<void> {
  isAnimating.value = true;
  
  while (scrollQueue.value.length > 0) {
    const entry = scrollQueue.value.shift()!;
    
    const container = crumbTrackRef.value;
    if (!container) break;
    
    const canScroll = entry.direction === 'right'
      ? container.scrollLeft < container.scrollWidth - container.clientWidth
      : container.scrollLeft > 0;
    
    if (!canScroll) continue;
    
    const duration = calcAnimDuration();
    currentAnimMs.value = duration;
    
    await animateSingleScroll(entry.direction, duration);
  }
  
  isAnimating.value = false;
  currentSpeed.value = 0;
}
```

- [ ] **Step 2: 验证代码编译**

运行：`cd frontend && npm run build`
预期：编译成功

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/layout/Breadcrumbs.vue
git commit -m "feat(breadcrumbs): add scroll queue processor"
```

---

### Task 6: 实现滚轮事件处理

**Files:**
- Modify: `frontend/src/components/layout/Breadcrumbs.vue:120` (在 `processScrollQueue` 之后)

- [ ] **Step 1: 添加滚轮事件处理函数**

在 `processScrollQueue` 函数之后添加：

```typescript
function onWheel(e: WheelEvent): void {
  if (e.deltaY === 0) return;
  
  const now = Date.now();
  const dt = now - lastWheelTime.value;
  lastWheelTime.value = now;
  
  if (dt > 0 && dt < BREADCRUMB_SCROLL_INPUT_WINDOW_MS * 3) {
    const delta = Math.abs(e.deltaY);
    const itemsEquiv = delta / 120;
    currentSpeed.value = itemsEquiv / (dt / 1000);
  } else {
    currentSpeed.value = Math.max(1, currentSpeed.value * 0.5);
  }
  
  const direction: 'left' | 'right' = e.deltaY > 0 ? 'right' : 'left';
  
  if (scrollQueue.value.length < 20) {
    scrollQueue.value.push({ direction });
  }
  
  if (!isAnimating.value) {
    processScrollQueue();
  }
}
```

- [ ] **Step 2: 验证代码编译**

运行：`cd frontend && npm run build`
预期：编译成功

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/layout/Breadcrumbs.vue
git commit -m "feat(breadcrumbs): add wheel event handler"
```

---

### Task 7: 添加路径变化时的状态重置

**Files:**
- Modify: `frontend/src/components/layout/Breadcrumbs.vue:55-114` (修改现有的 `watch(pathNodes, ...)`)

- [ ] **Step 1: 在 watch 回调开头添加滚动状态重置**

找到 `watch(pathNodes, (newPath, oldPath) => {` 这一行，在函数体开头（第 56 行之后）添加：

```typescript
  // Reset scroll state on path change
  scrollCancelToken++;
  scrollQueue.value = [];
  isAnimating.value = false;
  currentSpeed.value = 0;
  currentAnimMs.value = BREADCRUMB_ANIM_MS;
  if (crumbTrackRef.value) {
    crumbTrackRef.value.scrollLeft = 0;
  }
```

完整的 watch 函数开头应该是：

```typescript
watch(pathNodes, (newPath, oldPath) => {
  // Reset scroll state on path change
  scrollCancelToken++;
  scrollQueue.value = [];
  isAnimating.value = false;
  currentSpeed.value = 0;
  currentAnimMs.value = BREADCRUMB_ANIM_MS;
  if (crumbTrackRef.value) {
    crumbTrackRef.value.scrollLeft = 0;
  }

  // [Bug5 fix] initial mount — skip animation, just set directly
  if (oldPath === undefined) {
    displayNodes.value = [...newPath];
    return;
  }
  // ... 其余代码保持不变
```

- [ ] **Step 2: 验证代码编译**

运行：`cd frontend && npm run build`
预期：编译成功

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/layout/Breadcrumbs.vue
git commit -m "feat(breadcrumbs): reset scroll state on path change"
```

---

### Task 8: 添加模板中的事件绑定和 ref

**Files:**
- Modify: `frontend/src/components/layout/Breadcrumbs.vue:3` (修改 `.crumb-track` div)

- [ ] **Step 1: 添加 ref 和事件监听器**

找到第 3 行的 `<TransitionGroup v-if="isAuthenticated" name="crumb" tag="div" class="crumb-track">`

修改为：

```vue
    <TransitionGroup 
      v-if="isAuthenticated" 
      name="crumb" 
      tag="div" 
      class="crumb-track"
      ref="crumbTrackRef"
      @wheel.prevent="onWheel"
    >
```

- [ ] **Step 2: 验证代码编译**

运行：`cd frontend && npm run build`
预期：编译成功

- [ ] **Step 3: 启动开发服务器测试**

运行：`cd frontend && npm run dev`
预期：服务器启动成功，浏览器中打开应用

- [ ] **Step 4: 手动测试基本滚动**

测试步骤：
1. 登录应用
2. 导航到有多个面包屑项的深层节点
3. 鼠标悬停在面包屑区域
4. 向下滚动鼠标滚轮
5. 预期：面包屑向右滚动一项
6. 向上滚动鼠标滚轮
7. 预期：面包屑向左滚动一项

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/layout/Breadcrumbs.vue
git commit -m "feat(breadcrumbs): bind wheel event and ref to template"
```

---

### Task 9: 添加触摸支持（可选）

**Files:**
- Modify: `frontend/src/components/layout/Breadcrumbs.vue:120` (在 `onWheel` 之后)
- Modify: `frontend/src/components/layout/Breadcrumbs.vue:3` (模板)

- [ ] **Step 1: 添加触摸事件处理函数**

在 `onWheel` 函数之后添加：

```typescript
let touchX = 0;

function onTouchStart(e: TouchEvent): void {
  if (e.touches[0]) touchX = e.touches[0].clientX;
}

function onTouchEnd(e: TouchEvent): void {
  if (!e.changedTouches[0]) return;
  const dx = touchX - e.changedTouches[0].clientX;
  if (Math.abs(dx) < 30) return;
  
  const direction: 'left' | 'right' = dx > 0 ? 'right' : 'left';
  scrollQueue.value.push({ direction });
  
  if (!isAnimating.value) {
    processScrollQueue();
  }
}
```

- [ ] **Step 2: 在模板中添加触摸事件监听器**

修改 `<TransitionGroup>` 标签，添加触摸事件：

```vue
    <TransitionGroup 
      v-if="isAuthenticated" 
      name="crumb" 
      tag="div" 
      class="crumb-track"
      ref="crumbTrackRef"
      @wheel.prevent="onWheel"
      @touchstart.passive="onTouchStart"
      @touchend="onTouchEnd"
    >
```

- [ ] **Step 3: 验证代码编译**

运行：`cd frontend && npm run build`
预期：编译成功

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/layout/Breadcrumbs.vue
git commit -m "feat(breadcrumbs): add touch swipe support"
```

---

### Task 10: 完整功能测试

**Files:**
- Test: `frontend/src/components/layout/Breadcrumbs.vue`

- [ ] **Step 1: 测试基本滚动**

测试步骤：
1. 启动开发服务器：`cd frontend && npm run dev`
2. 登录应用
3. 导航到深层节点（至少 5 层）
4. 鼠标悬停在面包屑区域
5. 向下滚动鼠标滚轮
6. 预期：面包屑平滑向右滚动一项，对齐到项边界

- [ ] **Step 2: 测试边界条件**

测试步骤：
1. 继续向下滚动直到最右侧
2. 预期：到达最右侧后，继续滚动无效果
3. 向上滚动鼠标滚轮
4. 预期：面包屑向左滚动
5. 继续向上滚动直到最左侧
6. 预期：到达最左侧后，继续滚动无效果

- [ ] **Step 3: 测试快速滚动**

测试步骤：
1. 快速连续滚动鼠标滚轮（向下）
2. 预期：面包屑快速滚动，动画时长缩短，响应流畅
3. 观察滚动是否平滑，无卡顿

- [ ] **Step 4: 测试路径变化**

测试步骤：
1. 滚动面包屑到中间位置
2. 点击某个面包屑项导航到该节点
3. 预期：面包屑滚动位置重置到最左侧
4. 滚动状态清空，无残留动画

- [ ] **Step 5: 测试触摸支持（如果有触摸设备）**

测试步骤：
1. 在触摸设备上打开应用
2. 在面包屑区域左右滑动
3. 预期：面包屑跟随滑动方向滚动

- [ ] **Step 6: 验证生产构建**

运行：`cd frontend && npm run build && npm run preview`
预期：生产构建成功，预览服务器启动，功能正常

- [ ] **Step 7: 最终提交**

```bash
git add -A
git commit -m "test: verify breadcrumbs wheel scroll functionality"
```

---

## 测试清单

完成所有任务后，验证以下场景：

- [x] 鼠标滚轮向下 → 面包屑向右滚动
- [x] 鼠标滚轮向上 → 面包屑向左滚动
- [x] 滚动到最右侧 → 继续滚动无效果
- [x] 滚动到最左侧 → 继续滚动无效果
- [x] 快速滚动 → 动画时长缩短，响应流畅
- [x] 慢速滚动 → 动画时长正常
- [x] 路径变化 → 滚动状态重置，位置回到最左
- [x] 触摸滑动（可选）→ 面包屑跟随滑动方向滚动
- [x] 生产构建 → 功能正常

## 参考

- 规格文档：`docs/superpowers/specs/2026-05-07-breadcrumbs-wheel-scroll-design.md`
- Navigation 组件滚动实现：`frontend/src/components/layout/Navigation.vue:219-279`
