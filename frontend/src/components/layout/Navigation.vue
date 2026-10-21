<template>
  <div class="nav-shell" :class="{
    'nav-sinking': navPhase === 'sinking',
    'nav-slide-out': navPhase === 'sliding-out',
    'nav-slide-in-prep': navPhase === 'sliding-in-prep',
    'nav-slide-in': navPhase === 'sliding-in',
    'nav-rising': navPhase === 'rising',
    'official-sunken': otPhase === 'sinking' || otPhase === 'sliding' || otPhase === 'anchor-sliding',
    'official-sliding': otPhase === 'sliding',
  }">
    <template v-if="isAuthenticated">
      <TransitionGroup
        v-show="!hideNodeList && !hideNonAnchorItems"
        ref="nodeListRef"
        :name="effectiveTransitionName"
        :style="{ '--cell-anim-ms': `${currentAnimMs}ms` }"
        tag="div"
        class="node-list"
        :class="{ 'official-sliding': otPhase === 'sliding', 'scroll-dir-up': scrollDirection === 'up' }"
        @before-leave="onBeforeLeave"
        @wheel.prevent="onWheel"
        @touchstart.passive="onTouchStart"
        @touchend="onTouchEnd"
      >
        <div v-if="displayItems.length === 0" key="empty" class="empty" />

        <div v-for="item in displayItems" :key="item.id" class="row" :data-item-id="item.id" :class="{ 'clicked-target': otPhase === 'sliding' && item.id === otClickedItemId }">
          <GlassWrapper
            class="row-glass"
            :class="{ 'official-glass': item.isOfficial }"
            interactive
            :pressed="(item.isOfficial && pressedOfficialId === item.id) || (!item.isOfficial && (pressedNodeId === item.id || scrollingTopId === item.id || scrollingBottomId === item.id))"
            @click="item.isOfficial ? onOfficialClick(item) : onRowClick(item.id)"
            @contextmenu.prevent="!item.isOfficial && onContextMenu(item.id)"
          >
            <div class="row-content" :class="{ 'official-content': item.isOfficial }">
              <template v-if="!item.isOfficial && actionNodeId === item.id">
                <div class="inline-actions">
                  <button type="button" class="action-half" @click.stop="moveNode(item.nodeData!)">{{ $t('nav.move') }}</button>
                  <button type="button" class="action-half" @click.stop="deleteNode(item.nodeData!)">{{ $t('nav.delete') }}</button>
                </div>
              </template>
              <template v-else>
                <span class="row-name" :class="{ 'official-name': item.isOfficial }">{{ item.name }}</span>
              </template>
            </div>
          </GlassWrapper>
        </div>
      </TransitionGroup>

      <GlassWrapper v-if="!anchorOfficial" class="add-shell" interactive :pressed="addPressed" @click="onAddClick">
        <button type="button" class="add-button">
          {{ $t('nav.addNode') }}
        </button>
      </GlassWrapper>
      <GlassWrapper v-if="anchorOfficial" class="add-shell anchor-official-shell" :class="{ 'anchor-prep': anchorSlidingDown || otAnchorPrep, 'anchor-sinking': otPhase === 'sinking' || otPhase === 'sliding' || otPhase === 'anchor-sliding' }" :style="otAnchorDeltaY ? { '--anchor-delta-y': otAnchorDeltaY + 'px' } : {}" interactive pressed @click="onAnchorOfficialClick">
        <div class="official-content">
          <span class="official-name">{{ anchorOfficial.name }}</span>
        </div>
      </GlassWrapper>

    </template>

    <div v-else class="auth-tip-shell" />
  </div>
</template>

<script setup lang="ts">
import GlassWrapper from '../ui/GlassWrapper.vue'
import { useNavigationState } from './NavigationState'
import { useNavigationAnim } from './NavigationAnim'
import { useNavigationScroll } from './NavigationScroll'
import { useNavigationInteract } from './NavigationInteract'
import { useNavigationWatch } from './NavigationWatch'
import { getLayoutScale } from '../../utils/layoutScale'

const state = useNavigationState()

const {
  navPhase,
  otPhase,
  isAuthenticated,
  hideNodeList,
  hideNonAnchorItems,
  displayItems,
  effectiveTransitionName,
  currentAnimMs,
  scrollDirection,
  otClickedItemId,
  pressedOfficialId,
  pressedNodeId,
  scrollingTopId,
  scrollingBottomId,
  actionNodeId,
  addPressed,
  anchorOfficial,
  anchorSlidingDown,
  otAnchorDeltaY,
  otAnchorPrep,
  nodeListRef,
} = state

// nodeListRef is bound via ref="nodeListRef" in the template; the scroll
// ResizeObserver and reflow read consume it through the state bag.
void nodeListRef

const anim = useNavigationAnim(state)
const scroll = useNavigationScroll(state)
const { onRowClick, onContextMenu, onOfficialClick, onAnchorOfficialClick, onAddClick, moveNode, deleteNode } = useNavigationInteract(state, anim)
const { onWheel, onTouchStart, onTouchEnd } = scroll

// Must run last: its immediate childNodes watcher needs anim/scroll to exist.
useNavigationWatch(state, anim, scroll)

function onBeforeLeave(el: Element): void {
  const htmlEl = el as HTMLElement
  const rect = htmlEl.getBoundingClientRect()
  const parentRect = htmlEl.parentElement?.getBoundingClientRect()
  if (parentRect) {
    const scale = getLayoutScale(htmlEl)
    htmlEl.style.top = `${(rect.top - parentRect.top) / scale}px`
    htmlEl.style.left = `${(rect.left - parentRect.left) / scale}px`
    htmlEl.style.width = `${rect.width / scale}px`
  }
}
</script>

<style scoped src="./Navigation.1.css"></style>
<style scoped src="./Navigation.2.css"></style>
