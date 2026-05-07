# 统一页面切换动画系统设计

## 概述

实现一个全局的页面切换动画系统，确保所有界面切换行为都有统一的加载状态和升起动画。系统采用集中式状态机 + 区域注册表的架构，由页面转换管理器统一编排所有区域的下沉、消失、创建和升起动画。

## 目标

1. **统一体验**：所有界面切换都有一致的加载动画
2. **视觉连贯**：玻璃区域下沉 → 加载 → 升起的完整流程
3. **灵活扩展**：新增区域只需注册，无需修改核心逻辑
4. **性能优化**：避免不必要的 DOM 操作和重排

## 架构设计

### 核心组件

#### 1. 页面转换管理器（`usePageTransition`）

全局单例，负责：
- 维护区域注册表
- 广播加载状态（进入/退出）
- 计算区域差异（旧页面 vs 新页面）
- 编排动画序列

#### 2. 区域注册系统

每个区域组件在挂载时注册到管理器：

```typescript
interface RegionRegistration {
  id: string;                    // 唯一标识，如 'logo', 'breadcrumbs', 'content-editor'
  type: 'glass' | 'inset';       // 区域类型
  element: Ref<HTMLElement | null>;  // DOM 引用
  shouldShow: (state: PageState) => boolean;  // 可见性判断函数
  parent?: string;               // 父区域 id（用于内容区子组件）
}
```

#### 3. 页面状态定义

```typescript
interface PageState {
  viewState: ViewState;          // display | add | move | delete | tree | quiz | stats | review...
  activeNode: NodeRecord | null; // 当前节点
  isFeaturePanel: boolean;       // 是否显示功能面板
  layout: 'large' | 'medium' | 'small';  // 布局类型
  compactMode: 'content' | 'nav' | 'feature';  // 紧凑模式
  isAuthenticated: boolean;      // 是否已登录
}
```

### 转换触发点

所有界面切换行为都触发转换：
- 点击面包屑父节点
- 点击导航栏子节点
- 进入移动/删除/添加确认界面
- 单击旋钮（返回主页/取消操作）
- 双击旋钮（打开/关闭功能面板）
- 长按旋钮（确认操作）
- 窗口大小改变（触发布局切换）

## 转换流程

### 完整序列

```
1. 触发转换
   ↓
2. 广播 'transition:enter-loading'
   ↓
3. 下沉阶段
   - 计算当前页面所有可见区域
   - 除底部区域（inset-shell）外，所有区域标记为"需要隐藏"
   - 玻璃区域清空内容、样式，变为基础样式
   - 播放下沉动画（glass-raised → glass-sinking）
   ↓
4. 等待所有下沉动画完成（800ms）
   ↓
5. 执行数据加载（loadNode / 其他异步操作）
   ↓
6. 广播 'transition:exit-loading'
   ↓
7. 区域对比阶段
   - 统计新页面需要显示的玻璃区域
   - 对比旧区域列表 vs 新区域列表
   ↓
8. 清理阶段
   - 仍标记为"需要隐藏"的下沉区域 → 彻底消失（display: none）
   ↓
9. 创建阶段
   - 需要显示但当前不存在的区域 → 在对应底部区域创建下沉区域（glass-sunken 状态）
   ↓
10. 升起阶段
    - 所有下沉区域播放升起动画（glass-sunken → glass-rising）
    ↓
11. 转换完成
```

### 状态机定义

```typescript
interface TransitionState {
  isTransitioning: boolean;      // 是否正在转换
  phase: 'idle' | 'sinking' | 'loading' | 'swapping' | 'rising';
  oldRegions: Set<string>;       // 旧页面的区域 id
  newRegions: Set<string>;       // 新页面的区域 id
  sinkingCount: number;          // 正在下沉的区域数量
  risingCount: number;           // 正在升起的区域数量
}
```

## 区域可见性判断

### 主要区域

**Logo 区域**：
```typescript
shouldShow: (state) => state.layout !== 'small'
```

**面包屑区域**：
```typescript
shouldShow: (state) => true  // 所有布局都显示
```

**导航栏区域**：
```typescript
shouldShow: (state) => {
  if (state.layout === 'small') {
    return state.compactMode === 'nav';
  }
  return state.isAuthenticated;
}
```

**内容区域**：
```typescript
shouldShow: (state) => {
  if (state.layout === 'small') {
    return state.compactMode === 'content' || state.compactMode === 'feature';
  }
  return true;
}
```

**旋钮区域**：
```typescript
shouldShow: (state) => true  // 所有布局都显示
```

### 内容区子区域

内容区内部根据 `viewState` 显示不同组件，这些子区域也需要注册：

- **TreeCanvas**：`isAuthenticated && !activeNode && !isConfirmState && !isFeaturePanel && !isQuiz...`
- **MarkdownEditor**：`isAuthenticated && activeNode && viewState === 'display'`
- **ConfirmPanel**：`isConfirmState || isLoggingOut`
- **GlobalTree**：`viewState === 'move'`
- **FeaturePanel**：`isFeaturePanel`
- **AuthPanel**：`!isAuthenticated`
- **QuizPanel**：`viewState === 'quiz'`
- **QuizHistoryPanel**：`viewState === 'quiz_history'`
- **StatsPanel**：`viewState === 'stats'`
- **ReviewPanel**：`viewState === 'review'`

## 动画实现

### CSS 类定义

```css
/* 玻璃区域的三种状态 */
.glass-raised {
  /* 正常状态：凸起 */
  box-shadow: 5px 5px 10px var(--shadow-raised-a),
              -5px -5px 10px var(--shadow-raised-b);
  transition: all 800ms cubic-bezier(0.22, 1, 0.36, 1);
}

.glass-sinking {
  /* 下沉中：移除阴影和毛玻璃 */
  box-shadow: none !important;
  border-color: rgba(255, 255, 255, 0.12) !important;
}

.glass-sinking .glass-content {
  background: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

.glass-sunken {
  /* 下沉完成：扁平状态 */
  box-shadow: none;
  border-color: rgba(255, 255, 255, 0.12);
  opacity: 0;  /* 准备升起时从透明开始 */
}

.glass-sunken .glass-content {
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.glass-rising {
  /* 升起中：恢复样式 + 位移动画 */
  animation: glass-rise 400ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

@keyframes glass-rise {
  from {
    opacity: 0;
    transform: translateY(24px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* 文字透明（转换期间） */
.region-transitioning {
  color: transparent !important;
}

.region-transitioning * {
  color: transparent !important;
}
```

### 动画时序

**下沉动画**：
- 时长：800ms
- 缓动：`cubic-bezier(0.22, 1, 0.36, 1)`
- 效果：移除 box-shadow、backdrop-filter、background，文字变透明

**升起动画**：
- 时长：400ms
- 缓动：`cubic-bezier(0.22, 1, 0.36, 1)`
- 效果：从 `translateY(24px) scale(0.97)` 到 `translateY(0) scale(1)`，同时淡入

## API 设计

### 管理器 API

```typescript
// composables/usePageTransition.ts
export function usePageTransition() {
  // 注册/注销
  function registerRegion(registration: RegionRegistration): void
  function unregisterRegion(id: string): void
  
  // 触发转换
  function startTransition(trigger: TransitionTrigger): Promise<void>
  
  // 动画回调（组件调用）
  function notifySinkComplete(id: string): void
  function notifyRiseComplete(id: string): void
  
  // 状态查询
  const isTransitioning: Ref<boolean>
  const currentPhase: Ref<TransitionPhase>
  
  return {
    registerRegion,
    unregisterRegion,
    startTransition,
    notifySinkComplete,
    notifyRiseComplete,
    isTransitioning,
    currentPhase
  }
}
```

### 触发器类型

```typescript
type TransitionTrigger = 
  | { type: 'navigate', nodeId: string | null }
  | { type: 'viewState', newState: ViewState }
  | { type: 'layout', newLayout: LayoutType }
  | { type: 'knob', action: 'click' | 'doubleClick' | 'hold' }
```

## 实现细节

### 区域注册流程

每个组件在 `onMounted` 时注册：

```typescript
// 示例：Breadcrumbs.vue
const { registerRegion, unregisterRegion } = usePageTransition();
const breadcrumbsRef = ref<HTMLElement | null>(null);

onMounted(() => {
  registerRegion({
    id: 'breadcrumbs',
    type: 'glass',
    element: breadcrumbsRef,
    shouldShow: (state) => true
  });
});

onBeforeUnmount(() => {
  unregisterRegion('breadcrumbs');
});
```

### 转换执行逻辑

```typescript
async function startTransition(trigger: TransitionTrigger): Promise<void> {
  if (isTransitioning.value) return;  // 防止重复触发
  
  isTransitioning.value = true;
  phase.value = 'sinking';
  
  // 1. 计算旧页面区域
  const currentState = getCurrentPageState();
  oldRegions.value = new Set(
    Array.from(regions.values())
      .filter(r => r.shouldShow(currentState))
      .map(r => r.id)
  );
  
  // 2. 下沉阶段
  await sinkRegions(Array.from(oldRegions.value));
  
  // 3. 加载阶段
  phase.value = 'loading';
  await executeDataLoading(trigger);
  
  // 4. 计算新页面区域
  const newState = getCurrentPageState();
  newRegions.value = new Set(
    Array.from(regions.values())
      .filter(r => r.shouldShow(newState))
      .map(r => r.id)
  );
  
  // 5. 区域对比
  phase.value = 'swapping';
  const toHide = Array.from(oldRegions.value).filter(id => !newRegions.value.has(id));
  const toShow = Array.from(newRegions.value).filter(id => !oldRegions.value.has(id));
  const toKeep = Array.from(oldRegions.value).filter(id => newRegions.value.has(id));
  
  // 6. 清理旧区域
  toHide.forEach(id => {
    const region = regions.get(id);
    if (region?.element.value) {
      region.element.value.style.display = 'none';
    }
  });
  
  // 7. 创建新区域（如果需要）
  toShow.forEach(id => {
    const region = regions.get(id);
    if (region?.element.value) {
      region.element.value.style.display = '';
      region.element.value.classList.add('glass-sunken');
    }
  });
  
  // 8. 升起阶段
  phase.value = 'rising';
  await riseRegions([...toShow, ...toKeep]);
  
  // 9. 完成
  phase.value = 'idle';
  isTransitioning.value = false;
}
```

### 下沉/升起实现

```typescript
async function sinkRegions(regionIds: string[]): Promise<void> {
  regionIds.forEach(id => {
    const region = regions.get(id);
    if (region?.element.value) {
      region.element.value.classList.add('glass-sinking', 'region-transitioning');
    }
  });
  
  // 等待 800ms 下沉动画完成
  await new Promise(resolve => setTimeout(resolve, 800));
  
  regionIds.forEach(id => {
    const region = regions.get(id);
    if (region?.element.value) {
      region.element.value.classList.remove('glass-sinking');
      region.element.value.classList.add('glass-sunken');
    }
  });
}

async function riseRegions(regionIds: string[]): Promise<void> {
  regionIds.forEach(id => {
    const region = regions.get(id);
    if (region?.element.value) {
      region.element.value.classList.remove('glass-sunken');
      region.element.value.classList.add('glass-rising');
    }
  });
  
  // 等待 400ms 升起动画完成
  await new Promise(resolve => setTimeout(resolve, 400));
  
  regionIds.forEach(id => {
    const region = regions.get(id);
    if (region?.element.value) {
      region.element.value.classList.remove('glass-rising', 'region-transitioning');
    }
  });
}
```

## 集成点

### 1. 替换现有加载状态

移除 `useGlobalLoading` 和 `MainLayout` 中的 `is-loading` 类逻辑，统一使用 `usePageTransition`。

### 2. 修改触发点

在以下位置调用 `startTransition`：
- `nodeStore.loadNode()` 开始前
- `Breadcrumbs` 点击父节点时
- `Navigation` 点击子节点时
- `Knob` 点击/双击/长按时
- `MainLayout` 监听窗口 resize 事件

### 3. 组件改造

所有主要区域组件需要：
- 添加区域注册逻辑
- 提供 `shouldShow` 函数
- 移除旧的加载状态处理

## 边界情况处理

### 1. 快速连续触发

如果用户快速点击多次，只处理第一次触发，后续触发被忽略直到当前转换完成。

### 2. 窗口大小改变

使用防抖（debounce）处理 resize 事件，避免频繁触发转换。

### 3. 动画中断

如果转换过程中组件被卸载，清理所有动画类和定时器。

### 4. 缓存命中

如果 `loadNode` 命中缓存，仍然播放完整的下沉/升起动画，确保视觉一致性。

## 性能优化

### 1. 使用 CSS 动画

优先使用 CSS transition 和 animation，避免 JavaScript 驱动的逐帧动画。

### 2. will-change 提示

在下沉/升起前添加 `will-change: transform, opacity`，动画结束后移除。

### 3. 避免重排

动画期间只修改 `transform` 和 `opacity`，不修改布局属性。

### 4. 批量 DOM 操作

使用 `requestAnimationFrame` 批量处理 class 添加/移除。

## 测试计划

### 单元测试

- 区域注册/注销
- `shouldShow` 逻辑
- 区域差异计算
- 状态机转换

### 集成测试

- 完整转换流程
- 多种触发场景
- 边界情况处理

### 视觉测试

- 动画流畅度
- 时序正确性
- 不同布局下的表现

## 未来扩展

### 1. 自定义动画

允许区域注册时提供自定义动画参数（时长、缓动函数、位移距离）。

### 2. 转换钩子

提供 `onBeforeSink`、`onAfterRise` 等钩子，允许组件在转换过程中执行自定义逻辑。

### 3. 动画预设

提供多种动画预设（淡入淡出、滑动、缩放等），用户可选择。

### 4. 性能监控

记录转换耗时，识别性能瓶颈。
