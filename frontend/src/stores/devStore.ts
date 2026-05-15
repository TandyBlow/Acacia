import { ref } from 'vue';
import { defineStore } from 'pinia';

export const useDevStore = defineStore('dev', () => {
  const enableTransition = ref(true);
  const enableRiseSink = ref(true);
  const manualSceneReady = ref(false);

  function toggleTransition() {
    enableTransition.value = !enableTransition.value;
  }

  function toggleRiseSink() {
    enableRiseSink.value = !enableRiseSink.value;
  }

  function toggleManualSceneReady() {
    manualSceneReady.value = !manualSceneReady.value;
  }

  return {
    enableTransition,
    enableRiseSink,
    manualSceneReady,
    toggleTransition,
    toggleRiseSink,
    toggleManualSceneReady,
  };
});
