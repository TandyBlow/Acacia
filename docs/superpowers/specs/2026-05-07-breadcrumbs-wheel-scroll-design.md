# 面包屑滚轮横向滚动设计

## 概述

为面包屑组件添加鼠标滚轮横向滚动功能，采用与 Navigation 组件相同的动画滚动引擎，实现流畅的逐项滚动体验。

## 目标

- 桌面端用户可以直接用鼠标滚轮（不按 Shift）横向滚动面包屑
- 滚动体验与 Navigation 组件一致：有动画、速度感知、队列处理
- 每次滚动精确对齐到面包屑项的边界，不会停在项目中间

## 架构设计

### 核心机制

采用与 Navigation 组件相似的滚动引擎架构：

1. **事件拦截**：`@wheel.prevent` 拦截滚轮事件，阻止默认的纵向滚动
2. **队列管理**：将滚轮输入转换为滚动队列 `{ direction: 'left' | 'right' }[]`
3. **动画引擎**：异步处理队列，每次滚动一个面包屑项的宽度
4. **速度感知**：根据滚动速度动态调整动画时长

### 关键差异

| 维度 | Navigation | Breadcrumbs |
|------|-----------|-------------|
| 方向 | 纵向 | 横向 |
| 滚动单位 | 固定行高（ROW_STEP） | 动态项宽（DOM 查询） |
| 实现方式 | 虚拟滚动（切换 displayNodes） | 真实滚动（scrollLeft） |
| 边界 | 第一项/最后一项 | scrollLeft = 0 / scrollWidth - clientWidth |

## 数据流设计

### 状态定义

```typescript
// 滚动队列和动画状态
const scrollQueue = ref<Array<{ direction: 'left' | 'right' }>>([])
const isAnimating = ref(false)

// 速度追踪（用于动态调整动画时长）
const lastWheelTime = ref(0)
const currentSpeed = ref(0) // items/second
const currentAnimMs = ref(BREADCRUMB_ANIM_MS)

// 滚动容器引用
const crumbTrackRef = ref<HTMLElement | null>(null)

// 取消令牌（处理快速导航）
let scrollCancelToken = 0
```

### 常量定义

```typescript
const BREADCRUMB_ANIM_MS = 180 // 默认动画时长
const BREADCRUMB_SCROLL_MIN_ANIM_MS = 80 // 快速滚动时的最短动画
const BREADCRUMB_SCROLL_MAX_ANIM_MS = 240 // 慢速滚动时的最长动画
const BREADCRUMB_SCROLL_INPUT_WINDOW_MS = 150 // 速度计算的时间窗口
```

### 事件处理流程

```typescript
function onWheel(e: WheelEvent): void {
  if (e.deltaY === 0) return
  
  // 1. 计算滚动速度
  const now = Date.now()
  const dt = now - lastWheelTime.value
  lastWheelTime.value = now
  
  if (dt > 0 && dt < BREADCRUMB_SCROLL_INPUT_WINDOW_MS * 3) {
    const delta = Math.abs(e.deltaY)
    const itemsEquiv = delta / 120 // 假设 120 deltaY = 1 项
    currentSpeed.value = itemsEquiv / (dt / 1000)
  } else {
    currentSpeed.value = Math.max(1, currentSpeed.value * 0.5)
  }
  
  // 2. 确定滚动方向（deltaY > 0 向下 → 向右滚动）
  const direction: 'left' | 'right' = e.deltaY > 0 ? 'right' : 'left'
  
  // 3. 推入队列（限制队列长度防止堆积）
  if (scrollQueue.value.length < 20) {
    scrollQueue.value.push({ direction })
  }
  
  // 4. 启动动画引擎
  if (!isAnimating.value) {
    processScrollQueue()
  }
}
```

### 动画引擎

```typescript
async function processScrollQueue(): Promise<void> {
  isAnimating.value = true
  
  while (scrollQueue.value.length > 0) {
    const entry = scrollQueue.value.shift()!
    
    // 检查边界
    const container = crumbTrackRef.value
    if (!container) break
    
    const canScroll = entry.direction === 'right'
      ? container.scrollLeft < container.scrollWidth - container.clientWidth
      : container.scrollLeft > 0
    
    if (!canScroll) continue
    
    // 计算动画时长
    const duration = calcAnimDuration()
    currentAnimMs.value = duration
    
    // 执行单次滚动
    await animateSingleScroll(entry.direction, duration)
  }
  
  isAnimating.value = false
  currentSpeed.value = 0
}

function calcAnimDuration(): number {
  const speed = currentSpeed.value
  if (speed <= 0) return BREADCRUMB_ANIM_MS
  
  const clampedSpeed = Math.max(1, Math.min(speed, 12))
  const duration = BREADCRUMB_SCROLL_MAX_ANIM_MS - 
    (clampedSpeed - 1) * (BREADCRUMB_SCROLL_MAX_ANIM_MS - BREADCRUMB_SCROLL_MIN_ANIM_MS) / 11
  
  return Math.round(duration)
}
```

## 滚动单位设计（选项 2：动态计算可见项）

### 目标位置计算

```typescript
function findNextScrollTarget(direction: 'left' | 'right'): number {
  const container = crumbTrackRef.value
  if (!container) return 0
  
  const currentScrollLeft = container.scrollLeft
  const containerLeft = container.getBoundingClientRect().left
  
  // 获取所有面包屑项（.crumb-wrap）
  const items = Array.from(container.querySelectorAll('.crumb-wrap')) as HTMLElement[]
  
  if (direction === 'right') {
    // 向右滚动：找到第一个完全不可见或部分可见的项
    for (const item of items) {
      const itemRect = item.getBoundingClientRect()
      const itemLeft = itemRect.left - containerLeft + currentScrollLeft
      
      // 如果项的左边缘在当前视口右侧之外，滚动到该项
      if (itemLeft > currentScrollLeft + 10) { // 10px 容差
        return itemLeft
      }
    }
    // 已到达最右侧
    return container.scrollWidth - container.clientWidth
  } else {
    // 向左滚动：找到当前第一个可见项的前一项
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]!
      const itemRect = item.getBoundingClientRect()
      const itemLeft = itemRect.left - containerLeft + currentScrollLeft
      
      // 如果项的左边缘在当前视口左侧之前，滚动到该项
      if (itemLeft < currentScrollLeft - 10) { // 10px 容差
        return itemLeft
      }
    }
    // 已到达最左侧
    return 0
  }
}
```

### 滚动执行

```typescript
async function animateSingleScroll(direction: 'left' | 'right', duration: number): Promise<void> {
  const container = crumbTrackRef.value
  if (!container) return
  
  const targetScrollLeft = findNextScrollTarget(direction)
  const token = ++scrollCancelToken
  
  // 使用 CSS transition 实现平滑滚动
  container.style.scrollBehavior = 'smooth'
  container.scrollLeft = targetScrollLeft
  
  // 等待动画完成
  await new Promise(resolve => setTimeout(resolve, duration))
  
  // 检查是否被取消
  if (token !== scrollCancelToken) return
  
  container.style.scrollBehavior = 'auto'
}
```

## 边界处理

### 路径变化时重置状态

```typescript
watch(pathNodes, () => {
  // 取消所有进行中的滚动
  scrollCancelToken++
  scrollQueue.value = []
  isAnimating.value = false
  currentSpeed.value = 0
  currentAnimMs.value = BREADCRUMB_ANIM_MS
  
  // 重置滚动位置到最左侧
  if (crumbTrackRef.value) {
    crumbTrackRef.value.scrollLeft = 0
  }
})
```

### 滚动边界检查

在 `processScrollQueue` 中已实现：
- 向右滚动：`scrollLeft < scrollWidth - clientWidth`
- 向左滚动：`scrollLeft > 0`

## 触摸支持（可选）

为保持与 Navigation 一致，可添加触摸滑动支持：

```typescript
let touchX = 0

function onTouchStart(e: TouchEvent): void {
  if (e.touches[0]) touchX = e.touches[0].clientX
}

function onTouchEnd(e: TouchEvent): void {
  if (!e.changedTouches[0]) return
  const dx = touchX - e.changedTouches[0].clientX
  if (Math.abs(dx) < 30) return
  
  const direction: 'left' | 'right' = dx > 0 ? 'right' : 'left'
  scrollQueue.value.push({ direction })
  
  if (!isAnimating.value) {
    processScrollQueue()
  }
}
```

模板中添加：
```vue
<div 
  class="crumb-track"
  @wheel.prevent="onWheel"
  @touchstart.passive="onTouchStart"
  @touchend="onTouchEnd"
>
```

## 性能考虑

### DOM 查询优化

- `findNextScrollTarget` 在每次滚动时查询 DOM，但面包屑项数量通常较少（< 10 项）
- 如果性能成为问题，可以缓存项的位置信息，在 `pathNodes` 变化时更新缓存

### 队列长度限制

- 限制队列最大长度为 20，防止快速滚动时队列堆积
- 超出部分直接丢弃，用户体验影响不大

### 取消令牌

- 使用 `scrollCancelToken` 处理快速导航场景
- 当路径变化时，立即取消所有进行中的滚动动画

## 测试场景

1. **基本滚动**：鼠标滚轮向下/向上，面包屑向右/向左滚动
2. **边界测试**：滚动到最左/最右时，继续滚动无效果
3. **快速滚动**：连续快速滚轮，动画时长缩短，滚动流畅
4. **慢速滚动**：缓慢滚轮，动画时长正常
5. **路径变化**：导航到新节点时，滚动状态重置，位置回到最左
6. **触摸支持**（如果实现）：触摸设备上左右滑动面包屑

## 实现文件

- `frontend/src/components/layout/Breadcrumbs.vue`

## 参考

- Navigation 组件的滚动实现：`frontend/src/components/layout/Navigation.vue:219-279`
