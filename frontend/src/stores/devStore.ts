import { ref } from 'vue';
import { defineStore } from 'pinia';

export const useDevStore = defineStore('dev', () => {
  const enableTransition = ref(true);
  const manualSceneReady = ref(false);

  function toggleTransition() {
    enableTransition.value = !enableTransition.value;
  }

  function toggleManualSceneReady() {
    manualSceneReady.value = !manualSceneReady.value;
  }

  return {
    enableTransition,
    manualSceneReady,
    toggleTransition,
    toggleManualSceneReady,
  };
});
