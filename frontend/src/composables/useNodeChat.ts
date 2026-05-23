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

export interface MentionedConcept {
  name: string;
  category: string;
  definition: string;
  prerequisites: string[];
  expansion_directions: string[];
  verified: boolean;
  wiki_summary: string;
  wiki_description: string;
}

export type ChatMode = 'idle' | 'text_input' | 'file_upload' | 'file_uploaded' | 'conversing';

interface ChatCheckpoint {
  sessionId: string;
  nodeId: string;
  mode: string;
  timestamp: number;
}

const CHECKPOINT_MAP_KEY = 'acacia_chat_checkpoint_map_v1';
const MAX_CHECKPOINT_ENTRIES = 50;

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
const openingMessage = ref('');
const contextChain = ref<any[]>([]);
const newLearnings = ref<any[]>([]);
const mentionedConcepts = ref<MentionedConcept[]>([]);
const markedConceptNames = ref<Set<string>>(new Set());

const { setLoading: setGlobalLoading } = useGlobalLoading();

let editorRef: Editor | null = null;

// ── Computed ────────────────────────────────────────────────────────

const hasActiveConversation = computed(() =>
  sessionId.value !== null && mode.value === 'conversing'
);

const hasResumableSession = computed(() => {
  const cp = loadCheckpointForNode(currentNodeId.value || '');
  return cp !== null && (cp.mode === 'conversing' || cp.mode === 'paused');
});

// ── Checkpoint persistence (per-node map) ──────────────────────────────

interface CheckpointMap {
  [nodeId: string]: ChatCheckpoint;
}

function saveCheckpoint() {
  if (!sessionId.value || !currentNodeId.value) return;
  const checkpoint: ChatCheckpoint = {
    sessionId: sessionId.value,
    nodeId: currentNodeId.value,
    mode: mode.value,
    timestamp: Date.now(),
  };
  try {
    const map = loadCheckpointMap();
    map[currentNodeId.value] = checkpoint;
    const entries = Object.entries(map);
    if (entries.length > MAX_CHECKPOINT_ENTRIES) {
      entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
      const trimmed: CheckpointMap = {};
      entries.slice(0, MAX_CHECKPOINT_ENTRIES).forEach(([k, v]) => trimmed[k] = v);
      localStorage.setItem(CHECKPOINT_MAP_KEY, JSON.stringify(trimmed));
    } else {
      localStorage.setItem(CHECKPOINT_MAP_KEY, JSON.stringify(map));
    }
  } catch { /* ignore */ }
}

function loadCheckpointMap(): CheckpointMap {
  try {
    const raw = localStorage.getItem(CHECKPOINT_MAP_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function loadCheckpointForNode(nodeId: string): ChatCheckpoint | null {
  const map = loadCheckpointMap();
  return map[nodeId] || null;
}

function clearCheckpointForNode(nodeId: string) {
  const map = loadCheckpointMap();
  delete map[nodeId];
  localStorage.setItem(CHECKPOINT_MAP_KEY, JSON.stringify(map));
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
      _updateConcepts(data);
      return { question: data.question, action: data.action, sub_topic: data.sub_topic, knowledge_note: data.knowledge_note || '' };
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
      _updateConcepts(data);
      return { question: data.question, action: data.action, sub_topic: data.sub_topic, knowledge_note: data.knowledge_note || '' };
    } catch (e: unknown) {
      errorMessage.value = e instanceof Error ? e.message : '启动对话失败';
      throw e;
    } finally {
      isBusy.value = false;
      setGlobalLoading('nodeChat', false);
    }
  }

  async function startLineByLineChat(
    nodeId: string,
    nodeName: string,
    fileId: string,
    fileName: string,
    prevNodeId: string | null = null,
    transType: string = 'initial',
    transReason: string = ''
  ) {
    isBusy.value = true;
    errorMessage.value = '';
    setGlobalLoading('nodeChat', true);

    try {
      const body: Record<string, unknown> = {
        node_id: nodeId,
        node_name: nodeName,
        file_id: fileId,
        chat_mode: 'line_by_line',
        previous_node_id: prevNodeId,
        transition_type: transType,
        transition_reason: transReason,
      };

      const resp = await fetchWithTimeout(`${backendUrl}/chat/contextual-start`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: '启动逐句讲解失败' }));
        throw new Error(err.detail || '启动逐句讲解失败');
      }

      const data = await resp.json();
      sessionId.value = data.session_id;
      currentNodeId.value = nodeId;
      referenceFileName.value = fileName;
      openingMessage.value = data.opening_message || data.question;
      messages.value = [{
        role: 'ai',
        content: openingMessage.value,
        metadata: { action: data.action, is_opening: !!data.opening_message },
      }];
      currentSubTopic.value = data.sub_topic || '';
      totalKp.value = 1;
      currentKpIndex.value = 0;
      currentKpData.value = null;
      mode.value = 'conversing';
      saveCheckpoint();
      _updateConcepts(data);
      return { question: openingMessage.value, action: data.action };
    } catch (e: unknown) {
      errorMessage.value = e instanceof Error ? e.message : '启动逐句讲解失败';
      throw e;
    } finally {
      isBusy.value = false;
      setGlobalLoading('nodeChat', false);
    }
  }

  async function startContextualChat(
    nodeId: string,
    nodeName: string,
    text: string,
    prevNodeId: string | null,
    transType: string,
    transReason: string
  ) {
    isBusy.value = true;
    errorMessage.value = '';
    setGlobalLoading('nodeChat', true);

    try {
      const resp = await fetchWithTimeout(`${backendUrl}/chat/contextual-start`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          node_id: nodeId,
          node_name: nodeName,
          reference_text: text,
          previous_node_id: prevNodeId,
          transition_type: transType,
          transition_reason: transReason,
        }),
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
      openingMessage.value = data.opening_message || data.question;

      messages.value = [{
        role: 'ai',
        content: openingMessage.value,
        metadata: {
          action: data.opening_action || data.action,
          sub_topic: data.opening_sub_topic || data.sub_topic,
          is_opening: true,
        },
      }];
      currentSubTopic.value = data.opening_sub_topic || data.sub_topic || '';
      totalKp.value = data.total_kp || 1;
      currentKpIndex.value = data.current_kp_index || 0;
      currentKpData.value = data.kp_data || null;
      mode.value = 'conversing';
      saveCheckpoint();
      _updateConcepts(data);
      return {
        question: openingMessage.value,
        action: data.action,
        sub_topic: currentSubTopic.value,
        knowledge_note: data.knowledge_note || '',
      };
    } catch (e: unknown) {
      errorMessage.value = e instanceof Error ? e.message : '启动对话失败';
      throw e;
    } finally {
      isBusy.value = false;
      setGlobalLoading('nodeChat', false);
    }
  }

  async function fetchContextChain(nodeId: string) {
    try {
      const resp = await fetchWithTimeout(
        `${backendUrl}/context/chain/${nodeId}`,
        { headers: getAuthHeaders() }
      );
      if (resp.ok) {
        const data = await resp.json();
        contextChain.value = data.chain || [];
        newLearnings.value = data.new_learnings_since_last_visit || [];
      }
    } catch { /* non-critical, ignore */ }
  }

  async function recordNavigationTransition(
    fromNodeId: string | null,
    toNodeId: string,
    reason: string = ''
  ) {
    try {
      await fetchWithTimeout(`${backendUrl}/context/record-transition`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          from_node_id: fromNodeId,
          to_node_id: toNodeId,
          transition_type: 'navigation',
          reason,
        }),
      });
    } catch { /* fire-and-forget, ignore errors */ }
  }

  async function sendMessage(answer: string, options?: { skipInsertContent?: boolean }) {
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
        if (!options?.skipInsertContent) {
          insertGeneratedContent(data.generated_content);
        }
      }

      if (data.sub_topic) {
        currentSubTopic.value = data.sub_topic;
      }

      if (data.completed) {
        isCompleted.value = true;
      }

      totalKp.value = data.total_kp || totalKp.value;
      currentKpIndex.value = data.current_kp_index ?? currentKpIndex.value;
      currentKpData.value = data.kp_data || currentKpData.value;

      saveCheckpoint();
      _updateConcepts(data);
      return {
        ai_message: data.ai_message,
        generated_content: data.generated_content,
        knowledge_note: data.knowledge_note || '',
        action: data.action,
        sub_topic: data.sub_topic,
        consolidated_content: data.consolidated_content || '',
        completed: data.completed || false,
      };
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
      }

      totalKp.value = data.total_kp || totalKp.value;
      currentKpIndex.value = data.current_kp_index ?? currentKpIndex.value;
      currentKpData.value = data.kp_data || currentKpData.value;

      saveCheckpoint();
      _updateConcepts(data);
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

      if (data.ai_message) {
        messages.value.push({
          role: 'ai',
          content: data.ai_message,
          metadata: { action: 'end_conversation' },
        });
      }

      saveCheckpoint();
      _updateConcepts(data);
      return {
        ai_message: data.ai_message || '',
        generated_content: '',
        action: 'end_conversation',
        consolidated_content: data.consolidated_content || '',
      };
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

      if (data.already_exists) {
        messages.value.push({
          role: 'ai',
          content: `知识点「${conceptName}」已存在于当前主题下，无需重复创建。`,
          metadata: { action: 'concept_already_exists', concept_name: conceptName },
        });
      } else {
        messages.value.push({
          role: 'ai',
          content: `已创建子节点「${conceptName}」。你可以随时离开去学习它。`,
          metadata: { action: 'concept_marked', concept_name: conceptName },
        });
      }

      const names = new Set(markedConceptNames.value);
      names.add(conceptName);
      markedConceptNames.value = names;

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
    const cp = loadCheckpointForNode(nodeId);
    if (!cp) return false;

    isBusy.value = true;
    setGlobalLoading('nodeChat', true);

    try {
      const resp = await fetchWithTimeout(`${backendUrl}/chat/sessions/${cp.sessionId}`, {
        headers: getAuthHeaders(),
      });
      if (!resp.ok) {
        clearCheckpointForNode(nodeId);
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
      clearCheckpointForNode(nodeId);
      return false;
    } finally {
      isBusy.value = false;
      setGlobalLoading('nodeChat', false);
    }
  }

  function exitChat() {
    if (currentNodeId.value && sessionId.value) {
      const checkpoint: ChatCheckpoint = {
        sessionId: sessionId.value,
        nodeId: currentNodeId.value,
        mode: 'conversing',
        timestamp: Date.now(),
      };
      try {
        const map = loadCheckpointMap();
        map[currentNodeId.value] = checkpoint;
        localStorage.setItem(CHECKPOINT_MAP_KEY, JSON.stringify(map));
      } catch { /* ignore */ }
    }
    mode.value = 'idle';
  }

  async function resumeOrStartChat(): Promise<boolean> {
    if (currentNodeId.value) {
      const cp = loadCheckpointForNode(currentNodeId.value);
      if (cp && cp.mode === 'conversing') {
        const success = await resumeChat(currentNodeId.value);
        if (success) return true;
      }

      try {
        const resp = await fetchWithTimeout(
          `${backendUrl}/chat/sessions/by-node/${currentNodeId.value}`,
          { headers: getAuthHeaders() }
        );
        if (resp.ok) {
          const data = await resp.json();
          if (data.session_id) {
            sessionId.value = data.session_id;
            saveCheckpoint();
            const success = await resumeChat(currentNodeId.value);
            if (success) return true;
          }
        }
      } catch { /* fall through to new chat */ }
    }

    return false;
  }

  function resetForNewNode() {
    sessionId.value = null;
    messages.value = [];
    generatedContent.value = '';
    errorMessage.value = '';
    referenceText.value = '';
    referenceFileName.value = null;
    currentSubTopic.value = '';
    totalKp.value = 1;
    currentKpIndex.value = 0;
    currentKpData.value = null;
    isCompleted.value = false;
    mentionedConcepts.value = [];
    markedConceptNames.value = new Set();
  }

  function clearChat() {
    const nodeId = currentNodeId.value;
    sessionId.value = null;
    messages.value = [];
    generatedContent.value = '';
    mode.value = 'text_input';
    errorMessage.value = '';
    referenceText.value = '';
    referenceFileName.value = null;
    currentSubTopic.value = '';
    totalKp.value = 1;
    currentKpIndex.value = 0;
    currentKpData.value = null;
    isCompleted.value = false;
    mentionedConcepts.value = [];
    markedConceptNames.value = new Set();
    if (nodeId) clearCheckpointForNode(nodeId);
  }

  async function compressAndClear(): Promise<string> {
    const sid = sessionId.value;
    if (!sid) {
      clearChat();
      return '';
    }

    isBusy.value = true;
    setGlobalLoading('nodeChat', true);

    try {
      const resp = await fetchWithTimeout(`${backendUrl}/chat/compress`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ session_id: sid }),
      });

      if (!resp.ok) {
        // If compression fails (e.g. too few messages), just clear without compression
        clearChat();
        return '';
      }

      const data = await resp.json();
      clearChat();
      return data.summary || '';
    } catch {
      // On any error, fallback to plain clear
      clearChat();
      return '';
    } finally {
      isBusy.value = false;
      setGlobalLoading('nodeChat', false);
    }
  }

  function abandonChat() {
    const nodeId = currentNodeId.value;
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
    mentionedConcepts.value = [];
    markedConceptNames.value = new Set();
    if (nodeId) clearCheckpointForNode(nodeId);
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

  function _updateConcepts(data: any) {
    if (data.mentioned_concepts && Array.isArray(data.mentioned_concepts)) {
      const existing = mentionedConcepts.value;
      const existingNames = new Set(existing.map(c => c.name));
      for (const c of data.mentioned_concepts) {
        if (c.name && !existingNames.has(c.name)) {
          existingNames.add(c.name);
          existing.push({
            name: c.name,
            category: c.category || '',
            definition: c.definition || '',
            prerequisites: c.prerequisites || [],
            expansion_directions: c.expansion_directions || [],
            verified: c.verified || false,
            wiki_summary: c.wiki_summary || '',
            wiki_description: c.wiki_description || '',
          });
        }
      }
      mentionedConcepts.value = existing;
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
    openingMessage,
    contextChain,
    newLearnings,
    mentionedConcepts,
    markedConceptNames,
    // Computed
    hasActiveConversation,
    hasResumableSession,
    // Actions
    setEditor,
    setNodeId,
    insertGeneratedContent,
    startTextChat,
    startFileChat,
    startLineByLineChat,
    startContextualChat,
    sendMessage,
    skipTurn,
    endConversation,
    regenerateWithTreeContext,
    markConcept,
    resumeChat,
    resetForNewNode,
    abandonChat,
    clearChat,
    compressAndClear,
    exitChat,
    setTextMode,
    setFileMode,
    resumeOrStartChat,
    fetchContextChain,
    recordNavigationTransition,
  };
}
