<template>
  <div class="admin-layout">
    <header class="admin-header">
      <h1>{{ $t('admin.title') }}</h1>
      <button class="btn-logout" @click="$emit('logout')">{{ $t('admin.logout') }}</button>
    </header>

    <div class="admin-body">
      <!-- Left sidebar: node list -->
      <aside class="admin-sidebar">
        <div class="sidebar-header">
          <span>{{ $t('admin.officialNodes') }}</span>
          <button class="btn-new" @click="createNew">{{ $t('admin.new') }}</button>
        </div>
        <div v-if="loadingList" class="sidebar-status">{{ $t('admin.loading') }}</div>
        <div v-else-if="nodes.length === 0" class="sidebar-status">{{ $t('admin.noNodes') }}</div>
        <ul v-else class="node-list">
          <li
            v-for="node in nodes"
            :key="node.id"
            class="node-item"
            :class="{ active: selectedId === node.id }"
            @click="selectNode(node)"
          >
            <span class="node-status" :class="{ published: node.is_published }">
              {{ node.is_published ? '✓' : '○' }}
            </span>
            <span class="node-title" :class="{ draft: !node.is_published }">{{ node.title }}</span>
          </li>
        </ul>
      </aside>

      <!-- Main editor area -->
      <main class="admin-main">
        <div v-if="!selectedId && !isCreating" class="empty-editor">
          {{ $t('admin.selectNode') }}
        </div>
        <template v-else>
          <div class="editor-toolbar">
            <input
              v-model="editTitle"
              class="title-input"
              :placeholder="$t('admin.nodeTitle')"
              @input="markDirty"
            />
            <input
              v-model="editTitleEn"
              class="title-input title-input-en"
              :placeholder="$t('admin.nodeTitleEn')"
              @input="markDirty"
            />
            <label class="preview-toggle">
              <input type="checkbox" v-model="showPreview" /> {{ $t('admin.preview') }}
            </label>
          </div>

          <div class="editor-body">
            <div v-if="!showPreview" class="editor-body-layout">
              <textarea
                v-model="editContent"
                class="content-textarea"
                :placeholder="$t('admin.markdownPlaceholder')"
                @input="markDirty"
              ></textarea>
              <textarea
                v-model="editContentEn"
                class="content-textarea content-textarea-en"
                :placeholder="$t('admin.markdownPlaceholderEn')"
                @input="markDirty"
              ></textarea>
            </div>
            <div v-else class="content-preview" v-html="renderedPreview"></div>
          </div>

          <div v-if="saveError" class="editor-error">{{ saveError }}</div>

          <div class="editor-actions">
            <button class="btn-save" :disabled="saving || !dirty" @click="save">
              {{ saving ? $t('admin.saving') : $t('admin.save') }}
            </button>
            <button
              class="btn-publish"
              :class="{ unpublish: editPublished }"
              :disabled="saving"
              @click="togglePublish"
            >
              {{ editPublished ? $t('admin.unpublish') : $t('admin.publish') }}
            </button>
            <button class="btn-delete" :disabled="saving" @click="confirmDelete">
              {{ $t('admin.delete') }}
            </button>
          </div>
        </template>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiFetch } from '../utils/api';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

interface OfficialNode {
  id: string;
  title: string;
  content: string;
  sort_order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

defineEmits<{ logout: [] }>();

const { t } = useI18n();

const nodes = ref<OfficialNode[]>([]);
const selectedId = ref<string | null>(null);
const editTitle = ref('');
const editContent = ref('');
const editTitleEn = ref('');
const editContentEn = ref('');
const editPublished = ref(false);
const showPreview = ref(false);
const dirty = ref(false);
const saving = ref(false);
const saveError = ref('');
const loadingList = ref(true);
const isCreating = ref(false);

const renderedPreview = computed(() => {
  return DOMPurify.sanitize(marked.parse(editContent.value, { async: false }) as string);
});

async function fetchList() {
  loadingList.value = true;
  try {
    nodes.value = await apiFetch<OfficialNode[]>('/admin/official-nodes');
  } catch (e) {
    console.error('[AdminPanel] fetchList failed:', e);
    nodes.value = [];
  } finally {
    loadingList.value = false;
  }
}

function selectNode(node: OfficialNode) {
  selectedId.value = node.id;
  editTitle.value = node.title;
  editContent.value = node.content;
  editTitleEn.value = (node as any).title_en || '';
  editContentEn.value = (node as any).content_en || '';
  editPublished.value = !!node.is_published;
  dirty.value = false;
  saveError.value = '';
  isCreating.value = false;
}

function createNew() {
  selectedId.value = null;
  editTitle.value = '';
  editContent.value = '';
  editTitleEn.value = '';
  editContentEn.value = '';
  editPublished.value = false;
  dirty.value = false;
  saveError.value = '';
  isCreating.value = true;
}

function markDirty() {
  dirty.value = true;
}

async function save() {
  if (!editTitle.value.trim()) {
    saveError.value = t('admin.titleRequired');
    return;
  }
  saving.value = true;
  saveError.value = '';
  try {
    const body = JSON.stringify({
      title: editTitle.value.trim(),
      content: editContent.value,
      title_en: editTitleEn.value,
      content_en: editContentEn.value,
      is_published: editPublished.value,
    });

    if (selectedId.value) {
      // Update existing
      const result = await apiFetch<OfficialNode>(`/admin/official-nodes/${selectedId.value}`, {
        method: 'PATCH',
        body,
      });
      // Populate English fields with auto-translated result
      if ((result as any).title_en) editTitleEn.value = (result as any).title_en;
      if ((result as any).content_en) editContentEn.value = (result as any).content_en;
    } else {
      // Create new
      const node = await apiFetch<OfficialNode>('/admin/official-nodes', {
        method: 'POST',
        body,
      });
      selectedId.value = node.id;
      if ((node as any).title_en) editTitleEn.value = (node as any).title_en;
      if ((node as any).content_en) editContentEn.value = (node as any).content_en;
    }
    dirty.value = false;
    isCreating.value = false;
    await fetchList();
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : t('admin.saveFailed');
  } finally {
    saving.value = false;
  }
}

async function togglePublish() {
  const next = !editPublished.value;
  saving.value = true;
  saveError.value = '';
  try {
    if (selectedId.value) {
      await apiFetch(`/admin/official-nodes/${selectedId.value}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_published: next }),
      });
    }
    editPublished.value = next;
    dirty.value = true;
    await fetchList();
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : t('admin.operationFailed');
  } finally {
    saving.value = false;
  }
}

async function confirmDelete() {
  if (!selectedId.value) return;
  if (!window.confirm(t('admin.confirmDelete'))) return;
  saving.value = true;
  saveError.value = '';
  try {
    await apiFetch(`/admin/official-nodes/${selectedId.value}`, { method: 'DELETE' });
    selectedId.value = null;
    editTitle.value = '';
    editContent.value = '';
    dirty.value = false;
    await fetchList();
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : t('admin.deleteFailed');
  } finally {
    saving.value = false;
  }
}

onMounted(fetchList);
</script>

<style scoped>
.admin-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: #1a1a1a;
  color: #fff;
  flex-shrink: 0;
}

.admin-header h1 {
  font-size: 18px;
  font-weight: 600;
}

.btn-logout {
  padding: 6px 16px;
  background: transparent;
  color: #ccc;
  border: 1px solid #555;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.btn-logout:hover {
  background: #333;
  color: #fff;
}

.admin-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.admin-sidebar {
  width: 260px;
  background: #fff;
  border-right: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  font-weight: 600;
  font-size: 14px;
  color: #444;
  border-bottom: 1px solid #eee;
}

.btn-new {
  padding: 4px 12px;
  background: #4a90d9;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
}

.btn-new:hover {
  background: #357abd;
}

.sidebar-status {
  padding: 20px 16px;
  font-size: 14px;
  color: #999;
}

.node-list {
  list-style: none;
  overflow-y: auto;
  flex: 1;
}

.node-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  cursor: pointer;
  border-bottom: 1px solid #f5f5f5;
  transition: background 0.15s;
}

.node-item:hover {
  background: #f0f4f8;
}

.node-item.active {
  background: #e8f0fe;
}

.node-status {
  font-size: 12px;
  color: #ccc;
  flex-shrink: 0;
  width: 16px;
}

.node-status.published {
  color: #4caf50;
}

.node-title {
  font-size: 14px;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-title.draft {
  color: #999;
  font-style: italic;
}

.admin-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #fafafa;
  overflow: hidden;
}

.empty-editor {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  font-size: 16px;
  color: #bbb;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 24px 0;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.title-input {
  flex: 1;
  min-width: 200px;
  padding: 10px 14px;
  font-size: 18px;
  font-weight: 600;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  background: #fff;
  outline: none;
}

.title-input-en {
  font-size: 15px;
  font-weight: 500;
  border-color: #d0d0e0;
  background: #fafaff;
}

.title-input:focus {
  border-color: #4a90d9;
}

.preview-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #666;
  cursor: pointer;
  white-space: nowrap;
}

.editor-body {
  flex: 1;
  padding: 16px 24px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.editor-body-layout {
  display: flex;
  gap: 12px;
  flex: 1;
  min-height: 0;
}

.content-textarea {
  flex: 1;
  min-width: 0;
  padding: 16px;
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  font-size: 14px;
  line-height: 1.6;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  background: #fff;
  resize: none;
  outline: none;
}

.content-textarea-en {
  font-size: 13px;
  border-color: #d0d0e0;
  background: #fafaff;
}

.content-textarea:focus {
  border-color: #4a90d9;
}

.content-preview {
  height: 100%;
  overflow-y: auto;
  padding: 16px 24px;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  line-height: 1.7;
  font-size: 15px;
}

.content-preview :deep(h1) { font-size: 1.8em; margin-bottom: 0.5em; }
.content-preview :deep(h2) { font-size: 1.4em; margin: 1em 0 0.5em; }
.content-preview :deep(p) { margin-bottom: 0.8em; }
.content-preview :deep(ul), .content-preview :deep(ol) { padding-left: 1.5em; margin-bottom: 0.8em; }
.content-preview :deep(li) { margin-bottom: 0.3em; }
.content-preview :deep(code) { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
.content-preview :deep(pre) { background: #f5f5f5; padding: 12px; border-radius: 6px; overflow-x: auto; margin-bottom: 0.8em; }
.content-preview :deep(strong) { font-weight: 600; }

.editor-error {
  padding: 8px 24px;
  color: #e53935;
  font-size: 14px;
  flex-shrink: 0;
}

.editor-actions {
  display: flex;
  gap: 10px;
  padding: 14px 24px;
  background: #fff;
  border-top: 1px solid #e0e0e0;
  flex-shrink: 0;
}

.btn-save {
  padding: 8px 24px;
  background: #4a90d9;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.btn-save:hover { background: #357abd; }
.btn-save:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-publish {
  padding: 8px 24px;
  background: #4caf50;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.btn-publish:hover { background: #388e3c; }
.btn-publish:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-publish.unpublish { background: #ff9800; }
.btn-publish.unpublish:hover { background: #f57c00; }

.btn-delete {
  padding: 8px 24px;
  background: transparent;
  color: #e53935;
  border: 1px solid #e53935;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  margin-left: auto;
}

.btn-delete:hover { background: #fce4ec; }
.btn-delete:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
