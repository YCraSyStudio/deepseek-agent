import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import { t } from "@webview/i18n";
import { useDialogFocus } from "@webview/components/chatView/tools/confirmations/UseDialogFocus";
import {
  canZoomIn,
  canZoomOut,
  resolveZoomPercent,
  scaledSize,
  zoomInPercent,
  zoomOutPercent,
  type ImageSize,
} from "./ImageZoom";
import { centeredScrollOffset, rescaledScrollOffset } from "./ImagePan";
import { useImagePan } from "./UseImagePan";
import "./ImageLightbox.css";

export interface LightboxImage {
  id: string;
  src: string;
  name: string;
}

type Props = {
  image: LightboxImage | null;
  onClose: () => void;
};

export default function ImageLightbox({ image, onClose }: Props) {
  const isOpen = image !== null;
  const labelId = useId();
  const dialogRef = useDialogFocus(onClose, image?.id ?? "", isOpen);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [naturalSize, setNaturalSize] = useState<ImageSize | null>(null);
  const [viewportSize, setViewportSize] = useState<ImageSize | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const previousContentSize = useRef<ImageSize | null>(null);
  const renderedImageId = useRef<string | null>(null);

  useEffect(() => {
    setNaturalSize(null);
    setViewportSize(null);
    setZoom(null);
    previousContentSize.current = null;
  }, [image?.id]);

  useEffect(() => {
    if (!isOpen) {return;}
    const viewport = viewportRef.current;
    if (!viewport) {return;}
    const measure = () => {
      const next = contentSize(viewport);
      setViewportSize((current) =>
        current && current.width === next.width && current.height === next.height ? current : next,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") {return;}
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [isOpen, image?.id]);

  const percent = resolveZoomPercent(zoom, naturalSize, viewportSize);
  const renderedSize = naturalSize ? scaledSize(naturalSize, percent) : null;
  const canZoomInNow = canZoomIn(percent);
  const canZoomOutNow = canZoomOut(percent);
  const pannable = isPannable(renderedSize, viewportSize);
  const pan = useImagePan(viewportRef);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !isOpen) {return;}
    const content = { width: viewport.scrollWidth, height: viewport.scrollHeight };
    const size = { width: viewport.clientWidth, height: viewport.clientHeight };
    const isNewImage = renderedImageId.current !== (image?.id ?? null);
    const previous = isNewImage ? null : previousContentSize.current;
    const offset = previous
      ? rescaledScrollOffset({ left: viewport.scrollLeft, top: viewport.scrollTop }, previous, content, size)
      : centeredScrollOffset(content, size);
    viewport.scrollLeft = offset.left;
    viewport.scrollTop = offset.top;
    renderedImageId.current = image?.id ?? null;
    previousContentSize.current = content;
  }, [image?.id, isOpen, percent, viewportSize?.height, viewportSize?.width]);

  const zoomIn = useCallback(() => setZoom(zoomInPercent(percent)), [percent]);
  const zoomOut = useCallback(() => setZoom(zoomOutPercent(percent)), [percent]);
  const fitToWindow = useCallback(() => setZoom(null), []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomIn();
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomOut();
      } else if (event.key === "0") {
        event.preventDefault();
        fitToWindow();
      }
    },
    [fitToWindow, zoomIn, zoomOut],
  );

  const handleViewportClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (pan.didDrag()) {return;}
      if (event.target instanceof HTMLImageElement) {return;}
      onClose();
    },
    [onClose, pan],
  );

  if (!image) {return null;}

  return (
    <div className="imageLightboxBackdrop" role="presentation">
      <section
        ref={dialogRef}
        className="imageLightboxDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="imageLightboxHeader" id={labelId} title={image.name}>{image.name}</div>
        <div
          className={`imageLightboxViewport${pannable ? " isPannable" : ""}${pan.isPanning ? " isPanning" : ""}`}
          ref={viewportRef}
          onClick={handleViewportClick}
          {...pan.handlers}
        >
          <div className="imageLightboxCanvas">
            <img
              className="imageLightboxImage"
              src={image.src}
              alt={image.name}
              draggable={false}
              style={renderedSize
                ? { width: renderedSize.width, height: renderedSize.height }
                : { maxWidth: "100%", maxHeight: "100%" }}
              onLoad={(event) => setNaturalSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })}
            />
          </div>
        </div>
        <div className="imageLightboxControls">
          <div className="imageLightboxZoom">
            <button
              type="button"
              className="imageLightboxButton"
              onClick={zoomOut}
              disabled={!canZoomOutNow}
              aria-label={t("chat.zoomOut")}
              data-tooltip={t("chat.zoomOut")}
            >
              <span className="codicon codicon-zoom-out" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="imageLightboxZoomValue"
              onClick={fitToWindow}
              data-dialog-initial-focus
              aria-label={t("chat.fitImageToWindow")}
              data-tooltip={t("chat.fitImageToWindow")}
            >
              {percent}%
            </button>
            <button
              type="button"
              className="imageLightboxButton"
              onClick={zoomIn}
              disabled={!canZoomInNow}
              aria-label={t("chat.zoomIn")}
              data-tooltip={t("chat.zoomIn")}
            >
              <span className="codicon codicon-zoom-in" aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            className="imageLightboxButton imageLightboxClose"
            onClick={onClose}
            aria-label={t("chat.closeImagePreview")}
            data-tooltip={t("chat.closeImagePreview")}
            data-tooltip-align="end"
          >
            <span className="codicon codicon-close" aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  );
}

function contentSize(element: HTMLElement): ImageSize {
  const styles = window.getComputedStyle(element);
  const paddingX = Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight);
  const paddingY = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
  return {
    width: element.clientWidth - paddingX,
    height: element.clientHeight - paddingY,
  };
}

function isPannable(rendered: ImageSize | null, viewport: ImageSize | null): boolean {
  if (!rendered || !viewport) {return false;}
  return rendered.width > viewport.width || rendered.height > viewport.height;
}
