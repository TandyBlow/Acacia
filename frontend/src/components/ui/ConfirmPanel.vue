<template>
  <div class="panel">
    <section v-if="viewState === 'add'" class="block">
      <h2>Create Node</h2>
      <p class="hint">New node will be created under the current node.</p>
      <input
        v-model="pendingNodeName"
        class="name-input"
        type="text"
        maxlength="80"
        placeholder="Enter node name..."
      />
      <p class="hint">Use knob hold to confirm.</p>
    </section>

    <section v-else-if="viewState === 'delete'" class="block">
      <h2>Delete Node</h2>
      <p class="hint">
        Target: <strong>{{ operationNode?.name ?? '-' }}</strong>
      </p>

      <label v-if="operationHasChildren" class="checkbox-row">
        <input v-model="deleteWithChildren" type="checkbox" />
        <span>Delete all child nodes too</span>
      </label>

      <p class="hint">Use knob hold to confirm delete.</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useNodeStore } from '../../stores/nodeStore';

const store = useNodeStore();
const { viewState, pendingNodeName, operationNode, operationHasChildren, deleteWithChildren } =
  storeToRefs(store);
</script>

<style scoped>
.panel {
  width: 100%;
  height: 100%;
  padding: 24px;
  display: grid;
  place-items: center;
}

.block {
  width: min(620px, 100%);
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: stretch;
}

h2 {
  margin: 0;
  font-size: 24px;
}

.hint {
  margin: 0;
  font-size: 14px;
  opacity: 0.85;
}

.name-input {
  width: 100%;
  border: 1px solid rgba(234, 251, 255, 0.25);
  border-radius: 16px;
  background: rgba(13, 58, 74, 0.22);
  color: #effdff;
  padding: 14px 16px;
  font-size: 16px;
}

.name-input:focus {
  outline: 2px solid rgba(183, 235, 251, 0.45);
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
}
</style>
