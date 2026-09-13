import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "summary",
].join(",");

export function useDialogFocus(onEscape: () => void, focusKey: string, isOpen: boolean): RefObject<HTMLElement | null> {
  const dialogRef = useRef<HTMLElement>(null);
  const onEscapeRef = useRef(onEscape);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!isOpen) {return;}
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const handleKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) {return;}

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }

      if (event.key !== "Tab") {return;}
      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      if (previouslyFocused?.isConnected) {previouslyFocused.focus();}
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {return;}
    const dialog = dialogRef.current;
    if (!dialog) {return;}
    const initialFocus = dialog.querySelector<HTMLElement>("[data-dialog-initial-focus]");
    const firstFocusable = getFocusableElements(dialog)[0];
    (initialFocus || firstFocusable || dialog).focus();
  }, [focusKey, isOpen]);

  return dialogRef;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => {
      const closedDetails = element.closest("details:not([open])");
      const hiddenByDetails = closedDetails !== null && element.tagName !== "SUMMARY";
      return element.getAttribute("aria-hidden") !== "true" && !element.hidden && !hiddenByDetails;
    },
  );
}
