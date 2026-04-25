import { ref } from 'vue';
import { useAuthStore } from '../stores/authStore';
import { useNodeStore } from '../stores/nodeStore';
import { invalidateSkeleton } from './useTreeSkeleton';

const isLoggingOut = ref(false);
const logoutUsername = ref('');

export function useLogoutFlow() {
  const authStore = useAuthStore();
  const nodeStore = useNodeStore();

  function startLogout(): void {
    console.warn('[useLogoutFlow] startLogout, authStore.currentUsername:', authStore.currentUsername, 'authStore.user:', JSON.stringify(authStore.user));
    logoutUsername.value = authStore.currentUsername;
    isLoggingOut.value = true;
  }

  function cancelLogout(): void {
    isLoggingOut.value = false;
    logoutUsername.value = '';
  }

  async function confirmLogout(): Promise<boolean> {
    const ok = await authStore.logout();
    if (ok) {
      nodeStore.resetAfterLogout();
      invalidateSkeleton();
      isLoggingOut.value = false;
      logoutUsername.value = '';
      return true;
    }
    isLoggingOut.value = false;
    logoutUsername.value = '';
    return false;
  }

  return { isLoggingOut, logoutUsername, startLogout, cancelLogout, confirmLogout };
}
