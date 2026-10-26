import { isInstructionName } from "@/shared/instructions/InstructionNames";
import { useEffect, useMemo, useRef, useState } from "react";
import type { HandlerToWebviewMessage } from "@/contracts";
import { INSTRUCTION_TEMPLATE_IDS, type InstructionTemplateId, type ReusableInstruction, type WorkspaceInstructionsRoot } from "@/contracts/Customization";
import { SettingsField, SettingsGroup } from "@webview/components/settingsView";
import { getVsCodeApi } from "@webview/VsCodeApi";
import { getUiLocale, t } from "@webview/i18n";
import { instructionTemplate } from "@/shared/instructions/InstructionTemplates";
import "./ReusableInstructionsSection.css";

export default function ReusableInstructionsSection({ roots }: { roots: WorkspaceInstructionsRoot[] | null }) {
  const vscode = useMemo(() => getVsCodeApi(), []);
  const [entries, setEntries] = useState<ReusableInstruction[] | null>(null);
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [template, setTemplate] = useState<InstructionTemplateId>("blank");
  const [name, setName] = useState("blank");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState("global");
  const [pending, setPending] = useState(false);
  const request = useRef<string | undefined>(undefined);
  const selectedScope = scope === "global" || roots?.some((root) => root.uri === scope) ? scope : "global";

  useEffect(() => {
    const receive = (event: MessageEvent<HandlerToWebviewMessage>) => {
      const message = event.data;
      if (message.type === "reusableInstructions") {setEntries(message.entries);setError(message.error);}
      if (message.type === "reusableInstructionResult" && request.current === message.requestId) {
        request.current = undefined;
        setPending(false);
        setError(message.error);
        if (message.success) {setCreating(false);setTemplate("blank");setName("blank");setDescription("");}
      }
    };
    window.addEventListener("message", receive);
    vscode?.postMessage({ type: "getReusableInstructions" });
    return () => window.removeEventListener("message", receive);
  }, [vscode]);

  return (
    <SettingsGroup title={t("settings.reusable.title")}>
      <button type="button" className="btn-secondary" disabled={pending} data-tooltip={t("settings.reusable.help")}
        onClick={() => {setCreating(true);setError(undefined);}}>
        <i className="codicon codicon-add" aria-hidden="true" /> {t("settings.reusable.create")}
      </button>
      {creating ? (
        <form className="reusableInstructionForm" onSubmit={(event) => {
          event.preventDefault();
          if (pending || !isInstructionName(name.trim()) || !description.trim()) {return;}
          const requestId = crypto.randomUUID();
          request.current = requestId;
          setPending(true);
          setError(undefined);
          vscode?.postMessage({ type: "createReusableInstruction", requestId, template,
            scope: selectedScope === "global" ? "global" : "workspace",
            ...(selectedScope === "global" ? {} : { rootUri: selectedScope }), name: name.trim(), description: description.trim() });
        }}>
          <SettingsField htmlFor="reusableInstructionTemplate" label={t("settings.reusable.template")} tooltip={t("settings.reusable.templateHelp")} layout="wide">
            <select id="reusableInstructionTemplate" value={template} disabled={pending} onChange={(event) => {
              const selected = INSTRUCTION_TEMPLATE_IDS.find((id) => id === event.target.value);
              if (!selected) {return;}
              const starter = instructionTemplate(selected, getUiLocale());
              setTemplate(selected);setName(starter.name);setDescription(starter.description);
            }}>
              <option value="blank">Blank.md</option>
              <option value="git">git.md</option>
              <option value="commit">commit.md</option>
            </select>
          </SettingsField>
          <SettingsField htmlFor="reusableInstructionScope" label={t("settings.reusable.scope")} layout="wide">
            <select id="reusableInstructionScope" value={selectedScope} disabled={pending} onChange={(event) => setScope(event.target.value)}>
              <option value="global">{t("settings.reusable.global")}</option>
              {roots?.map((root) => <option key={root.uri} value={root.uri}>{t("settings.reusable.workspace")}: {root.name}</option>)}
            </select>
          </SettingsField>
          <SettingsField htmlFor="reusableInstructionName" label={t("settings.reusable.name")} tooltip={t("settings.reusable.nameHelp")} layout="wide">
            <div className="reusableInstructionName">
              <input id="reusableInstructionName" value={name} maxLength={64} placeholder="commit" required disabled={pending}
                aria-describedby="reusableInstructionExtension" onChange={(event) => setName(event.target.value)} />
              <span id="reusableInstructionExtension">.md</span>
            </div>
          </SettingsField>
          <SettingsField htmlFor="reusableInstructionDescription" label={t("settings.reusable.description")} layout="wide">
            <input id="reusableInstructionDescription" value={description} maxLength={350} placeholder={t("settings.reusable.descriptionPlaceholder")} required disabled={pending}
              onChange={(event) => setDescription(event.target.value)} />
          </SettingsField>
          <div className="reusableInstructionActions">
            <button type="submit" className="btn-secondary" disabled={pending || !isInstructionName(name.trim()) || !description.trim()} aria-busy={pending}>{t("settings.reusable.createAndEdit")}</button>
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => setCreating(false)}>{t("settings.reusable.cancel")}</button>
          </div>
        </form>
      ) : null}
      {!entries ? <p role="status">{t("settings.reusable.loading")}</p> : (["global", "workspace"] as const).map((entryScope) => {
        const scopedEntries = entries.filter((entry) => entry.scope === entryScope);
        return (
          <SettingsGroup key={entryScope} title={t(entryScope === "global" ? "settings.reusable.global" : "settings.reusable.workspace")}
            collapsible defaultOpen={false} variant="panel" count={scopedEntries.length}>
            {scopedEntries.length === 0 ? <p>{t("settings.reusable.empty")}</p> : (
              <div className="reusableInstructionList">
                {scopedEntries.map((entry) => (
                  <button type="button" key={entry.id} className="btn-secondary reusableInstructionItem" disabled={pending}
                    data-tooltip={entry.description} aria-label={`${t("settings.reusable.edit")} ${entry.name}.md`}
                    onClick={() => {
                      const requestId = crypto.randomUUID();request.current = requestId;setPending(true);setError(undefined);
                      vscode?.postMessage({ type: "openReusableInstruction", requestId, id: entry.id });
                    }}>
                    <span>{entry.name}.md {entry.scope === "workspace" ? <small>{roots?.find((root) => root.uri === entry.rootUri)?.name ?? t("settings.reusable.workspace")}</small> : null}</span>
                    <i className="codicon codicon-edit" aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
          </SettingsGroup>
        );
      })}
      {error ? <p role="alert">{error}</p> : null}
    </SettingsGroup>
  );
}
