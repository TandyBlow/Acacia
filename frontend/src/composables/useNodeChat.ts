import { ref, computed } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import { useGlobalLoading } from './useGlobalLoading';

const FETCH_TIMEOUT = 90_000;

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = FETCH_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:7860';

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('acacia_backend_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export interface ChatMessage {
  role: 'user' | 'ai';
  content: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export type ChatMode = 'idle' | 'text_input' | 'file_upload' | 'conversing' | 'completed';

interface ChatCheckpoint {
  sessionId: string;
  nodeId: string;
  mode: string;
  timestamp: number;
}

const CHECKPOINT_KEY = 'acacia_chat_checkpoint_v1';

// ── Reactive state ──────────────────────────────────────────────────

const mode = ref<ChatMode>('idle');
const sessionId = ref<string | null>(null);
const messages = ref<ChatMessage[]>([]);
const generatedContent = ref('');
const isBusy = ref(false);
const errorMessage = ref('');
const referenceText = ref('');
const referenceFileName = ref<string | null>(null);
const currentNodeId = ref<string | null>(null);
const currentSubTopic = ref('');
const totalKp = ref(1);
const currentKpIndex = ref(0);
const currentKpData = ref<Record<string, unknown> | null>(null);
const isCompleted = ref(false);

const { setLoading: setGlobalLoading } = useGlobalLoading();

let editorRef: Editor | null = null;

// ── Computed ────────────────────────────────────────────────────────

const hasActiveConversation = computed(() =>
  sessionId.value !== null && mode.value === 'conversing'
);

const hasResumableSession = computed(() => {
  const cp = loadCheckpoint();
  return cp !== null && cp.nodeId === currentNodeId.value;
});

// ── Checkpoint persistence ──────────────────────────────────────────

function saveCheckpoint() {
  if (!sessionId.value || !currentNodeId.value) return;
  const checkpoint: ChatCheckpoint = {
    sessionId: sessionId.value,
    nodeId: currentNodeId.value,
    mode: mode.value,
    timestamp: Date.now(),
  };
  try {
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(checkpoint));
  } catch { /* ignore */ }
}

function loadCheckpoint(): ChatCheckpoint | null {
  try {
    const raw = localStorage.getItem(CHECKPOINT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ChatCheckpoint;
  } catch {
    return null;
  }
}

function clearCheckpoint() {
  localStorage.removeItem(CHECKPOINT_KEY);
}

// ── Public functions ────────────────────────────────────────────────

export function useNodeChat() {
  function setEditor(editor: Editor | null) {
    editorRef = editor;
  }

  function setNodeId(nodeId: string) {
    currentNodeId.value = nodeId;
  }

  function insertGeneratedContent(content: string) {
    if (!editorRef || !content) return;
    try {
      // Use TipTap's built-in markdown extension (same pattern as useFileGenerate)
      const parsed = (editorRef as any).markdown?.parse(content);
      if (parsed) {
        const { doc } = editorRef.state;
        const endPos = doc.content.size;
        editorRef.commands.focus();
        editorRef.commands.setTextSelection(endPos);
        editorRef.commands.insertContent(parsed);
        editorRef.commands.scrollIntoView();
      } else {
        // Fallback: insert at end as plain text
        const { doc } = editorRef.state;
        editorRef.commands.insertContentAt(doc.content.size, content);
      }
    } catch {
      // If all else fails, insert as plain text
      try {
        editorRef.commands.insertContent(content);
      } catch { /* ignore */ }
    }
  }

  async function startTextChat(nodeId: string, nodeName: string, text: string) {
    isBusy.value = true;
    errorMessage.value = '';
    setGlobalLoading('nodeChat', true);

    try {
      const resp = await fetchWithTimeout(`${backendUrl}/chat/start`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ node_id: nodeId, node_name: nodeName, reference_text: text }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: '启动对话失败' }));
        throw new Error(err.detail || '启动对话失败');
      }

      const data = await resp.json();
      sessionId.value = data.session_id;
      currentNodeId.value = nodeId;
      referenceText.value = text;
      referenceFileName.value = null;
      messages.value = [{
        role: 'ai',
        content: data.question,
        metadata: { action: data.action, sub_topic: data.sub_topic },
      }];
      currentSubTopic.value = data.sub_topic || '';
      totalKp.value = data.total_kp || 1;
      currentKpIndex.value = data.current_kp_index || 0;
      currentKpData.value = data.kp_data || null;
      mode.value = 'conversing';
      saveCheckpoint();
      return { question: data.question, action: data.action, sub_topic: data.sub_topic };
    } catch (e: unknown) {
      errorMessage.value = e instanceof Error ? e.message : '启动对话失败';
      throw e;
    } finally {
      isBusy.value = false;
      setGlobalLoading('nodeChat', false);
    }
  }

  async function startFileChat(nodeId: string, nodeName: string, fileId: string, fileName: string, fileText?: string) {
    isBusy.value = true;
    errorMessage.value = '';
    setGlobalLoading('nodeChat', true);

    try {
      const resp = await fetchWithTimeout(`${backendUrl}/chat/start`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          node_id: nodeId,
          node_name: nodeName,
          file_id: fileId,
          reference_text: fileText || '',
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: '启动对话失败' }));
        throw new Error(err.detail || '启动对话失败');
      }

      const data = await resp.json();
      sessionId.value = data.session_id;
      currentNodeId.value = nodeId;
      referenceFileName.value = fileName;
      messages.value = [{
        role: 'ai',
        content: data.question,
        metadata: { action: data.action, sub_topic: data.sub_topic },
      }];
      currentSubTopic.value = data.sub_topic || '';
      totalKp.value = data.total_kp || 1;
      currentKpIndex.value = data.current_kp_index || 0;
      currentKpData.value = data.kp_data || null;
      mode.value = 'conversing';
      saveCheckpoint();
      return { question: data.question, action: data.action, sub_topic: data.sub_topic };
    } catch (e: unknown) {
      errorMessage.value = e instanceof Error ? e.message : '启动对话失败';
      throw e;
    } finally {
      isBusy.value = false;
      setGlobalLoading('nodeChat', false);
    }
  }

  async function sendMessage(answer: string) {
    if (!sessionId.value || isBusy.value) return;
    isBusy.value = true;
    errorMessage.value = '';
    setGlobalLoading('nodeChat', true);

    messages.value.push({ role: 'user', content: answer });

    try {
      const resp = await fetchWithTimeout(`${backendUrl}/chat/turn`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ session_id: sessionId.value, user_answer: answer }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: '对话处理失败' }));
        throw new Error(err.detail || '对话处理失败');
      }

      const data = await resp.json();

      messages.value.push({
        role: 'ai',
        content: data.ai_message,
        metadata: { action: data.action, sub_topic: data.sub_topic },
      });

      if (data.generated_content) {
        generatedContent.value += (generatedContent.value ? '\n\n' : '') + data.generated_content;
        insertGeneratedContent(data.generated_content);
      }

      if (data.sub_topic) {
        currentSubTopic.value = data.sub_topic;
      }

      if (data.completed) {
        isCompleted.value = true;
        mode.value = 'completed';
      }

      totalKp.value = data.total_kp || totalKp.value;
      currentKpIndex.value = data.current_kp_index ?? currentKpIndex.value;
      currentKpData.value = data.kp_data || currentKpData.value;

      saveCheckpoint();
      return { ai_message: data.ai_message, generated_content: data.generated_content, action: data.action, sub_topic: data.sub_topic };
    } catch (e: unknown) {
      errorMessage.value = e instanceof Error ? e.message : '对话处理失败';
    } finally {
      isBusy.value = false;
      setGlobalLoading('nodeChat', false);
    }
  }

  async function skipTurn() {
    if (!sessionId.value || isBusy.value) return;
    isBusy.value = true;
    errorMessage.value = '';
    setGlobalLoading('nodeChat', true);

    try {
      const resp = await fetchWithTimeout(`${backendUrl}/chat/turn`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ session_id: sessionId.value, user_answer: '', skip: true }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: '跳过失败' }));
        throw new Error(err.detail || '跳过失败');
      }

      const data = await resp.json();

      if (data.ai_message) {
        messages.value.push({
          role: 'ai',
          content: data.ai_message,
          metadata: { action: data.action, sub_topic: data.sub_topic },
        });
      }

      if (data.completed) {
        isCompleted.value = true;
        mode.value = 'completed';
      }

      totalKp.value = data.total_kp || totalKp.value;
      currentKpIndex.value = data.current_kp_index ?? currentKpIndex.value;
      currentKpData.value = data.kp_data || currentKpData.value;

      saveCheckpoint();
      return { ai_message: data.ai_message || '', generated_content: '', action: data.action || 'question', sub_topic: data.sub_topic || '' };
    } catch (e: unknown) {
      errorMessage.value = e instanceof Error ? e.message : '跳过失败';
    } finally {
      isBusy.value = false;
      setGlobalLoading('nodeChat', false);
    }
  }

  async function endConversation() {
    if (!sessionId.value || isBusy.value) return;
    isBusy.value = true;
    errorMessage.value = '';
    setGlobalLoading('nodeChat', true);

    try {
      const resp = await fetchWithTimeout(`${backendUrl}/chat/end`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ session_id: sessionId.value }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: '结束对话失败' }));
        throw new Error(err.detail || '结束对话失败');
      }

      const data = await resp.json();
      isCompleted.value = true;
      mode.value = 'completed';

      if (data.ai_message) {
        messages.value.push({
          role: 'ai',
          content: data.ai_message,
          metadata: { action: 'end_conversation' },
        });
      }

      saveCheckpoint();
      return { ai_message: data.ai_message || '', generated_content: '', action: 'end_conversation' };
    } catch (e: unknown) {
      errorMessage.value = e instanceof Error ? e.message : '结束对话失败';
    } finally {
      isBusy.value = false;
      setGlobalLoading('nodeChat', false);
    }
  }

  async function regenerateWithTreeContext(treeContext: string) {
    if (!sessionId.value || isBusy.value) return;
    isBusy.value = true;
    errorMessage.value = '';
    setGlobalLoading('nodeChat', true);

    try {
      const resp = await fetchWithTimeout(`${backendUrl}/chat/regenerate`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ session_id: sessionId.value, tree_context: treeContext }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: '重新生成失败' }));
        throw new Error(err.detail || '重新生成失败');
      }

      const data = await resp.json();

      // Replace last AI message
      const lastAiIdx = findLastAiMessageIndex();
      if (lastAiIdx >= 0) {
        messages.value[lastAiIdx] = {
          role: 'ai',
          content: data.ai_message,
          metadata: { action: data.action, sub_topic: data.sub_topic, regenerated: true },
        };
      } else {
        messages.value.push({
          role: 'ai',
          content: data.ai_message,
          metadata: { action: data.action, sub_topic: data.sub_topic, regenerated: true },
        });
      }

      saveCheckpoint();
      return { ai_message: data.ai_message, action: data.action, sub_topic: data.sub_topic };
    } catch (e: unknown) {
      errorMessage.value = e instanceof Error ? e.message : '重新生成失败';
    } finally {
      isBusy.value = false;
      setGlobalLoading('nodeChat', false);
    }
  }

  async function markConcept(conceptName: string): Promise<{ node_id: string; name: string } | null> {
    if (!sessionId.value || isBusy.value) return null;
    isBusy.value = true;
    setGlobalLoading('nodeChat', true);

    try {
      const resp = await fetchWithTimeout(`${backendUrl}/chat/mark-concept`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ session_id: sessionId.value, concept_name: conceptName }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: '标记概念失败' }));
        throw new Error(err.detail || '标记概念失败');
      }

      const data = await resp.json();

      messages.value.push({
        role: 'ai',
        content: `已创建子节点「${conceptName}」。你可以随时离开去学习它。`,
        metadata: { action: 'concept_marked', concept_name: conceptName },
      });

      return { node_id: data.node_id, name: data.name };
    } catch (e: unknown) {
      errorMessage.value = e instanceof Error ? e.message : '标记概念失败';
      return null;
    } finally {
      isBusy.value = false;
      setGlobalLoading('nodeChat', false);
    }
  }

  async function resumeChat(nodeId: string): Promise<boolean> {
    const cp = loadCheckpoint();
    if (!cp || cp.nodeId !== nodeId) return false;

    isBusy.value = true;
    setGlobalLoading('nodeChat', true);

    try {
      const resp = await fetchWithTimeout(`${backendUrl}/chat/sessions/${cp.sessionId}`, {
        headers: getAuthHeaders(),
      });
      if (!resp.ok) {
        clearCheckpoint();
        return false;
      }

      const data = await resp.json();
      sessionId.value = data.session_id;
      currentNodeId.value = nodeId;
      messages.value = data.messages || [];
      generatedContent.value = data.generated_content || '';
      totalKp.value = data.total_kp || 1;
      currentKpIndex.value = data.current_kp_index || 0;
      currentKpData.value = data.kp_data || null;
      mode.value = 'conversing';
      return true;
    } catch {
      clearCheckpoint();
      return false;
    } finally {
      isBusy.value = false;
      setGlobalLoading('nodeChat', false);
    }
  }

  function resetForNewNode() {
    sessionId.value = null;
    messages.value = [];
    generatedContent.value = '';
    mode.value = 'idle';
    errorMessage.value = '';
    referenceText.value = '';
    referenceFileName.value = null;
    currentSubTopic.value = '';
    totalKp.value = 1;
    currentKpIndex.value = 0;
    currentKpData.value = null;
    isCompleted.value = false;
    clearCheckpoint();
  }

  function abandonChat() {
    sessionId.value = null;
    messages.value = [];
    generatedContent.value = '';
    mode.value = 'idle';
    errorMessage.value = '';
    referenceText.value = '';
    referenceFileName.value = null;
    currentSubTopic.value = '';
    totalKp.value = 1;
    currentKpIndex.value = 0;
    currentKpData.value = null;
    isCompleted.value = false;
    clearCheckpoint();
  }

  function setTextMode() {
    mode.value = 'text_input';
    referenceFileName.value = null;
    errorMessage.value = '';
  }

  function setFileMode() {
    mode.value = 'file_upload';
    referenceText.value = '';
    errorMessage.value = '';
  }

  function findLastAiMessageIndex(): number {
    const msgs = messages.value;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i]?.role === 'ai') return i;
    }
    return -1;
  }

  function closeChatPanel() {
    if (mode.value !== 'conversing') {
      mode.value = 'idle';
    }
  }

  return {
    // State
    mode,
    sessionId,
    messages,
    generatedContent,
    isBusy,
    errorMessage,
    referenceText,
    referenceFileName,
    currentNodeId,
    currentSubTopic,
    totalKp,
    currentKpIndex,
    currentKpData,
    isCompleted,
    // Computed
    hasActiveConversation,
    hasResumableSession,
    // Actions
    setEditor,
    setNodeId,
    insertGeneratedContent,
    startTextChat,
    startFileChat,
    sendMessage,
    skipTurn,
    endConversation,
    regenerateWithTreeContext,
    markConcept,
    resumeChat,
    resetForNewNode,
    abandonChat,
    setTextMode,
    setFileMode,
    closeChatPanel,
  };
}
