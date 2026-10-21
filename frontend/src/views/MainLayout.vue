<template>
  <div v-if="isTooSmall" class="insufficient-space">
    <p>{{ $t('app.insufficientSpace') }}</p>
  </div>
  <main v-else class="layout" :style="{ '--layout-scale': layoutScale }" :class="[layoutClasses, {
    'scaled-layout': layoutScale > 1,
    'cinema-mode': isCinemaMode,
    'compact-toggle-sinking': compactAnimPhase === 'sinking',
    'compact-nav-slide-out': compactAnimPhase === 'nav-slide-out',
    'compact-nav-slide-in-prep': compactAnimPhase === 'nav-slide-in-prep',
    'compact-nav-slide-in': compactAnimPhase === 'nav-slide-in',
    'compact-toggle-rising': compactAnimPhase === 'rising',
    'official-sinking': otPhase === 'sinking',
    'official-nav-slide': otPhase === 'sliding',
    'official-rising': otPhase === 'rising',
    'entrance-prep': entrancePhase === 'prep',
    'entrance-sliding': entrancePhase === 'sliding',
    'entrance-rising': entrancePhase === 'rising',
  }]">
    <section ref="logoRef" class="logo-area">
      <div class="inset-shell static-shell">
        <LogoArea />
      </div>
    </section>

    <section ref="breadcrumbsRef" class="breadcrumbs-area">
      <div class="inset-shell static-shell">
        <Breadcrumbs />
      </div>
    </section>

    <section class="merged-area">
      <div class="merged-shell inset-shell static-shell">
        <section ref="navigationRef" class="navigation-area">
          <div class="inset-shell static-shell navigation-shell">
            <Navigation />
          </div>
        </section>

        <section ref="contentAreaRef" class="content-area">
          <div class="content-inset" :class="{ 'tree-visible': treeOverlayActive }">
            <div ref="treeMaskRef" class="tree-mask" :class="{ 'tree-mask-visible': treeMaskVisible }" aria-hidden="true"></div>
            <div v-if="!displayedSkipContentGlass" ref="contentGlassRef" class="content-glass" :class="{
              'content-sinking': contentPhase === 'sinking',
              'content-tree-mask': contentPhase === 'tree-mask',
              'content-slide-out': contentPhase === 'slide-out',
              'content-slide-in-prep': contentPhase === 'slide-in-prep',
              'content-slide-in': contentPhase === 'slide-in',
              'content-rising': contentPhase === 'rising',
            }">
              <div class="glass-content" style="width:100%;height:100%">
                <div v-if="displayedShowTree && !showEmptyBackground" key="tree" class="content-host">
                  <TreeCanvas ref="treeCanvasRef" :visible="displayedShowTree" />
                </div>
                <template v-if="!displayedShowTree && !showEmptyBackground">
                  <component
                    v-if="displayedNonTreeContent === MarkdownEditor"
                    :is="displayedNonTreeContent"
                    :key="displayedKey"
                  />
                  <div v-else class="activity-scroll">
                    <component :is="displayedNonTreeContent" :key="displayedKey" />
                  </div>
                </template>
              </div>
              <div class="tree-curtain" :class="{ drawn: treeCurtainDrawn }" aria-hidden="true"></div>
            </div>
            <div v-else class="content-direct" :class="{
              'direct-prep': contentPhase === 'slide-in-prep',
              'direct-slide': contentPhase === 'slide-in',
              'direct-slide-out': contentPhase === 'slide-out',
            }">
              <div v-if="displayedShowTree && !showEmptyBackground" key="tree" class="content-host">
                <TreeCanvas ref="treeCanvasRef" :visible="displayedShowTree" />
              </div>
              <template v-if="!displayedShowTree && !showEmptyBackground">
                <component
                  v-if="displayedNonTreeContent === MarkdownEditor"
                  :is="displayedNonTreeContent"
                  :key="displayedKey"
                />
                <div v-else class="activity-scroll">
                  <component :is="displayedNonTreeContent" :key="displayedKey" />
                </div>
              </template>
            </div>
          </div>
        </section>
      </div>
    </section>

    <section ref="knobRef" class="knob-area">
      <Knob />
    </section>

    <DevPanel v-if="isDev" />
  </main>
</template>

<script setup lang="ts">
import LogoArea from '../components/layout/LogoArea.vue'
import Breadcrumbs from '../components/layout/Breadcrumbs.vue'
import Navigation from '../components/layout/Navigation.vue'
import Knob from '../components/layout/Knob.vue'
import TreeCanvas from '../components/tree/TreeCanvas.vue'
import MarkdownEditor from '../components/editor/MarkdownEditor.vue'
import DevPanel from '../components/dev/DevPanel.vue'
import { useAppInit } from '../composables/useAppInit'
import { useOfficialTransition } from '../composables/useOfficialTransition'
import { createMainLayoutState } from '../composables/useMainLayoutState'
import { useMainLayoutLayout } from '../composables/useMainLayoutLayout'
import { useMainLayoutDisplay } from '../composables/useMainLayoutDisplay'
import { createMainLayoutContentCtx } from '../composables/mainLayoutContentContext'
import { useMainLayoutEntrance } from '../composables/useMainLayoutEntrance'
import { useMainLayoutContent } from '../composables/useMainLayoutContent'
import { useMainLayoutCompactToggle } from '../composables/useMainLayoutCompactToggle'
import { useMainLayoutOfficial } from '../composables/useMainLayoutOfficial'
import { setupMainLayoutWatchers } from '../composables/mainLayoutContentWatchers'
import './MainLayout.global.css'

const isDev = import.meta.env.DEV
const isCinemaMode = typeof window !== 'undefined' && window.location.search.includes('cinema')

useAppInit()

const state = createMainLayoutState()

// Template refs below are bound via `ref="..."` in the template and consumed
// through `state` by the composables; vue-tsc does not count the template
// `ref` attribute as a read, so suppress the unused-local diagnostics here.
const {
  isTooSmall,
  // @ts-ignore — bound as <template ref="logoRef">
  logoRef,
  // @ts-ignore — bound as <template ref="breadcrumbsRef">
  breadcrumbsRef,
  // @ts-ignore — bound as <template ref="navigationRef">
  navigationRef,
  // @ts-ignore — bound as <template ref="contentAreaRef">
  contentAreaRef,
  // @ts-ignore — bound as <template ref="contentGlassRef">
  contentGlassRef,
  // @ts-ignore — bound as <template ref="knobRef">
  knobRef,
  treeCurtainDrawn,
  // @ts-ignore — bound as <template ref="treeCanvasRef">
  treeCanvasRef,
  treeMaskVisible,
  treeOverlayActive,
  // @ts-ignore — bound as <template ref="treeMaskRef">
  treeMaskRef,
  entrancePhase,
  compactAnimPhase,
  contentPhase,
  displayedSkipContentGlass,
  displayedShowTree,
  displayedNonTreeContent,
  displayedKey,
} = state

const { phase: otPhase } = useOfficialTransition()

const { layoutScale } = useMainLayoutLayout(state)

const display = useMainLayoutDisplay(state)
const { layoutClasses, showEmptyBackground } = display

const ctx = createMainLayoutContentCtx({ state, display })
const entrance = useMainLayoutEntrance(ctx)
const { animateContentTransition } = useMainLayoutContent(ctx, entrance)
useMainLayoutCompactToggle(ctx)
useMainLayoutOfficial(ctx)
setupMainLayoutWatchers(ctx, animateContentTransition)
</script>

<style scoped src="./MainLayout.1.css"></style>
<style scoped src="./MainLayout.2.css"></style>
<style scoped src="./MainLayout.3.css"></style>
<style scoped src="./MainLayout.4.css"></style>
<style scoped src="./MainLayout.5.css"></style>
