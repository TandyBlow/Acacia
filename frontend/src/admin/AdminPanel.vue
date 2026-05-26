<template>
  <div class="admin-layout">
    <header class="admin-header">
      <h1>Acacia 内容管理后台</h1>
      <button class="btn-logout" @click="$emit('logout')">登出</button>
    </header>

    <div class="admin-body">
      <!-- Left sidebar: node list -->
      <aside class="admin-sidebar">
        <div class="sidebar-header">
          <span>官方知识点</span>
          <button class="btn-new" @click="createNew">+ 新建</button>
        </div>
        <div v-if="loadingList" class="sidebar-status">加载中...</div>
        <div v-else-if="nodes.length === 0" class="sidebar-status">暂无节点，点击"+ 新建"创建</div>
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
        <div v-if="!selectedId" class="empty-editor">
          请从左侧选择一个节点，或点击"+ 新建"
        </div>
        <template v-else>
          <div class="editor-toolbar">
            <input
              v-model="editTitle"
              class="title-input"
              placeholder="节点标题"
              @input="markDirty"
            />
            <label class="preview-toggle">
              <input type="checkbox" v-model="showPreview" /> 预览
            </label>
          </div>

          <div class="editor-body">
            <textarea
              v-if="!showPreview"
              v-model="editContent"
              class="content-textarea"
              placeholder="Markdown 内容..."
              @input="markDirty"
            ></textarea>
            <div v-else class="content-preview" v-html="renderedPreview"></div>
          </div>

          <div v-if="saveError" class="editor-error">{{ saveError }}</div>

          <div class="editor-actions">
            <button class="btn-save" :disabled="saving || !dirty" @click="save">
              {{ saving ? '保存中...' : '保存' }}
            </button>
            <button
              class="btn-publish"
              :class="{ unpublish: editPublished }"
              :disabled="saving"
              @click="togglePublish"
            >
              {{ editPublished ? '取消发布' : '发布' }}
            </button>
            <button class="btn-delete" :disabled="saving" @click="confirmDelete">
              删除
            </button>
          </div>
        </template>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
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

const nodes = ref<OfficialNode[]>([]);
const selectedId = ref<string | null>(null);
const editTitle = ref('');
const editContent = ref('');
const editPublished = ref(false);
const showPreview = ref(false);
const dirty = ref(false);
const saving = ref(false);
const saveError = ref('');
const loadingList = ref(true);

const renderedPreview = computed(() => {
  return DOMPurify.sanitize(marked.parse(editContent.value, { async: false }) as string);
});

async function fetchList() {
  loadingList.value = true;
  try {
    nodes.value = await apiFetch<OfficialNode[]>('/admin/official-nodes');
  } catch {
    nodes.value = [];
  } finally {
    loadingList.value = false;
  }
}

function selectNode(node: OfficialNode) {
  selectedId.value = node.id;
  editTitle.value = node.title;
  editContent.value = node.content;
  editPublished.value = !!node.is_published;
  dirty.value = false;
  saveError.value = '';
}

function createNew() {
  selectedId.value = null;
  editTitle.value = '';
  editContent.value = '';
  editPublished.value = false;
  dirty.value = false;
  saveError.value = '';
}

function markDirty() {
  dirty.value = true;
}

async function save() {
  if (!editTitle.value.trim()) {
    saveError.value = '标题不能为空';
    return;
  }
  saving.value = true;
  saveError.value = '';
  try {
    if (selectedId.value) {
      // Update existing
      await apiFetch(`/admin/official-nodes/${selectedId.value}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: editTitle.value.trim(),
          content: editContent.value,
          is_published: editPublished.value,
        }),
      });
    } else {
      // Create new
      const node = await apiFetch<OfficialNode>('/admin/official-nodes', {
        method: 'POST',
        body: JSON.stringify({
          title: editTitle.value.trim(),
          content: editContent.value,
          is_published: editPublished.value,
        }),
      });
      selectedId.value = node.id;
    }
    dirty.value = false;
    await fetchList();
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : '保存失败';
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
    saveError.value = e instanceof Error ? e.message : '操作失败';
  } finally {
    saving.value = false;
  }
}

async function confirmDelete() {
  if (!selectedId.value) return;
  if (!window.confirm('确定要删除这个节点吗？此操作不可撤销。')) return;
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
    saveError.value = e instanceof Error ? e.message : '删除失败';
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
}

.title-input {
  flex: 1;
  padding: 10px 14px;
  font-size: 18px;
  font-weight: 600;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  background: #fff;
  outline: none;
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
}

.content-textarea {
  width: 100%;
  height: 100%;
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
