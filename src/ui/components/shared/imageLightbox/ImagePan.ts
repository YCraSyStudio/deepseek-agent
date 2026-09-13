
import type { ImageSize } from "./ImageZoom";

export interface ScrollOffset {
  left: number;
  top: number;
}

export function maxScrollOffset(content: ImageSize, viewport: ImageSize): ScrollOffset {
  return {
    left: Math.max(0, Math.round(content.width - viewport.width)),
    top: Math.max(0, Math.round(content.height - viewport.height)),
  };
}

export function centeredScrollOffset(content: ImageSize, viewport: ImageSize): ScrollOffset {
  const max = maxScrollOffset(content, viewport);
  return { left: Math.round(max.left / 2), top: Math.round(max.top / 2) };
}

export function rescaledScrollOffset(
  offset: ScrollOffset,
  previous: ImageSize,
  next: ImageSize,
  viewport: ImageSize,
): ScrollOffset {
  const previousMax = maxScrollOffset(previous, viewport);
  const nextMax = maxScrollOffset(next, viewport);
  return {
    left: rescaleAxis(offset.left, previousMax.left, nextMax.left),
    top: rescaleAxis(offset.top, previousMax.top, nextMax.top),
  };
}

function rescaleAxis(offset: number, previousMax: number, nextMax: number): number {
  if (nextMax <= 0) {
    return 0;
  }
  if (previousMax <= 0) {
    return Math.round(nextMax / 2);
  }
  const ratio = Math.min(1, Math.max(0, offset / previousMax));
  return Math.round(ratio * nextMax);
}
