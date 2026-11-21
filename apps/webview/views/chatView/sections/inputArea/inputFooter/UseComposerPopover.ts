import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const POPOVER_GAP = 8;
const VIEWPORT_EDGE = 8;
const MIN_POPOVER_HEIGHT = 180;
const MAX_POPOVER_HEIGHT = 560;

export function useComposerPopover() {
  const [open, setOpen] = useState(false);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // These popovers open upwards from a trigger whose distance to the top of the view
  // moves with the composer (field-sizing textarea, referenced-file chips). A fixed
  // viewport guess either wastes room, leaving a scrollbar for nothing, or pushes the
  // top of the panel out of reach.
  useLayoutEffect(() => {
    if (!open) {
      setMaxHeight(undefined);
      return;
    }

    const measure = () => {
      const top = triggerRef.current?.getBoundingClientRect().top;
      if (top === undefined) {return;}
      const available = Math.floor(top) - POPOVER_GAP - VIEWPORT_EDGE;
      setMaxHeight(Math.min(MAX_POPOVER_HEIGHT, Math.max(MIN_POPOVER_HEIGHT, available)));
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open]);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (!open) {return;}

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        close();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [close, open]);

  return {
    open,
    rootRef,
    triggerRef,
    maxHeight,
    openPopover: useCallback(() => setOpen(true), []),
    closePopover: close,
    togglePopover: useCallback(() => setOpen((current) => !current), []),
  };
}
