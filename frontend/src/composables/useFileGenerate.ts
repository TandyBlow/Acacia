import { ref, computed, onUnmounted } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import { useGlobalLoading } from './useGlobalLoading';

const FETCH_TIMEOUT = 90_000; // 90s, backend LLM timeout is 60s

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = FETCH_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export interface KnowledgePoint {
  id: string;
  title: string;
  type: 'concept' | 'principle' | 'application' | 'comparison' | 'procedure';
  brief: string;
  source_content?: string;
  correct_definition?: string;
  common_misconceptions?: string[];
  key_example?: string;
}

export interface KnowledgeGroup {
  group_name: string;
  knowledge_points: KnowledgePoint[];
}

export interface ExtractionResult {
  total_count: number;
  groups: KnowledgeGroup[];
}

export interface UploadedFile {
  file_id: string;
  filename: string;
  size: number;
  extension: string;
  text_length: number;
  text_preview: string;
}

interface SessionCheckpoint {
  sessionId: string;
  file: UploadedFile;
  extractionResult: ExtractionResult;
  selectedKnowledgePoints: KnowledgePoint[];
  timestamp: number;
}

const CHECKPOINT_KEY = 'acacia_conversation_checkpoint_v1';

function saveCheckpoint(kps: KnowledgePoint[]) {
  if (!sessionId.value || !uploadedFile.value || !extractionResult.value) return;
  const checkpoint: SessionCheckpoint = {
    sessionId: sessionId.value,
    file: uploadedFile.value,
    extractionResult: extractionResult.value,
    selectedKnowledgePoints: kps,
    timestamp: Date.now(),
  };
  try {
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(checkpoint));
  } catch { /* localStorage full or unavailable */ }
}

function loadCheckpoint(): SessionCheckpoint | null {
  try {
    const raw = localStorage.getItem(CHECKPOINT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SessionCheckpoint;
  } catch {
    return null;
  }
}

function clearCheckpoint() {
  localStorage.removeItem(CHECKPOINT_KEY);
}

const isOpen = ref(false);
const isBusy = ref(false);
const errorMessage = ref('');
const uploadedFile = ref<UploadedFile | null>(null);
const extractionResult = ref<ExtractionResult | null>(null);
const sessionId = ref<string | null>(null);
const conversationState = ref<{
  currentIndex: number;
  total: number;
  currentKpTitle?: string;
  isCompleted: boolean;
}>({
  currentIndex: 0,
  total: 0,
  isCompleted: false,
});

// Store reference to editor for content insertion
let editorInstance: Editor | null = null;

async function parseErrorDetail(response: Response, fallback: string): Promise<string> {
  try {
    const error = await response.json();
    return error.detail || fallback;
  } catch {
    return response.status === 413
      ? '文件大小超过限制'
      : `${fallback} (HTTP ${response.status})`;
  }
}

function friendlyError(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return '请求超时，AI服务响应较慢，请重试';
    }
    return error.message || fallback;
  }
  return fallback;
}

export function useFileGenerate() {
  const { registerLoadingSource, setLoading, unregisterLoadingSource } = useGlobalLoading();
  registerLoadingSource('fileGenerate');

  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:7860';

  onUnmounted(() => {
    unregisterLoadingSource('fileGenerate');
  });

  function setEditor(editor: Editor | null) {
    editorInstance = editor;
  }

  function insertGeneratedContent(content: string) {
    if (!editorInstance) {
      console.error('Editor instance not set');
      return;
    }

    try {
      // Parse Markdown to TipTap JSONContent
      const parsed = editorInstance.markdown?.parse(content);
      if (!parsed) {
        console.error('Failed to parse markdown');
        return;
      }

      // Move cursor to end
      const { doc } = editorInstance.state;
      const endPos = doc.content.size;
      editorInstance.commands.focus();
      editorInstance.commands.setTextSelection(endPos);

      // Insert content
      editorInstance.commands.insertContent(parsed);

      // Scroll to bottom
      editorInstance.commands.scrollIntoView();
    } catch (error) {
      console.error('Failed to insert content:', error);
    }
  }

  async function extractKnowledgePoints(fileId: string): Promise<ExtractionResult> {
    isBusy.value = true;
    setLoading('fileGenerate', true);
    errorMessage.value = '';

    try {
      const token = localStorage.getItem('acacia_backend_token');
      const response = await fetchWithTimeout(`${backendUrl}/extract-knowledge-points`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ file_id: fileId }),
      });

      if (!response.ok) {
        throw new Error(await parseErrorDetail(response, '知识点提取失败'));
      }

      const result = await response.json();
      extractionResult.value = result;
      return result;
    } catch (error) {
      errorMessage.value = friendlyError(error, '知识点提取失败');
      throw error;
    } finally {
      isBusy.value = false;
      setLoading('fileGenerate', false);
    }
  }

  async function startConversation(
    nodeId: string,
    fileId: string,
    knowledgePoints: KnowledgePoint[]
  ): Promise<{ sessionId: string; question: string; hints: string[] }> {
    isBusy.value = true;
    setLoading('fileGenerate', true);
    errorMessage.value = '';

    try {
      const token = localStorage.getItem('acacia_backend_token');
      const response = await fetchWithTimeout(`${backendUrl}/start-conversation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          node_id: nodeId,
          file_id: fileId,
          knowledge_points: knowledgePoints,
        }),
      });

      if (!response.ok) {
        throw new Error(await parseErrorDetail(response, '启动对话失败'));
      }

      const result = await response.json();
      sessionId.value = result.session_id;
      saveCheckpoint(knowledgePoints);
      conversationState.value = {
        currentIndex: result.current_kp.index,
        total: result.current_kp.total,
        currentKpTitle: result.current_kp.title,
        isCompleted: false,
      };

      return result;
    } catch (error) {
      errorMessage.value = friendlyError(error, '启动对话失败');
      throw error;
    } finally {
      isBusy.value = false;
      setLoading('fileGenerate', false);
    }
  }

  async function sendAnswer(
    answer: string,
    skip: boolean = false
  ): Promise<any> {
    if (!sessionId.value) {
      throw new Error('No active session');
    }

    isBusy.value = true;
    setLoading('fileGenerate', true);
    errorMessage.value = '';

    try {
      const token = localStorage.getItem('acacia_backend_token');
      const response = await fetchWithTimeout(`${backendUrl}/conversation-turn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          session_id: sessionId.value,
          user_answer: answer,
          skip: skip,
        }),
      });

      if (!response.ok) {
        throw new Error(await parseErrorDetail(response, '对话处理失败'));
      }

      const result = await response.json();

      // Update conversation state
      if (result.progress) {
        conversationState.value = {
          currentIndex: result.progress.current,
          total: result.progress.total,
          currentKpTitle: result.progress.kp_title,
          isCompleted: result.progress.completed || false,
        };
      }

      return result;
    } catch (error) {
      errorMessage.value = friendlyError(error, '对话处理失败');
      throw error;
    } finally {
      isBusy.value = false;
      setLoading('fileGenerate', false);
    }
  }

  async function sendExampleFeedback(
    action: 'accept' | 'regenerate' | 'skip',
    feedback?: string
  ): Promise<any> {
    if (!sessionId.value) {
      throw new Error('No active session');
    }

    isBusy.value = true;
    setLoading('fileGenerate', true);
    errorMessage.value = '';

    try {
      const token = localStorage.getItem('acacia_backend_token');
      const response = await fetchWithTimeout(`${backendUrl}/example-feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          session_id: sessionId.value,
          action,
          feedback,
        }),
      });

      if (!response.ok) {
        throw new Error(await parseErrorDetail(response, '例题反馈处理失败'));
      }

      const result = await response.json();

      // Update conversation state
      if (result.progress) {
        conversationState.value = {
          currentIndex: result.progress.current,
          total: result.progress.total,
          currentKpTitle: result.progress.kp_title,
          isCompleted: result.progress.completed || false,
        };
      }

      return result;
    } catch (error) {
      errorMessage.value = friendlyError(error, '例题反馈处理失败');
      throw error;
    } finally {
      isBusy.value = false;
      setLoading('fileGenerate', false);
    }
  }

  function openDialog() {
    isOpen.value = true;
    uploadedFile.value = null;
    extractionResult.value = null;
    sessionId.value = null;
    errorMessage.value = '';
    conversationState.value = {
      currentIndex: 0,
      total: 0,
      isCompleted: false,
    };
    // Don't clear checkpoint on open — user may want to resume
  }

  function closeDialog() {
    isOpen.value = false;
    // Only clear state if conversation was completed
    if (conversationState.value.isCompleted) {
      clearCheckpoint();
      uploadedFile.value = null;
      extractionResult.value = null;
      sessionId.value = null;
      conversationState.value = { currentIndex: 0, total: 0, isCompleted: false };
    }
    errorMessage.value = '';
  }

  const hasResumableSession = computed(() => {
    return loadCheckpoint() !== null;
  });

  async function resumeConversation(resumeSessionId: string) {
    isBusy.value = true;
    setLoading('fileGenerate', true);
    errorMessage.value = '';

    try {
      const token = localStorage.getItem('acacia_backend_token');
      const response = await fetchWithTimeout(
        `${backendUrl}/conversation-sessions/${resumeSessionId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          clearCheckpoint();
          throw new Error('会话已过期，请重新开始');
        }
        throw new Error(await parseErrorDetail(response, '加载会话失败'));
      }

      const result = await response.json();

      // Restore state from backend response + checkpoint
      const checkpoint = loadCheckpoint();
      sessionId.value = result.session_id;
      if (checkpoint) {
        uploadedFile.value = checkpoint.file;
        extractionResult.value = checkpoint.extractionResult;
      }

      conversationState.value = {
        currentIndex: result.current_index,
        total: result.progress.total,
        currentKpTitle: result.progress.kp_title,
        isCompleted: result.status === 'completed',
      };

      return result;
    } catch (error) {
      errorMessage.value = friendlyError(error, '加载会话失败');
      throw error;
    } finally {
      isBusy.value = false;
      setLoading('fileGenerate', false);
    }
  }

  async function abandonSession() {
    clearCheckpoint();
    uploadedFile.value = null;
    extractionResult.value = null;
    sessionId.value = null;
    conversationState.value = { currentIndex: 0, total: 0, isCompleted: false };
    errorMessage.value = '';
  }

  function handleFileUploaded(file: UploadedFile) {
    uploadedFile.value = file;
  }

  const needsOutlineSelection = computed(() => {
    return extractionResult.value && extractionResult.value.total_count > 10;
  });

  return {
    isOpen,
    isBusy,
    errorMessage,
    uploadedFile,
    extractionResult,
    sessionId,
    conversationState,
    needsOutlineSelection,
    openDialog,
    closeDialog,
    hasResumableSession,
    resumeConversation,
    abandonSession,
    extractKnowledgePoints,
    startConversation,
    sendAnswer,
    sendExampleFeedback,
    handleFileUploaded,
    setEditor,
    insertGeneratedContent,
  };
}
