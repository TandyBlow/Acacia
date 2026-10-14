// Shared mount harness for cross-module editor save tests: a real component
// running the production wiring (context + save session + watchers) with a
// real headless Tiptap editor, against a store the test provides. Nothing
// about the component lifecycle is stubbed — mount, switch, and unmount are
// the real thing.
import { defineComponent, h, ref, shallowRef } from 'vue';
import { mount } from '@vue/test-utils';
import type { Ref } from 'vue';
import type { Editor } from '@tiptap/core';
import type { VueWrapper } from '@vue/test-utils';
import { makeEditor } from './roundtripTestUtils';
import { createEditorSaveViews } from './MarkdownEditorContext';
import { useMarkdownEditorSave } from './MarkdownEditorSave';
import { useMarkdownEditorWatchers } from './MarkdownEditorWatchers';

export interface EditorHarnessCtx {
  store: unknown;
  activeNode: Ref<{ id: string; content: string } | null>;
  draft: Ref<string>;
  saveConflict: Ref<unknown>;
  lastSavedContent: Ref<string>;
  isParseDegraded: Ref<boolean>;
  integrityIssueText: Ref<string>;
  hasUserEdited: Ref<boolean>;
  isChatSunk: Ref<boolean>;
  isFileSunk: Ref<boolean>;
  chatMode: Ref<string>;
  editor: Ref<Editor | undefined>;
  [key: string]: unknown;
}

export interface EditorHarness {
  wrapper: VueWrapper;
  ctx: EditorHarnessCtx;
  save: ReturnType<typeof useMarkdownEditorSave>;
}

export function mountEditorHarness(store: unknown, initialNode: { id: string; content: string } | null): EditorHarness {
  let exposed: { ctx: EditorHarnessCtx; save: ReturnType<typeof useMarkdownEditorSave> } | null = null;

  const Harness = defineComponent({
    name: 'EditorSaveHarness',
    setup(_, { expose }) {
      const activeNode = ref(initialNode);
      // A real headless editor with the production extension stack.
      const editor = shallowRef<Editor>(makeEditor());
      const ctx = {
        store,
        activeNode,
        ...createEditorSaveViews(activeNode),
        draft: ref(''),
        isParseDegraded: ref(false),
        integrityIssueText: ref(''),
        hasUserEdited: ref(false),
        isChatSunk: ref(false),
        isFileSunk: ref(false),
        userInput: ref(''),
        pendingFile: ref(null),
        lastActiveNodeId: ref<string | null>(null),
        editorRef: shallowRef<HTMLElement | null>(null),
        chatMode: ref('idle'),
        hasResumableSession: ref(false),
        setEditor: () => undefined,
        exitChat: () => undefined,
        resetForNewNode: () => undefined,
        setNodeId: () => undefined,
        hasResumableSessionCheck: () => false,
        registerRegion: () => undefined,
        unregisterRegion: () => undefined,
        editor,
        t: (key: string) => key,
        isApplyingExternalContent: ref(false),
      };
      const save = useMarkdownEditorSave(ctx as never);
      useMarkdownEditorWatchers(ctx as never, {
        save: save as never,
        editor: editor as never,
        onCinemaChatMode: () => undefined,
      });
      exposed = { ctx: ctx as EditorHarnessCtx, save };
      expose(exposed);
      return () => h('div');
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrapper = mount(Harness);
  return { wrapper, ...exposed! } as EditorHarness;
}
