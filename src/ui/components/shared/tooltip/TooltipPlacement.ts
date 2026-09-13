
export type TooltipSide = "top" | "bottom" | "left" | "right";

export type TooltipAlign = "start" | "center" | "end";

export interface TooltipAnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TooltipSize {
  width: number;
  height: number;
}

export interface TooltipPlacementRequest {
  anchor: TooltipAnchorRect;
  tooltip: TooltipSize;
  viewport: TooltipSize;
  side: TooltipSide;
  align: TooltipAlign;
}

export interface TooltipPlacement {
  top: number;
  left: number;
  side: TooltipSide;
}

export const TOOLTIP_OFFSET = 8;

export const TOOLTIP_MARGIN = 6;

const OPPOSITE_SIDE: Record<TooltipSide, TooltipSide> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

export function parseTooltipSide(value: string | undefined): TooltipSide {
  return value === "bottom" || value === "left" || value === "right" ? value : "top";
}

export function parseTooltipAlign(value: string | undefined): TooltipAlign {
  return value === "start" || value === "end" ? value : "center";
}

export function resolveTooltipPlacement({
  anchor,
  tooltip,
  viewport,
  side,
  align,
}: TooltipPlacementRequest): TooltipPlacement {
  const resolvedSide = fits(anchor, tooltip, viewport, side) || !fits(anchor, tooltip, viewport, OPPOSITE_SIDE[side])
    ? side
    : OPPOSITE_SIDE[side];
  const position = sideCoordinates(resolvedSide, anchor, tooltip, align);
  return {
    side: resolvedSide,
    top: clamp(position.top, tooltip.height, viewport.height),
    left: clamp(position.left, tooltip.width, viewport.width),
  };
}

function fits(anchor: TooltipAnchorRect, tooltip: TooltipSize, viewport: TooltipSize, side: TooltipSide): boolean {
  switch (side) {
    case "top":
      return anchor.top >= tooltip.height + TOOLTIP_OFFSET;
    case "bottom":
      return viewport.height - (anchor.top + anchor.height) >= tooltip.height + TOOLTIP_OFFSET;
    case "left":
      return anchor.left >= tooltip.width + TOOLTIP_OFFSET;
    case "right":
      return viewport.width - (anchor.left + anchor.width) >= tooltip.width + TOOLTIP_OFFSET;
  }
}

function sideCoordinates(
  side: TooltipSide,
  anchor: TooltipAnchorRect,
  tooltip: TooltipSize,
  align: TooltipAlign,
): { top: number; left: number } {
  switch (side) {
    case "top":
      return {
        top: anchor.top - tooltip.height - TOOLTIP_OFFSET,
        left: alignedOffset(align, anchor.left, anchor.width, tooltip.width),
      };
    case "bottom":
      return {
        top: anchor.top + anchor.height + TOOLTIP_OFFSET,
        left: alignedOffset(align, anchor.left, anchor.width, tooltip.width),
      };
    case "left":
      return {
        top: alignedOffset(align, anchor.top, anchor.height, tooltip.height),
        left: anchor.left - tooltip.width - TOOLTIP_OFFSET,
      };
    case "right":
      return {
        top: alignedOffset(align, anchor.top, anchor.height, tooltip.height),
        left: anchor.left + anchor.width + TOOLTIP_OFFSET,
      };
  }
}

function alignedOffset(align: TooltipAlign, start: number, anchorSize: number, tooltipSize: number): number {
  switch (align) {
    case "start":
      return start;
    case "end":
      return start + anchorSize - tooltipSize;
    case "center":
      return start + (anchorSize - tooltipSize) / 2;
  }
}

function clamp(value: number, tooltipSize: number, viewportSize: number): number {
  const limit = Math.max(TOOLTIP_MARGIN, viewportSize - tooltipSize - TOOLTIP_MARGIN);
  return Math.round(Math.min(Math.max(value, TOOLTIP_MARGIN), limit));
}
