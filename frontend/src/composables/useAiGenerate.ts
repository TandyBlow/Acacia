import { ref } from 'vue';
import { config } from '../config';

export interface AiGenerateResult {
  nodes: Array<{ id: string; name: string; parent_id: string | null; skipped?: boolean }>;
}

export function useAiGenerate() {
  const isBusy = ref(false);
  const errorMessage = ref<string | null>(null);

  async function generate(userId: string, input: string): Promise<AiGenerateResult | null> {
    isBusy.value = true;
    errorMessage.value = null;
    try {
      const res = await fetch(`${config.backendUrl}/ai-generate-nodes/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `请求失败: ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : 'AI生成失败';
      return null;
    } finally {
      isBusy.value = false;
    }
  }

  return { isBusy, errorMessage, generate };
}
