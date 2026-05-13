import { ref } from 'vue';
import { defineStore } from 'pinia';

export const useDevStore = defineStore('dev', () => {
  const enableTransition = ref(true);
  const enableRiseSink = ref(true);

  function toggleTransition() {
    enableTransition.value = !enableTransition.value;
  }

  function toggleRiseSink() {
    enableRiseSink.value = !enableRiseSink.value;
  }

  return {
    enableTransition,
    enableRiseSink,
    toggleTransition,
    toggleRiseSink,
  };
});
