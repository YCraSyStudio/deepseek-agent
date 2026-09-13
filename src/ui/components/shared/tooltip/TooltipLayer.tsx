import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./Tooltip.css";
import {
  parseTooltipAlign,
  parseTooltipSide,
  resolveTooltipPlacement,
  type TooltipAlign,
  type TooltipAnchorRect,
  type TooltipSide,
} from "./TooltipPlacement";

const TOOLTIP_LAYER_ID = "webview-tooltip-layer";

const TOOLTIP_SHOW_DELAY_MS = 350;

type ActiveTooltip = {
  anchor: HTMLElement;
  text: string;
  side: TooltipSide;
  align: TooltipAlign;
  describedBy: string | null;
};

function findTooltipAnchor(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {return null;}
  const anchor = target.closest<HTMLElement>("[data-tooltip]");
  return anchor && anchor.dataset.tooltip?.trim() ? anchor : null;
}

function anchorRect(anchor: HTMLElement): TooltipAnchorRect {
  const rect = anchor.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

function releaseAnchor(anchor: HTMLElement, describedBy: string | null): void {
  if (anchor.getAttribute("aria-describedby") !== TOOLTIP_LAYER_ID) {return;}
  if (describedBy === null) {
    anchor.removeAttribute("aria-describedby");
  } else {
    anchor.setAttribute("aria-describedby", describedBy);
  }
}

function TooltipLayer() {
  const [active, setActive] = useState<ActiveTooltip | null>(null);
  const activeRef = useRef<ActiveTooltip | null>(null);
  const pendingAnchorRef = useRef<HTMLElement | null>(null);
  const showTimerRef = useRef<number | undefined>(undefined);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const closeTooltip = useCallback(() => {
    window.clearTimeout(showTimerRef.current);
    showTimerRef.current = undefined;
    pendingAnchorRef.current = null;
    const current = activeRef.current;
    if (!current) {return;}
    activeRef.current = null;
    releaseAnchor(current.anchor, current.describedBy);
    setActive(null);
  }, []);

  const showTooltip = useCallback((anchor: HTMLElement) => {
    window.clearTimeout(showTimerRef.current);
    showTimerRef.current = undefined;
    pendingAnchorRef.current = null;
    const current = activeRef.current;
    if (current?.anchor === anchor) {return;}
    if (!anchor.isConnected) {return;}
    const text = anchor.dataset.tooltip?.trim();
    if (!text) {return;}
    if (current) {
      activeRef.current = null;
      releaseAnchor(current.anchor, current.describedBy);
    }
    const next: ActiveTooltip = {
      anchor,
      text,
      side: parseTooltipSide(anchor.dataset.tooltipPosition),
      align: parseTooltipAlign(anchor.dataset.tooltipAlign),
      describedBy: anchor.getAttribute("aria-describedby"),
    };
    anchor.setAttribute("aria-describedby", TOOLTIP_LAYER_ID);
    activeRef.current = next;
    setActive(next);
  }, []);

  useEffect(() => {
    const schedule = (anchor: HTMLElement) => {
      window.clearTimeout(showTimerRef.current);
      pendingAnchorRef.current = anchor;
      showTimerRef.current = window.setTimeout(() => showTooltip(anchor), TOOLTIP_SHOW_DELAY_MS);
    };

    const handlePointerOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") {return;}
      const anchor = findTooltipAnchor(event.target);
      if (!anchor || anchor === pendingAnchorRef.current || anchor === activeRef.current?.anchor) {return;}
      schedule(anchor);
    };

    const handlePointerOut = (event: PointerEvent) => {
      const anchor = findTooltipAnchor(event.target);
      if (!anchor || isWithin(anchor, event.relatedTarget)) {return;}
      if (anchor === pendingAnchorRef.current || anchor === activeRef.current?.anchor) {closeTooltip();}
    };

    const handleFocusIn = (event: FocusEvent) => {
      const anchor = findTooltipAnchor(event.target);
      if (anchor?.matches(":focus-visible")) {showTooltip(anchor);}
    };

    const handleFocusOut = (event: FocusEvent) => {
      const anchor = findTooltipAnchor(event.target);
      if (!anchor || isWithin(anchor, event.relatedTarget)) {return;}
      if (anchor === activeRef.current?.anchor) {closeTooltip();}
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {closeTooltip();}
    };

    const handleWindowBlur = () => closeTooltip();

    document.addEventListener("pointerover", handlePointerOver);
    document.addEventListener("pointerout", handlePointerOut);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    document.addEventListener("pointerdown", closeTooltip, true);
    document.addEventListener("click", closeTooltip, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      document.removeEventListener("pointerover", handlePointerOver);
      document.removeEventListener("pointerout", handlePointerOut);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      document.removeEventListener("pointerdown", closeTooltip, true);
      document.removeEventListener("click", closeTooltip, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("blur", handleWindowBlur);
      closeTooltip();
    };
  }, [closeTooltip, showTooltip]);

  const activeAnchor = active?.anchor;
  useEffect(() => {
    if (!activeAnchor) {return;}
    const observer = new MutationObserver(() => {
      const text = activeAnchor.dataset.tooltip?.trim();
      if (!text) {
        closeTooltip();
        return;
      }
      setActive((current) => current?.anchor === activeAnchor && current.text !== text ? { ...current, text } : current);
    });
    observer.observe(activeAnchor, { attributes: true, attributeFilter: ["data-tooltip"] });
    return () => observer.disconnect();
  }, [activeAnchor, closeTooltip]);

  useLayoutEffect(() => {
    const node = tooltipRef.current;
    if (!active || !node) {return;}

    const place = () => {
      if (!active.anchor.isConnected) {
        closeTooltip();
        return;
      }
      const placement = resolveTooltipPlacement({
        anchor: anchorRect(active.anchor),
        tooltip: { width: node.offsetWidth, height: node.offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        side: active.side,
        align: active.align,
      });
      node.style.top = `${placement.top}px`;
      node.style.left = `${placement.left}px`;
      node.dataset.visible = "true";
    };

    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [active, closeTooltip]);

  if (!active) {return null;}

  return createPortal(
    <div className="tooltipLayer" id={TOOLTIP_LAYER_ID} role="tooltip" ref={tooltipRef}>
      {active.text}
    </div>,
    document.body,
  );
}

function isWithin(anchor: HTMLElement, target: EventTarget | null): boolean {
  return target instanceof Node && anchor.contains(target);
}

export default TooltipLayer;
