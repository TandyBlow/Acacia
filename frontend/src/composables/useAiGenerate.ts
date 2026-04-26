import { ref } from 'vue';
import { apiFetch } from '../utils/api';

export interface AiGenerateResult {
  nodes: Array<{ id: string; name: string; parent_id: string | null; skipped?: boolean }>;
}

const requestOpen = ref(false);

export function useAiGenerate() {
  const isBusy = ref(false);
  const errorMessage = ref<string | null>(null);

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

  function requestOpenPopup(): void {
    requestOpen.value = true;
  }

  return { isBusy, errorMessage, generate, requestOpen, requestOpenPopup };
}
