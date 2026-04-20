export type TreeTheme = 'default' | 'sakura';

export const BARK_COLORS: Record<TreeTheme, number> = {
  default: 0xa0522d,
  sakura: 0x4a3728,
};

export const GROUND_COLOR = 0x5c3a1e;
export const DIRT_COLOR = 0x3b2413;
export const OUTLINE_COLOR = 0x2c1a0e;
export const SCENE_BACKGROUND = 0xf5f0eb;

export const SKY_COLORS: Record<TreeTheme, { top: number; bottom: number }> = {
  default: { top: 0x87CEEB, bottom: 0xf5f0eb },
  sakura:  { top: 0xffc8d6, bottom: 0xfff5f8 },
};

export const LEAF_SIZE_MULT: Record<TreeTheme, number> = {
  default: 1.0,
  sakura: 1.25,
};
