// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { computed, defineComponent, h, nextTick, provide } from 'vue';
import { mount } from '@vue/test-utils';
import { useKnobDispatch } from './useKnobDispatch';
import { usePageTransition } from './usePageTransition';
import { useOfficialTransition } from './useOfficialTransition';
import { useMainLayoutCompactToggle } from './useMainLayoutCompactToggle';
import { createMainLayoutState } from './useMainLayoutState';
import { createMainLayoutContentCtx } from './mainLayoutContentContext';
import { setupMainLayoutWatchers } from './mainLayoutContentWatchers';
import { useNodeStore, setDataAdapter } from '../stores/nodeStore';
import { useAuthStore } from '../stores/authStore';
import { useNavigationState } from '../components/layout/NavigationState';
import { useNavigationWatch } from '../components/layout/NavigationWatch';
import { invalidateAll, setCache } from '../services/nodeCache';
import type { CoreDataAdapter, NodeContext, NodeRecord, ViewState } from '../types/node';

const node = (id: string, parentId: string | null = null): NodeRecord => ({
  id, name: id, content: '', parentId, sortOrder: 0,
});
const rootContext: NodeContext = { nodeInfo: null, pathNodes: [], children: [node('root')] };
const getNodeContext = vi.fn<(id: string | null) => Promise<NodeContext>>();

describe('small layout knob navigation', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    invalidateAll();
    useOfficialTransition().reset();
    getNodeContext.mockReset().mockResolvedValue(rootContext);
    setDataAdapter({
      getNodeContext,
      createNode: vi.fn(),
      updateNodeContent: vi.fn(),
      deleteNode: vi.fn(),
      moveNode: vi.fn(),
      getTree: vi.fn(),
    } satisfies CoreDataAdapter);
    useAuthStore().user = { id: 'user', username: 'tester' };
    const dispatch = useKnobDispatch();
    dispatch.layoutType.value = 'small';
    dispatch.compactMode.value = 'content';
    const store = useNodeStore();
    store.activeNode = node('current', 'parent');
    store.pathNodes = [node('parent')];
    store.childNodes = [node('child', 'current')];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  for (const mode of ['content', 'nav'] as const) {
    it.each<ViewState>(['display', 'add', 'delete', 'move', 'daily_quiz', 'tree_overview', 'official_content'])(
      `returns from %s in ${mode} mode to the root navigation and cancels pending operations`,
      async (viewState) => {
        const store = useNodeStore();
        const dispatch = useKnobDispatch();
        dispatch.compactMode.value = mode;
        store.viewState = viewState;
        store.pendingNodeName = 'unsaved';
        store.operationNode = node('operation');
        store.moveTargetParentId = 'target';
        store.blockedParentIds = ['blocked'];
        store.deleteWithChildren = true;

        await dispatch.onClick();

        expect(getNodeContext).toHaveBeenCalledExactlyOnceWith(null);
        expect(dispatch.compactMode.value).toBe('nav');
        expect(store.activeNode).toBeNull();
        expect(store.pathNodes).toEqual([]);
        expect(store.childNodes).toEqual(rootContext.children);
        expect(store.viewState).toBe('display');
        expect(store.pendingNodeName).toBe('');
        expect(store.operationNode).toBeNull();
        expect(store.moveTargetParentId).toBeNull();
        expect(store.blockedParentIds).toEqual([]);
        expect(store.deleteWithChildren).toBe(false);
      },
    );
  }

  it('keeps the current page while loading and ignores another click during the request', async () => {
    let resolve!: (context: NodeContext) => void;
    getNodeContext.mockReturnValueOnce(new Promise(result => { resolve = result; }));
    const dispatch = useKnobDispatch();
    const store = useNodeStore();

    const click = dispatch.onClick();
    await dispatch.onClick();
    expect(dispatch.compactMode.value).toBe('content');
    expect(store.activeNode?.id).toBe('current');
    expect(getNodeContext).toHaveBeenCalledTimes(1);
    resolve(rootContext);
    await click;
    expect(dispatch.compactMode.value).toBe('nav');
    expect(store.activeNode).toBeNull();
  });

  it('does not reload or replace the list when already at root navigation', async () => {
    const store = useNodeStore();
    store.activeNode = null;
    store.pathNodes = [];
    const children = store.childNodes;
    const dispatch = useKnobDispatch();
    dispatch.compactMode.value = 'nav';

    await dispatch.onClick();

    expect(getNodeContext).not.toHaveBeenCalled();
    expect(store.childNodes).toBe(children);
    expect(dispatch.compactMode.value).toBe('nav');
  });

  it('uses cached root data without another request', async () => {
    setCache(null, rootContext);
    await useKnobDispatch().onClick();
    expect(getNodeContext).not.toHaveBeenCalled();
    expect(useNodeStore().childNodes).toEqual(rootContext.children);
    expect(useKnobDispatch().compactMode.value).toBe('nav');
  });

  it('preserves the page on failure and does not apply stale pending data', async () => {
    const store = useNodeStore();
    await store.loadNode('stale', { skipTransition: true });
    getNodeContext.mockRejectedValueOnce(new Error('Root request failed'));
    store.viewState = 'add';
    store.pendingNodeName = 'draft';

    await useKnobDispatch().onClick();
    store.applyPendingData();

    expect(store.errorMessage).toBe('Root request failed');
    expect(store.activeNode?.id).toBe('current');
    expect(store.viewState).toBe('add');
    expect(store.pendingNodeName).toBe('draft');
    expect(useKnobDispatch().compactMode.value).toBe('content');
  });

  it.each(['large', 'medium'] as const)('keeps the existing click behavior in %s layout', async (layout) => {
    const store = useNodeStore();
    const existingClick = vi.spyOn(store, 'onKnobClick').mockResolvedValue();
    const dispatch = useKnobDispatch();
    dispatch.layoutType.value = layout;
    await dispatch.onClick();
    expect(existingClick).toHaveBeenCalledOnce();
    expect(getNodeContext).not.toHaveBeenCalled();
  });

  it('keeps login switching, double click toggling, and hold confirmation', async () => {
    const dispatch = useKnobDispatch();
    const confirm = vi.spyOn(useNodeStore(), 'confirmOperation').mockResolvedValue();
    await dispatch.onHoldConfirm();
    expect(confirm).toHaveBeenCalledOnce();
    await dispatch.onDoubleClick();
    expect(dispatch.compactMode.value).toBe('nav');
    await dispatch.onDoubleClick();
    expect(dispatch.compactMode.value).toBe('content');

    useAuthStore().user = null;
    await dispatch.onClick();
    expect(useAuthStore().mode).toBe('register');
    expect(getNodeContext).not.toHaveBeenCalled();
  });

  it.each(['add', 'daily_quiz', 'tree_overview', 'official_content'] as const)('restores the full navigation when leaving the mixed %s panel', async (viewState) => {
    const store = useNodeStore();
    store.viewState = viewState;
    const officialTransition = useOfficialTransition();
    if (viewState !== 'add') {
      officialTransition.anchorItemId.value = viewState;
      officialTransition.hideNonAnchorItems.value = true;
    }
    const dispatch = useKnobDispatch();
    dispatch.compactMode.value = 'nav';
    const state = createMainLayoutState();
    state.contentAreaRef.value = document.createElement('section');
    const transition = usePageTransition();
    transition.registerRegion({
      id: 'test-content', type: 'glass', element: state.contentAreaRef,
      shouldShow: page => page.compactMode !== 'nav' || page.viewState === viewState,
    });
    try {
      await dispatch.onClick();
      expect(state.contentAreaRef.value.style.display).toBe('none');
      expect(store.viewState).toBe('display');
      expect(officialTransition.anchorItemId.value).toBeNull();
      expect(officialTransition.hideNonAnchorItems.value).toBe(false);
    } finally {
      transition.unregisterRegion('test-content');
    }
  });

  it.each(['display', 'add'] as const)('returns from %s with root rows ready before the compact entrance', async (viewState) => {
    vi.useFakeTimers();
    useNodeStore().viewState = viewState;
    const state = createMainLayoutState();
    state.initialRender.value = false;
    state.displayedKey.value = 'current';
    const listAnimation = vi.fn();
    const contentAnimation = vi.fn();
    let navigation!: ReturnType<typeof useNavigationState>;
    const Child = defineComponent({
      setup() {
        navigation = useNavigationState();
        useNavigationWatch(navigation, { animateNavPageTransition: listAnimation }, { resetScroll: vi.fn() });
        return () => h('div', navigation.displayItems.value.map(item => h('span', item.id)));
      },
    });
    const Parent = defineComponent({
      setup() {
        provide('contentAnimating', state.contentAnimating);
        const ctx = createMainLayoutContentCtx({
          state,
          display: {
            layoutClasses: computed(() => ({})),
            showEmptyBackground: computed(() => false),
            showTree: computed(() => !useNodeStore().activeNode),
            nonTreeContent: computed(() => null),
            contentKey: computed(() => useNodeStore().activeNode?.id ?? 'root'),
            skipContentGlass: computed(() => false),
          },
        });
        useMainLayoutCompactToggle(ctx);
        setupMainLayoutWatchers(ctx, contentAnimation);
        return () => h('main', [
          h('section', { ref: state.navigationRef, style: { display: 'none' } }, h(Child)),
          h('section', { ref: state.contentAreaRef }, 'current content'),
        ]);
      },
    });
    const wrapper = mount(Parent);
    try {
      await useKnobDispatch().onClick();
      await nextTick();
      expect(state.contentAnimating.value).toBe(true);
      expect(state.displayedKey.value).toBe('current');
      expect(navigation.displayItems.value.some(item => item.id === 'root')).toBe(true);
      expect(navigation.displayItems.value.some(item => item.id === 'child')).toBe(false);
      expect(listAnimation).not.toHaveBeenCalled();
      expect(contentAnimation).not.toHaveBeenCalled();
      await vi.runAllTimersAsync();
      expect(state.navigationRef.value?.style.display).toBe('');
      expect(state.contentAreaRef.value?.style.display).toBe('none');
      expect(state.contentAnimating.value).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});
