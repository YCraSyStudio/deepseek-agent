import { useEffect, useMemo, useRef, useState } from "react";
import "./InputFooter.css";
import { MODEL_OPTIONS } from "@/contracts/deepseek/Models";
import ReferencedFilesChips from "./ReferencedFilesChips";
import type { ReferencedFile } from "@/contracts";
import type { PermissionMode } from "@/contracts";
import { t } from "@webview/i18n";
import { getVsCodeApi } from "@webview/VsCodeApi";
import ModelReasoningPicker from "./ModelReasoningPicker";
import UsagePicker, { UsagePopover } from "./UsagePicker";
import type { UsageAggregate, UsageCurrency } from "@/shared/usage/Usage";
import type { ContextWindowStatus } from "@/contracts";
import type { ContextCompactionControls } from "@webview/views/chatView/ChatViewTypes";

type Props = {
  reasoning: string;
  selectedModel: string;
  permissionMode: PermissionMode;
  permissionUpdatePending?: boolean;
  onReasoningChange: (value: string) => void;
  onModelChange: (modelId: string) => void;
  onPermissionModeChange: (value: PermissionMode) => void;
  referencedFiles?: ReferencedFile[];
  onRemoveReferencedFile?: (index: number) => void;
  conversationId?: string;
  usage?: UsageAggregate;
  usageByModel?: readonly UsageAggregate[];
  usageCurrency?: UsageCurrency;
  showUsage?: boolean;
  contextWindow?: ContextWindowStatus;
  compaction?: ContextCompactionControls;
};

const PERMISSION_MODES: readonly PermissionMode[] = ["default", "auto-approve", "full-access"];

function parsePermissionMode(value: string): PermissionMode | undefined {
  return PERMISSION_MODES.find((mode) => mode === value);
}

function InputFooter({
  reasoning,
  selectedModel,
  permissionMode,
  permissionUpdatePending = false,
  onReasoningChange,
  onModelChange,
  onPermissionModeChange,
  referencedFiles = [],
  onRemoveReferencedFile,
  conversationId,
  usage,
  usageByModel = [],
  usageCurrency = "usd",
  showUsage = false,
  contextWindow,
  compaction,
}: Props) {
  const footerRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const composer = footerRef.current?.closest(".inputComposer");
    if (!composer) {return;}
    const observer = new ResizeObserver(([entry]) => {
      setCompact(entry.contentRect.width <= 440);
    });
    observer.observe(composer);
    return () => observer.disconnect();
  }, []);

  const reasoningOptions = useMemo(() => {
    return [{ value: "off", label: t("chat.off") }, { value: "low", label: t("chat.low") }, { value: "high", label: t("chat.high") }, { value: "max", label: t("chat.max") }];
  }, []);

  const modelOptions = useMemo(() => {
    const compactOptions = MODEL_OPTIONS.map((option) => ({
      ...option,
      label: option.label.replace(/^DeepSeek\s+/i, ""),
    }));
    if (!selectedModel || compactOptions.some((option) => option.value === selectedModel)) {
      return compactOptions;
    }
    return [...compactOptions, { value: selectedModel, label: selectedModel }];
  }, [selectedModel]);

  const permissionOptions: Array<{ value: PermissionMode; label: string }> = [
    { value: "default", label: t("tools.default") },
    { value: "auto-approve", label: t("tools.autoApprove") },
    { value: "full-access", label: t("tools.fullAccess") },
  ];

  return (
    <div className="inputFooter" ref={footerRef}>
      <ReferencedFilesChips files={referencedFiles} onRemove={onRemoveReferencedFile ?? (() => undefined)} />
      <div className="inputFooterControls">
        <div className="inputFooterPrimaryControls">
          <button
            type="button"
            className="attachmentPickerTrigger"
            aria-label={t("chat.attach")}
            data-tooltip={t("chat.attach")}
            data-tooltip-align="start"
            onClick={() => getVsCodeApi()?.postMessage({
              type: "selectAttachments",
              requestId: crypto.randomUUID(),
              conversationId,
            })}
          >
            <span className="codicon codicon-add" aria-hidden="true" />
          </button>
          <ModelReasoningPicker
            model={selectedModel}
            reasoning={reasoning}
            modelOptions={modelOptions}
            reasoningOptions={reasoningOptions}
            onModelChange={onModelChange}
            onReasoningChange={onReasoningChange}
            compact={compact}
            permission={compact ? {
              value: permissionMode,
              options: permissionOptions,
              pending: permissionUpdatePending,
              onChange: (value) => {
                const mode = parsePermissionMode(value);
                if (mode) {onPermissionModeChange(mode);}
              },
            } : undefined}
          >
            {compact && showUsage && usage && usage.count > 0 ? (
              <div className="compactComposerUsage">
                <UsagePopover
                  usage={usage}
                  usageByModel={usageByModel}
                  currency={usageCurrency}
                  contextWindow={contextWindow}
                  compaction={compaction}
                />
              </div>
            ) : null}
          </ModelReasoningPicker>
        </div>
        {!compact ? <div className="inputFooterSecondaryControls">
          {showUsage ? (
            <UsagePicker
              usage={usage}
              usageByModel={usageByModel}
              currency={usageCurrency}
              contextWindow={contextWindow}
              compaction={compaction}
            />
          ) : null}
          <span className="selectTooltipWrapper" data-tooltip={t("tools.permissionMode")} data-tooltip-align="end">
            <select
              name="PermissionMode"
              id="PermissionMode"
              aria-label={t("tools.permissionMode")}
              aria-busy={permissionUpdatePending}
              disabled={permissionUpdatePending}
              value={permissionMode}
              onChange={(event) => {
                const nextPermissionMode = parsePermissionMode(event.target.value);
                if (nextPermissionMode) { onPermissionModeChange(nextPermissionMode); }
              }}
            >
              {permissionOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </span>
        </div> : null}
      </div>
    </div>
  );
}

export default InputFooter;
