import { FORMATS, type FormatId } from './document';

/**
 * Where Instagram hides part of a post, as fractions of one slide — for the
 * editor's safe-area guides and the preview.
 *
 * Since 2025 the profile grid shows every post as a 3:4 tile cut from the
 * middle (a carousel shows its first slide), so a 4:5 post loses a thin strip
 * on each side and a square one much more. On a story, the account name and
 * the reply bar sit over the top and bottom.
 */
export const GRID_TILE_RATIO = 4 / 3;

export interface SafeArea {
  /** Cut from each side in the profile grid, as a fraction of the slide width. */
  gridSide: number;
  /** Cut from top and bottom in the profile grid (tall formats), as a fraction of the height. */
  gridTopBottom: number;
  /** Covered by Instagram's own buttons on a story, as fractions of the height. */
  storyTop: number;
  storyBottom: number;
}

export function safeArea(format: FormatId, ratio = FORMATS[format].ratio): SafeArea {
  const visibleWidth = ratio / GRID_TILE_RATIO;
  const story = format === 'story';
  return {
    gridSide: visibleWidth < 1 ? (1 - visibleWidth) / 2 : 0,
    gridTopBottom: visibleWidth > 1 ? (1 - GRID_TILE_RATIO / ratio) / 2 : 0,
    storyTop: story ? 0.13 : 0,
    storyBottom: story ? 0.18 : 0,
  };
}
