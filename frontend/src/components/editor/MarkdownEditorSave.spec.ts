// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { MarkdownEditorContext } from './MarkdownEditorContext';

// MarkdownEditorSave keeps its pending save in module state, so each test
// needs a fresh module instance.
function makeCtx() {
  return {
    activeNode: ref<{ id: string; content: string } | null>({ id: 'n1', content: 'old' }),
    lastSavedContent: ref('old'),
    draft: ref(''),
    store: { saveActiveNodeContent: vi.fn().mockResolvedValue(true) },
  };
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
});
