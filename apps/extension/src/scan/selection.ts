export interface Point {
  x: number;
  y: number;
}
export interface Size {
  w: number;
  h: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);

/** Rectangle between two drag points in either direction, kept inside the view. */
export function normalizeRect(a: Point, b: Point, bounds: Size): Rect {
  const x1 = clamp(Math.min(a.x, b.x), bounds.w);
  const y1 = clamp(Math.min(a.y, b.y), bounds.h);
  const x2 = clamp(Math.max(a.x, b.x), bounds.w);
  const y2 = clamp(Math.max(a.y, b.y), bounds.h);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Maps a view-space rectangle to whole image pixels (rounded outwards, never past the image). */
export function toImageRect(view: Rect, viewSize: Size, imageSize: Size): Rect {
  if (viewSize.w <= 0 || viewSize.h <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const sx = imageSize.w / viewSize.w;
  const sy = imageSize.h / viewSize.h;
  const x = clamp(Math.floor(view.x * sx), imageSize.w);
  const y = clamp(Math.floor(view.y * sy), imageSize.h);
  const right = clamp(Math.ceil((view.x + view.w) * sx), imageSize.w);
  const bottom = clamp(Math.ceil((view.y + view.h) * sy), imageSize.h);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

/** Starting box for keyboard users: centred, 40% of the view. */
export function defaultSelection(view: Size): Rect {
  const w = Math.round(view.w * 0.4);
  const h = Math.round(view.h * 0.4);
  return { x: Math.round((view.w - w) / 2), y: Math.round((view.h - h) / 2), w, h };
}

/** Arrow keys move the box; with `resize` they change its size. Always stays inside the view. */
export function nudgeSelection(
  rect: Rect,
  dx: number,
  dy: number,
  resize: boolean,
  bounds: Size,
): Rect {
  const minSize = 16;
  if (resize) {
    const w = Math.min(Math.max(rect.w + dx, minSize), bounds.w - rect.x);
    const h = Math.min(Math.max(rect.h + dy, minSize), bounds.h - rect.y);
    return { ...rect, w, h };
  }
  return {
    ...rect,
    x: Math.min(Math.max(rect.x + dx, 0), Math.max(0, bounds.w - rect.w)),
    y: Math.min(Math.max(rect.y + dy, 0), Math.max(0, bounds.h - rect.h)),
  };
}
