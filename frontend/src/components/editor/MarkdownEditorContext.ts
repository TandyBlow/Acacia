import { computed, ref, shallowRef } from 'vue'
// vue-3's Editor extends core's Editor; using the vue-3 type keeps this
// assignable both to useEditor()'s return and to useNodeChat's setEditor().
import type { Editor } from '@tiptap/vue-3'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useNodeStore } from '../../stores/nodeStore'
import { useNodeChat } from '../../composables/useNodeChat'
import { usePageTransition } from '../../composables/usePageTransition'
import type { TreeNode } from '../../types/node'

export interface UploadedFile {
  file_id: string
  filename: string
  size: number
  extension: string
  text_length: number
  text_preview: string
  formatted_text?: string
  ocr_applied?: boolean
  ocr_reason?: string | null
  ocr_status?: string
  total_pages?: number
}

export function createMarkdownEditorContext() {
  const store = useNodeStore()
  const { activeNode, pathNodes, childNodes, treeNodes } = storeToRefs(store)
  const { t } = useI18n()
  const { registerRegion, unregisterRegion } = usePageTransition()

  const {
    setEditor,
    mode: chatMode,
    isBusy,
    isCompleted,
    errorMessage,
    messages,
    currentSubTopic,
    totalKp,
    currentKpIndex,
    exitChat,
    resumeOrStartChat,
    setFileMode,
    resetForNewNode,
    setNodeId,
    hasResumableSession,
    sessionId,
    startTextChat: doStartTextChat,
    startContextualChat: doStartContextualChat,
    startLineByLineChat: doStartLineByLine,
    sendMessage,
    skipTurn,
    endConversation,
    regenerateWithTreeContext,
    markConcept,
    compressAndClear,
    recordNavigationTransition,
    mentionedConcepts,
    markedConceptNames,
  } = useNodeChat()

  const hasUserEdited = ref(false)
  const isChatSunk = ref(false)
  const isFileSunk = ref(false)
  const isAnimating = ref(false)

  const currentNodePath = computed(() => {
    if (!activeNode.value) return ''
    return [...pathNodes.value.map((node) => node.name), activeNode.value.name].join(' / ')
  })

  const sameNameNodePaths = computed(() => {
    if (!activeNode.value) return []

    const activeName = activeNode.value.name.trim()
    const paths: string[] = []
    const visited = new Set<string>()

    function walk(nodes: TreeNode[], ancestors: string[]): void {
      for (const node of nodes) {
        const nodePathParts = [...ancestors, node.name]
        if (node.name.trim() === activeName && !visited.has(node.id)) {
          paths.push(nodePathParts.join(' / '))
          visited.add(node.id)
        }
        walk(node.children, nodePathParts)
      }
    }

    walk(treeNodes.value, [])

    if (paths.length === 0 && currentNodePath.value) {
      paths.push(currentNodePath.value)
    }

    return paths
  })

  const userInput = ref('')
  const pendingFile = ref<UploadedFile | null>(null)
  const lastActiveNodeId = ref<string | null>(null)
  const editorRef = shallowRef<HTMLElement | null>(null)
  const draft = ref('')
  const lastSavedContent = ref('')
  const isApplyingExternalContent = ref(false)
  const isMigratingMath = ref(false)
  // True while the editor is showing the plain-text fallback because the saved
  // markdown failed to parse. While set, every save path is blocked so the
  // degraded flat version can never overwrite the intact server copy.
  const isParseDegraded = ref(false)
  // Reassigned by createMarkdownEditorEditor later; composables must always
  // read ctx.editor.value at call time, never capture the initial ref.
  // Use shallowRef so Vue's UnwrapRef doesn't strip Editor's private members
  // (ref() would turn the nominal Editor class into a structural object type).
  const editor = shallowRef<Editor | null | undefined>(null)

  const showBottomBar = computed(() => true)
  const canSend = computed(() => userInput.value.trim().length > 0)
  const progressPercent = computed(() => {
    if (totalKp.value <= 1) return 100
    if (isCompleted.value) return 100
    return Math.round((currentKpIndex.value / totalKp.value) * 100)
  })

  return {
    store,
    activeNode,
    pathNodes,
    childNodes,
    treeNodes,
    t,
    registerRegion,
    unregisterRegion,
    setEditor,
    chatMode,
    isBusy,
    isCompleted,
    errorMessage,
    messages,
    currentSubTopic,
    totalKp,
    currentKpIndex,
    exitChat,
    resumeOrStartChat,
    setFileMode,
    resetForNewNode,
    setNodeId,
    hasResumableSession,
    sessionId,
    doStartTextChat,
    doStartContextualChat,
    doStartLineByLine,
    sendMessage,
    skipTurn,
    endConversation,
    regenerateWithTreeContext,
    markConcept,
    compressAndClear,
    recordNavigationTransition,
    mentionedConcepts,
    markedConceptNames,
    hasUserEdited,
    isChatSunk,
    isFileSunk,
    isAnimating,
    currentNodePath,
    sameNameNodePaths,
    userInput,
    pendingFile,
    lastActiveNodeId,
    editorRef,
    draft,
    lastSavedContent,
    isApplyingExternalContent,
    isMigratingMath,
    isParseDegraded,
    editor,
    showBottomBar,
    canSend,
    progressPercent,
  }
}

export type MarkdownEditorContext = ReturnType<typeof createMarkdownEditorContext>
