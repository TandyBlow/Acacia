import { ref } from 'vue';
import { useAuthStore } from '../stores/authStore';
import { useNodeStore } from '../stores/nodeStore';

export function useLogoutFlow() {
  const isLoggingOut = ref(false);
  const authStore = useAuthStore();
  const nodeStore = useNodeStore();

  function startLogout(): void {
    isLoggingOut.value = true;
  }

  function cancelLogout(): void {
    isLoggingOut.value = false;
  }

  async function confirmLogout(): Promise<boolean> {
    const ok = await authStore.logout();
    if (ok) {
      nodeStore.resetAfterLogout();
      isLoggingOut.value = false;
      return true;
    }
    isLoggingOut.value = false;
    return false;
  }

  return { isLoggingOut, startLogout, cancelLogout, confirmLogout };
}
