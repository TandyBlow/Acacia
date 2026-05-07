import type { Ref } from 'vue';

/**
 * Layout breakpoint types for responsive design.
 */
export type LayoutType = 'large' | 'medium' | 'small';

/**
 * Compact mode determines which region is visible in small layouts.
 */
export type CompactMode = 'content' | 'nav' | 'feature';

/**
 * Transition animation phases for glass morphism effects.
 */
export type TransitionPhase = 'idle' | 'sinking' | 'loading' | 'swapping' | 'rising';

/**
 * Snapshot of application state used to determine region visibility.
 */
export interface PageState {
  /** Current view state (kept as string to avoid circular dependency with nodeStore) */
  viewState: string;
  /** Currently active node, if any */
  activeNode: { id: string } | null;
  /** Whether a feature panel (tree/confirm) is currently displayed */
  isFeaturePanel: boolean;
  /** Current layout breakpoint */
  layout: LayoutType;
  /** Active compact mode for small layouts */
  compactMode: CompactMode;
  /** Whether user is authenticated */
  isAuthenticated: boolean;
}

/**
 * Registration data for a UI region participating in glass transitions.
 */
export interface RegionRegistration {
  /** Unique identifier for this region */
  id: string;
  /** Visual type: glass (floating) or inset (embedded) */
  type: 'glass' | 'inset';
  /** Reactive reference to the DOM element */
  element: Ref<HTMLElement | null>;
  /** Predicate determining if this region should be visible for a given state */
  shouldShow: (state: PageState) => boolean;
  /** Optional parent region ID for nested regions */
  parent?: string;
}

/**
 * Events that can trigger a page transition.
 */
export type TransitionTrigger =
  | { type: 'navigate'; nodeId: string | null }
  | { type: 'viewState'; newState: string }
  | { type: 'layout'; newLayout: LayoutType }
  | { type: 'knob'; action: 'click' | 'doubleClick' | 'hold' };
