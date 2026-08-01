// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mode,
  sessionId,
  messages,
  generatedContent,
  isBusy,
  errorMessage,
  currentNodeId,
  currentSubTopic,
  isCompleted,
  totalKp,
  currentKpIndex,
  currentKpData,
} from './chatState';
import { useGlobalLoading } from './useGlobalLoading';
import { sendMessage, skipTurn } from './chatTurn';

const mocks = vi.hoisted(() => ({
  fetchWithTimeout: vi.fn(),
  getAuthHeaders: vi.fn(),
  saveCheckpoint: vi.fn(),
  insertGeneratedContent: vi.fn(),
}));

vi.mock('./chatHttp', () => ({
  fetchWithTimeout: mocks.fetchWithTimeout,
  backendUrl: 'http://test-backend',
  getAuthHeaders: mocks.getAuthHeaders,
}));

vi.mock('./chatCheckpoint', () => ({
  saveCheckpoint: mocks.saveCheckpoint,
  loadCheckpointForNode: vi.fn(),
  clearCheckpointForNode: vi.fn(),
}));

vi.mock('./chatEditor', () => ({
  insertGeneratedContent: mocks.insertGeneratedContent,
}));

function resetState() {
  mode.value = 'idle';
  sessionId.value = null;
  messages.value = [];
  generatedContent.value = '';
  isBusy.value = false;
  errorMessage.value = '';
  currentNodeId.value = null;
  currentSubTopic.value = '';
  isCompleted.value = false;
  totalKp.value = 1;
  currentKpIndex.value = 0;
  currentKpData.value = null;
}

function okResponse(data: Record<string, unknown>) {
  return { ok: true, json: vi.fn().mockResolvedValue(data) };
}

describe('sendMessage', () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
    mocks.getAuthHeaders.mockReturnValue({ 'Content-Type': 'application/json' });
  });

  it('returns early without a network call when there is no sessionId', async () => {
    sessionId.value = null;

    await sendMessage('你好');

    expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
    expect(isBusy.value).toBe(false);
    expect(messages.value).toEqual([]);
  });

  it('returns early without a network call when already busy', async () => {
    sessionId.value = 's1';
    isBusy.value = true;

    await sendMessage('你好');

    expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
    expect(isBusy.value).toBe(true);
  });

  it('posts the user answer and stores the AI reply and progress state on success', async () => {
    sessionId.value = 's1';
    mocks.fetchWithTimeout.mockResolvedValueOnce(
      okResponse({
        ai_message: 'AI回复',
        generated_content: '生成内容',
        action: 'question',
        sub_topic: '子主题',
        completed: true,
        total_kp: 5,
        current_kp_index: 2,
        kp_data: { note: 'n' },
        knowledge_note: '知识笔记',
        consolidated_content: '合并内容',
      }),
    );

    const result = await sendMessage('用户回答');

    expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(mocks.fetchWithTimeout).toHaveBeenCalledWith('http://test-backend/chat/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 's1', user_answer: '用户回答' }),
    });
    expect(messages.value[0]).toEqual({ role: 'user', content: '用户回答' });
    expect(messages.value[1]).toMatchObject({ role: 'ai', content: 'AI回复' });
    expect(generatedContent.value).toBe('生成内容');
    expect(currentSubTopic.value).toBe('子主题');
    expect(isCompleted.value).toBe(true);
    expect(totalKp.value).toBe(5);
    expect(currentKpIndex.value).toBe(2);
    expect(currentKpData.value).toEqual({ note: 'n' });
    expect(mocks.insertGeneratedContent).toHaveBeenCalledWith('生成内容');
    expect(mocks.saveCheckpoint).toHaveBeenCalledTimes(1);
    expect(isBusy.value).toBe(false);
    expect(errorMessage.value).toBe('');
    expect(result).toEqual({
      ai_message: 'AI回复',
      generated_content: '生成内容',
      knowledge_note: '知识笔记',
      action: 'question',
      sub_topic: '子主题',
      consolidated_content: '合并内容',
      completed: true,
    });
  });

  it('appends generated content with a separator when content already exists', async () => {
    sessionId.value = 's1';
    generatedContent.value = '第一段';
    mocks.fetchWithTimeout.mockResolvedValueOnce(okResponse({ generated_content: '第二段' }));

    await sendMessage('x');

    expect(generatedContent.value).toBe('第一段\n\n第二段');
  });

  it('skips editor insertion when skipInsertContent option is set', async () => {
    sessionId.value = 's1';
    mocks.fetchWithTimeout.mockResolvedValueOnce(okResponse({ ai_message: 'a', generated_content: 'g' }));

    await sendMessage('x', { skipInsertContent: true });

    expect(generatedContent.value).toBe('g');
    expect(mocks.insertGeneratedContent).not.toHaveBeenCalled();
  });

  it('reports the server error detail and does not push an AI message on non-ok response', async () => {
    sessionId.value = 's1';
    mocks.fetchWithTimeout.mockResolvedValueOnce({
      ok: false,
      json: vi.fn().mockResolvedValue({ detail: '服务器内部错误' }),
    });

    const result = await sendMessage('x');

    expect(errorMessage.value).toBe('服务器内部错误');
    expect(isBusy.value).toBe(false);
    expect(messages.value).toHaveLength(1);
    expect(mocks.saveCheckpoint).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('falls back to the default message when the error body cannot be parsed', async () => {
    sessionId.value = 's1';
    mocks.fetchWithTimeout.mockResolvedValueOnce({
      ok: false,
      json: vi.fn().mockRejectedValue(new Error('parse failed')),
    });

    await sendMessage('x');

    expect(errorMessage.value).toBe('对话处理失败');
    expect(isBusy.value).toBe(false);
  });

  it('captures a thrown Error message into errorMessage', async () => {
    sessionId.value = 's1';
    mocks.fetchWithTimeout.mockRejectedValueOnce(new Error('网络连接失败'));

    await sendMessage('x');

    expect(errorMessage.value).toBe('网络连接失败');
    expect(isBusy.value).toBe(false);
  });

  it('falls back to the default message for non-Error rejections', async () => {
    sessionId.value = 's1';
    mocks.fetchWithTimeout.mockRejectedValueOnce('boom');

    await sendMessage('x');

    expect(errorMessage.value).toBe('对话处理失败');
    expect(isBusy.value).toBe(false);
  });

  it('toggles the global nodeChat loading source around the request', async () => {
    sessionId.value = 's1';
    mocks.fetchWithTimeout.mockResolvedValueOnce(okResponse({ ai_message: 'a' }));
    const { registerLoadingSource, isLoading } = useGlobalLoading();
    registerLoadingSource('nodeChat');

    const p = sendMessage('x');
    expect(isLoading.value).toBe(true);

    await p;
    expect(isLoading.value).toBe(false);
  });
});

describe('skipTurn', () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
    mocks.getAuthHeaders.mockReturnValue({ 'Content-Type': 'application/json' });
  });

  it('returns early without a network call when there is no sessionId', async () => {
    sessionId.value = null;

    await skipTurn();

    expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
    expect(isBusy.value).toBe(false);
  });

  it('posts a skip flag and records the AI continuation message', async () => {
    sessionId.value = 's1';
    mocks.fetchWithTimeout.mockResolvedValueOnce(
      okResponse({
        ai_message: '继续讲解',
        action: 'explain',
        sub_topic: '子主题',
        completed: true,
        total_kp: 3,
        current_kp_index: 1,
        kp_data: { extra: true },
      }),
    );

    const result = await skipTurn();

    expect(mocks.fetchWithTimeout).toHaveBeenCalledWith('http://test-backend/chat/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 's1', user_answer: '', skip: true }),
    });
    expect(messages.value).toHaveLength(1);
    expect(messages.value[0]).toMatchObject({ role: 'ai', content: '继续讲解' });
    expect(isCompleted.value).toBe(true);
    expect(totalKp.value).toBe(3);
    expect(currentKpIndex.value).toBe(1);
    expect(currentKpData.value).toEqual({ extra: true });
    expect(mocks.saveCheckpoint).toHaveBeenCalledTimes(1);
    expect(isBusy.value).toBe(false);
    expect(errorMessage.value).toBe('');
    expect(result).toEqual({
      ai_message: '继续讲解',
      generated_content: '',
      action: 'explain',
      sub_topic: '子主题',
    });
  });

  it('does not push a message when the response has no ai_message', async () => {
    sessionId.value = 's1';
    mocks.fetchWithTimeout.mockResolvedValueOnce(okResponse({ action: 'question' }));

    const result = await skipTurn();

    expect(messages.value).toEqual([]);
    expect(isBusy.value).toBe(false);
    expect(result).toEqual({ ai_message: '', generated_content: '', action: 'question', sub_topic: '' });
  });

  it('reports the server error detail on a non-ok response', async () => {
    sessionId.value = 's1';
    mocks.fetchWithTimeout.mockResolvedValueOnce({
      ok: false,
      json: vi.fn().mockResolvedValue({ detail: '跳过失败详情' }),
    });

    await skipTurn();

    expect(errorMessage.value).toBe('跳过失败详情');
    expect(isBusy.value).toBe(false);
    expect(mocks.saveCheckpoint).not.toHaveBeenCalled();
  });

  it('captures a thrown error message', async () => {
    sessionId.value = 's1';
    mocks.fetchWithTimeout.mockRejectedValueOnce(new Error('跳过错误'));

    await skipTurn();

    expect(errorMessage.value).toBe('跳过错误');
    expect(isBusy.value).toBe(false);
  });
});
