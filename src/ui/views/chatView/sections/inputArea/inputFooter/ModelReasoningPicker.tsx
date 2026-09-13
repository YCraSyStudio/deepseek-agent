import { useEffect, useMemo, type ReactNode } from "react";
import { t } from "@webview/i18n";
import { useComposerPopover } from "./UseComposerPopover";

type PickerOption = { value: string; label: string };

interface ModelReasoningPickerProps {
  model: string;
  reasoning: string;
  modelOptions: readonly PickerOption[];
  reasoningOptions: readonly PickerOption[];
  onModelChange: (value: string) => void;
  onReasoningChange: (value: string) => void;
  compact?: boolean;
  permission?: {
    value: string;
    options: readonly PickerOption[];
    pending: boolean;
    onChange: (value: string) => void;
  };
  children?: ReactNode;
}

function ModelReasoningPicker({
  model,
  reasoning,
  modelOptions,
  reasoningOptions,
  onModelChange,
  onReasoningChange,
  compact = false,
  permission,
  children,
}: ModelReasoningPickerProps) {
  const { open, rootRef, triggerRef, openPopover, closePopover, togglePopover, maxHeight } = useComposerPopover();
  const modelLabel = useMemo(
    () => modelOptions.find((option) => option.value === model)?.label ?? model,
    [model, modelOptions],
  );
  const reasoningLabel = useMemo(
    () => reasoningOptions.find((option) => option.value === reasoning)?.label ?? reasoning,
    [reasoning, reasoningOptions],
  );

  useEffect(() => {
    if (!open) {return;}
    const frame = requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, rootRef]);

  return (
    <div className={`modelReasoningPicker${compact ? " compactComposerPicker" : ""}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="modelReasoningTrigger"
        aria-label={`${compact ? t("navigation.settings") : t("chat.modelSelector")}: ${modelLabel}; ${t("chat.reasoning")}: ${reasoningLabel}`}
        data-tooltip={compact ? t("navigation.settings") : `${modelLabel} · ${reasoningLabel}`}
        data-tooltip-align="end"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={togglePopover}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
            event.preventDefault();
            openPopover();
          }
        }}
      >
        {compact ? <span className="codicon codicon-settings-gear" aria-hidden="true" /> : <span className="modelReasoningValue">
          <span className="modelReasoningModel">{modelLabel}</span>
          <span className="modelReasoningEffort">{reasoningLabel}</span>
        </span>}
        <span className={`codicon codicon-chevron-${open ? "up" : "down"}`} aria-hidden="true" />
      </button>

      {open ? (
        <div
          className="modelReasoningMenu"
          role="menu"
          style={{ maxHeight }}
          aria-label={compact ? t("navigation.settings") : `${t("chat.modelSelector")} / ${t("chat.reasoning")}`}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closePopover(true);
              return;
            }
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)'));
              const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
              const nextIndex = event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : event.key === "ArrowDown"
                    ? (currentIndex + 1) % items.length
                    : (currentIndex - 1 + items.length) % items.length;
              items[nextIndex]?.focus();
            }
          }}
        >
          <PickerSection
            label={t("chat.reasoning")}
            options={reasoningOptions}
            selectedValue={reasoning}
            onSelect={onReasoningChange}
          />
          <PickerSection
            label={t("chat.model")}
            options={modelOptions}
            selectedValue={model}
            onSelect={onModelChange}
          />
          {permission ? <PickerSection
            label={t("tools.permissionMode")}
            options={permission.options}
            selectedValue={permission.value}
            onSelect={permission.onChange}
            disabled={permission.pending}
          /> : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}

interface PickerSectionProps {
  label: string;
  options: readonly PickerOption[];
  selectedValue: string;
  onSelect: (value: string) => void;
  disabled?: boolean;
}

function PickerSection({ label, options, selectedValue, onSelect, disabled = false }: PickerSectionProps) {
  return (
    <section className="modelReasoningSection" aria-label={label}>
      <div className="modelReasoningSectionLabel">{label}</div>
      {options.map((option) => {
        const selected = option.value === selectedValue;
        return (
          <button
            key={option.value}
            type="button"
            className={`modelReasoningOption ${selected ? "selected" : ""}`}
            role="menuitemradio"
            aria-checked={selected}
            disabled={disabled}
            aria-busy={disabled}
            onClick={() => onSelect(option.value)}
          >
            <span>{option.label}</span>
            {selected ? <span className="codicon codicon-check" aria-hidden="true" /> : null}
          </button>
        );
      })}
    </section>
  );
}

export default ModelReasoningPicker;
