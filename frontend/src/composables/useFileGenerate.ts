import { ref, computed } from 'vue';
import type { Editor } from '@tiptap/vue-3';

export interface KnowledgePoint {
  id: string;
  title: string;
  type: 'concept' | 'principle' | 'application' | 'comparison' | 'procedure';
  brief: string;
  source_content?: string;
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

export function useFileGenerate() {
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:7860';

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
    errorMessage.value = '';

    try {
      const token = localStorage.getItem('acacia_backend_token');
      const response = await fetch(`${backendUrl}/extract-knowledge-points`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ file_id: fileId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || '知识点提取失败');
      }

      const result = await response.json();
      extractionResult.value = result;
      return result;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '知识点提取失败';
      throw error;
    } finally {
      isBusy.value = false;
    }
  }

  async function startConversation(
    nodeId: string,
    fileId: string,
    knowledgePoints: KnowledgePoint[]
  ): Promise<{ sessionId: string; question: string; hints: string[] }> {
    isBusy.value = true;
    errorMessage.value = '';

    try {
      const token = localStorage.getItem('acacia_backend_token');
      const response = await fetch(`${backendUrl}/start-conversation`, {
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
        const error = await response.json();
        throw new Error(error.detail || '启动对话失败');
      }

      const result = await response.json();
      sessionId.value = result.session_id;
      conversationState.value = {
        currentIndex: result.current_kp.index,
        total: result.current_kp.total,
        currentKpTitle: result.current_kp.title,
        isCompleted: false,
      };

      return result;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '启动对话失败';
      throw error;
    } finally {
      isBusy.value = false;
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
    errorMessage.value = '';

    try {
      const token = localStorage.getItem('acacia_backend_token');
      const response = await fetch(`${backendUrl}/conversation-turn`, {
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
        const error = await response.json();
        throw new Error(error.detail || '对话处理失败');
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
      errorMessage.value = error instanceof Error ? error.message : '对话处理失败';
      throw error;
    } finally {
      isBusy.value = false;
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
    errorMessage.value = '';

    try {
      const token = localStorage.getItem('acacia_backend_token');
      const response = await fetch(`${backendUrl}/example-feedback`, {
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
        const error = await response.json();
        throw new Error(error.detail || '例题反馈处理失败');
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
      errorMessage.value = error instanceof Error ? error.message : '例题反馈处理失败';
      throw error;
    } finally {
      isBusy.value = false;
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
  }

  function closeDialog() {
    isOpen.value = false;
    uploadedFile.value = null;
    extractionResult.value = null;
    sessionId.value = null;
    errorMessage.value = '';
    conversationState.value = {
      currentIndex: 0,
      total: 0,
      isCompleted: false,
    };
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
    extractKnowledgePoints,
    startConversation,
    sendAnswer,
    sendExampleFeedback,
    handleFileUploaded,
    setEditor,
    insertGeneratedContent,
  };
}
