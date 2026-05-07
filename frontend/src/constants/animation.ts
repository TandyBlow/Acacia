export const ANIM_DURATION = {
  FAST: 160,    // 玻璃状态切换、快速交互
  NORMAL: 300,  // 标准内容过渡
  SLOW: 400,    // 复杂布局变化、首页上升
} as const;

export const ANIM_EASING = {
  STANDARD: 'cubic-bezier(0.22, 1, 0.36, 1)',  // 标准缓动
  EASE_OUT: 'ease-out',                         // 快速开始
  EASE_IN_OUT: 'ease-in-out',                   // 平滑进出
  EASE: 'ease',                                 // 默认缓动
} as const;
