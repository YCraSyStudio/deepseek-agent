
const MIN_IMAGE_ZOOM = 10;
const MAX_IMAGE_ZOOM = 800;

const ZOOM_FACTOR = 1.25;

export interface ImageSize {
  width: number;
  height: number;
}

export function fitZoomPercent(image: ImageSize, viewport: ImageSize): number {
  if (image.width <= 0 || image.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return 100;
  }
  const scale = Math.min(viewport.width / image.width, viewport.height / image.height, 1);
  return Math.min(100, Math.max(1, Math.round(scale * 100)));
}

export function resolveZoomPercent(
  zoom: number | null,
  image: ImageSize | null,
  viewport: ImageSize | null,
): number {
  if (zoom !== null) {
    return clampZoomPercent(zoom);
  }
  return image && viewport ? fitZoomPercent(image, viewport) : 100;
}

export function zoomInPercent(percent: number): number {
  return clampZoomPercent(percent * ZOOM_FACTOR);
}

export function zoomOutPercent(percent: number): number {
  return clampZoomPercent(percent / ZOOM_FACTOR);
}

export function canZoomIn(percent: number): boolean {
  return percent < MAX_IMAGE_ZOOM;
}

export function canZoomOut(percent: number): boolean {
  return percent > MIN_IMAGE_ZOOM;
}

export function scaledSize(image: ImageSize, percent: number): ImageSize {
  const scale = percent / 100;
  return { width: Math.round(image.width * scale), height: Math.round(image.height * scale) };
}

export function clampZoomPercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return 100;
  }
  return Math.min(MAX_IMAGE_ZOOM, Math.max(MIN_IMAGE_ZOOM, Math.round(percent)));
}
