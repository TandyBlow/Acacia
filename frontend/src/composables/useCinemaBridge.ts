import { ref, type Ref } from 'vue'

export interface CinemaTreeCanvas {
  setGrowthLevel: (gm: number, nodeCount: number, maxDepth: number) => void
  setTreeGroupScale: (s: number) => void
  transitionToParamsDirect: (params: any, durationMs: number) => void
  swapBackgroundTexture: (texture: any) => void
  getManager: () => any
}

/** Shared bridge so CinematicDemo can control the 3D tree from its overlay. */
export const cinemaTreeCanvas: Ref<CinemaTreeCanvas | null> = ref(null)
