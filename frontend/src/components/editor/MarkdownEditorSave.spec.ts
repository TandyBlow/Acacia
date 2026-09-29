// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { MarkdownEditorContext } from './MarkdownEditorContext';

// migrateMathStrings walks editor.state/view, which the mock editor lacks.
vi.mock('@tiptap/extension-mathematics', () => ({ migrateMathStrings: vi.fn() }));

// MarkdownEditorSave keeps its pending save in module state, so each test
// needs a fresh module instance.
function makeCtx() {
  return {
    activeNode: ref<{ id: string; content: string } | null>({ id: 'n1', content: 'old' }),
    lastSavedContent: ref('old'),
    draft: ref(''),
    isParseDegraded: ref(false),
    isApplyingExternalContent: ref(false),
    editor: ref<{
      commands: { setContent: ReturnType<typeof vi.fn> };
      setEditable: ReturnType<typeof vi.fn>;
      markdown?: unknown;
      schema?: unknown;
    }>({ commands: { setContent: vi.fn() }, setEditable: vi.fn() }),
    store: { saveActiveNodeContent: vi.fn().mockResolvedValue(true) },
  };
}

/** Mock editor without a markdown manager: every parse fails through this one. */
function makeEditor(overrides: Record<string, unknown> = {}) {
  return {
    commands: { setContent: vi.fn() },
    setEditable: vi.fn(),
    ...overrides,
  };
}

/** Mock editor whose markdown manager parses to a fixed valid doc. */
function makeParsingEditor(parsedDoc: unknown) {
  return makeEditor({
    markdown: { parse: vi.fn(() => parsedDoc) },
    schema: {
      nodes: { doc: {}, paragraph: {}, text: {} },
      nodeFromJSON: () => ({ check: vi.fn() }),
    },
  });
}

async function loadSave(ctx: ReturnType<typeof makeCtx>) {
  vi.resetModules();
  const mod = await import('./MarkdownEditorSave');
  return mod.useMarkdownEditorSave(ctx as unknown as MarkdownEditorContext);
}

describe('MarkdownEditorSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('flushes content that is still inside the debounce window', async () => {
    const ctx = makeCtx();
    const save = await loadSave(ctx);

    save.scheduleAutoSave('n1', 'typed content');
    // Well short of AUTO_SAVE_DELAY_MS — the timer has not fired.
    await vi.advanceTimersByTimeAsync(50);
    expect(ctx.store.saveActiveNodeContent).not.toHaveBeenCalled();

    save.flushPendingSave();
    await vi.runAllTimersAsync();

    expect(ctx.store.saveActiveNodeContent).toHaveBeenCalledWith(
      'n1',
      'typed content',
      expect.objectContaining({ force: true }),
    );
    expect(ctx.lastSavedContent.value).toBe('typed content');
  });

  it('forwards keepalive so the flush can outlive the page', async () => {
    const ctx = makeCtx();
    const save = await loadSave(ctx);

    save.scheduleAutoSave('n1', 'typed content');
    save.flushPendingSave({ keepalive: true });
    await vi.runAllTimersAsync();

    expect(ctx.store.saveActiveNodeContent).toHaveBeenCalledWith(
      'n1',
      'typed content',
      expect.objectContaining({ force: true, keepalive: true }),
    );
  });

  it('does nothing when no save is pending', async () => {
    const ctx = makeCtx();
    const save = await loadSave(ctx);

    save.flushPendingSave();
    await vi.runAllTimersAsync();

    expect(ctx.store.saveActiveNodeContent).not.toHaveBeenCalled();
  });

  it('keeps the content pending when the write fails, and retries', async () => {
    const ctx = makeCtx();
    ctx.store.saveActiveNodeContent.mockResolvedValue(false);
    const save = await loadSave(ctx);

    save.scheduleAutoSave('n1', 'typed content');
    save.flushPendingSave();
    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.store.saveActiveNodeContent).toHaveBeenCalledTimes(1);
    expect(ctx.lastSavedContent.value).toBe('old');

    // The retry timer must still carry the unsaved content.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ctx.store.saveActiveNodeContent.mock.calls.length).toBeGreaterThan(1);
  });

  it('does not advance lastSavedContent when the store rejects the write', async () => {
    const ctx = makeCtx();
    ctx.store.saveActiveNodeContent.mockResolvedValue(false);
    const save = await loadSave(ctx);

    await save.enqueueSave('n1', 'typed content');

    expect(ctx.lastSavedContent.value).toBe('old');
  });

  it('goes read-only and degraded when parsing fails', async () => {
    const ctx = makeCtx();
    const save = await loadSave(ctx);

    save.syncEditorContent('# Title\n\nSome **bold** text with $E=mc^2$.');

    expect(ctx.isParseDegraded.value).toBe(true);
    expect(ctx.editor.value.setEditable).toHaveBeenCalledWith(false);
    // The flat fallback is still shown so the user can see the content.
    expect(ctx.editor.value.commands.setContent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'doc' }),
      expect.objectContaining({ emitUpdate: false }),
    );
  });

  it('never persists a degraded doc through any save path', async () => {
    const ctx = makeCtx();
    const save = await loadSave(ctx);
    save.syncEditorContent('# Title');

    save.scheduleAutoSave('n1', 'flattened');
    await vi.runAllTimersAsync();
    save.flushPendingSave();
    await vi.runAllTimersAsync();
    const forced = await save.enqueueSave('n1', 'flattened', { force: true });

    expect(forced).toBe(false);
    expect(ctx.store.saveActiveNodeContent).not.toHaveBeenCalled();
    expect(ctx.lastSavedContent.value).toBe('old');
  });

  it('recovers saving when a later load parses successfully', async () => {
    const ctx = makeCtx();
    const save = await loadSave(ctx);
    save.syncEditorContent('# Title');
    expect(ctx.isParseDegraded.value).toBe(true);

    const parsedDoc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    };
    ctx.editor.value = makeParsingEditor(parsedDoc);
    save.syncEditorContent('# Title');

    expect(ctx.isParseDegraded.value).toBe(false);
    expect(ctx.editor.value.setEditable).toHaveBeenLastCalledWith(true);
    expect(ctx.editor.value.commands.setContent).toHaveBeenLastCalledWith(
      parsedDoc,
      expect.objectContaining({ emitUpdate: false }),
    );

    save.scheduleAutoSave('n1', 'parsed content');
    await vi.runAllTimersAsync();
    expect(ctx.store.saveActiveNodeContent).toHaveBeenCalledWith('n1', 'parsed content', undefined);
  });
});
