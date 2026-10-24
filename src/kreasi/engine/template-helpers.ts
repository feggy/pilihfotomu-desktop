import type { Cell } from './templates';

/**
 * Small builders for layout cells, shared by the layout lists. Tiled cells are
 * fractions of the area they tile; free and carousel cells follow the notes on
 * each helper.
 */

export const third = 1 / 3;

type Box = readonly [x: number, y: number, w: number, h: number];

/**
 * A square area centered on the 4:5 canvas, `size` of its width — cluster
 * layouts are drawn in it so a cell that is square on the grid is square in
 * the collage, with room above and below.
 */
export function squareArea(size = 0.86): Box {
  const h = size / 1.25;
  return [(1 - size) / 2, (1 - h) / 2, size, h];
}

/** Cells sketched on a 10 × 10 grid, as fractions of their area. */
export const grid10 = (cells: readonly Box[]): Cell[] =>
  cells.map(([x, y, w, h]) => [x / 10, y / 10, w / 10, h / 10] as const);

/** An even grid, row by row. */
export const gridCells = (cols: number, rows: number): Cell[] =>
  Array.from({ length: cols * rows }, (_, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    return [c / cols, r / rows, 1 / cols, 1 / rows] as const;
  });

/**
 * An even grid with one big cell spanning `span` × `span` from column `col`,
 * row `row` — the rest fill in around it, row by row.
 */
export function gridWithHero(
  cols: number,
  rows: number,
  col: number,
  row: number,
  span = 2,
): Cell[] {
  const hero: Cell = [col / cols, row / rows, span / cols, span / rows];
  const rest = gridCells(cols, rows).filter((_, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    return !(c >= col && c < col + span && r >= row && r < row + span);
  });
  return [hero, ...rest];
}

/**
 * Columns side by side, each split top to bottom — masonry. `columns` lists
 * each column's cell heights (summing to 1); widths are equal unless given.
 */
export function columnCells(
  columns: readonly (readonly number[])[],
  widths?: readonly number[],
): Cell[] {
  const ws = widths ?? columns.map(() => 1 / columns.length);
  let x = 0;
  return columns.flatMap((heights, i) => {
    const w = ws[i]!;
    let y = 0;
    const cells = heights.map((h) => {
      const cell = [x, y, w, h] as const;
      y += h;
      return cell;
    });
    x += w;
    return cells;
  });
}

/** Rows stacked top to bottom, each split left to right (widths summing to 1). */
export function rowCells(
  rows: readonly (readonly number[])[],
  heights?: readonly number[],
): Cell[] {
  const hs = heights ?? rows.map(() => 1 / rows.length);
  let y = 0;
  return rows.flatMap((widths, i) => {
    const h = hs[i]!;
    let x = 0;
    const cells = widths.map((w) => {
      const cell = [x, y, w, h] as const;
      x += w;
      return cell;
    });
    y += h;
    return cells;
  });
}

/**
 * Builds carousel cells in slide units: x and w in slide widths (0…n), y and
 * h as fractions of the height, rotation in degrees.
 */
export const inSlides =
  (n: number) =>
  (x: number, y: number, w: number, h: number, rotate = 0): Cell => [x / n, y, w / n, h, rotate];

/**
 * The height fraction that gives a cell `w` slide widths wide (or `w` of a
 * post's width) a height ÷ width of `aspect` in pixels — 4:5 is 1.25 widths tall.
 */
export const heightFor = (w: number, aspect: number) => (w * aspect) / 1.25;

/** A polaroid's outer height ÷ width, frame included, as the renderer draws it. */
export const POLAROID_ASPECT = 1.18;
