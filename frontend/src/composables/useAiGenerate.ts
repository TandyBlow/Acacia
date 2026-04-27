import { ref } from 'vue';
import { apiFetch } from '../utils/api';

export interface AiGenerateResult {
  nodes: Array<{ id: string; name: string; parent_id: string | null; skipped?: boolean }>;
}

export interface AnalyzeResult {
  node_id: string;
  node_name: string;
  created: Array<{ id: string; name: string; parent_id: string | null; skipped?: boolean }>;
  skipped: number;
}

const requestOpen = ref(false);
const analysisRequest = ref(false);

export function useAiGenerate() {
  const isBusy = ref(false);
  const errorMessage = ref<string | null>(null);
  const analyzeResult = ref<AnalyzeResult | null>(null);

  async function generate(input: string): Promise<AiGenerateResult | null> {
    isBusy.value = true;
    errorMessage.value = null;
    try {
      return await apiFetch<AiGenerateResult>('/ai-generate-nodes', {
        method: 'POST',
        body: JSON.stringify({ input }),
      });
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : 'AI生成失败';
      return null;
    } finally {
      isBusy.value = false;
    }
  }

  async function analyzeNode(nodeId: string): Promise<AnalyzeResult | null> {
    isBusy.value = true;
    errorMessage.value = null;
    analyzeResult.value = null;
    try {
      const result = await apiFetch<AnalyzeResult>(`/analyze-node/${nodeId}`, {
        method: 'POST',
      });
      analyzeResult.value = result;
      return result;
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : 'AI分析失败';
      return null;
    } finally {
      isBusy.value = false;
    }
  }

  function requestOpenPopup(): void {
    requestOpen.value = true;
  }

  function requestAnalysis(): void {
    analysisRequest.value = true;
  }

  return { isBusy, errorMessage, analyzeResult, generate, analyzeNode, requestOpen, requestOpenPopup, analysisRequest, requestAnalysis };
}
