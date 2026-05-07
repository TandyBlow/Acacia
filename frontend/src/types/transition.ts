export type LayoutType = 'large' | 'medium' | 'small';
export type CompactMode = 'content' | 'nav' | 'feature';
export type TransitionPhase = 'idle' | 'sinking' | 'loading' | 'swapping' | 'rising';

export interface PageState {
  viewState: string;
  activeNode: { id: string } | null;
  isFeaturePanel: boolean;
  layout: LayoutType;
  compactMode: CompactMode;
  isAuthenticated: boolean;
}

export interface RegionRegistration {
  id: string;
  type: 'glass' | 'inset';
  element: import('vue').Ref<HTMLElement | null>;
  shouldShow: (state: PageState) => boolean;
  parent?: string;
}

export type TransitionTrigger =
  | { type: 'navigate'; nodeId: string | null }
  | { type: 'viewState'; newState: string }
  | { type: 'layout'; newLayout: LayoutType }
  | { type: 'knob'; action: 'click' | 'doubleClick' | 'hold' };
