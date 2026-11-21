import type {
  MobileWorkspaceErrorCode, MobileWorkspaceFailure, MobileWorkspaceFile, MobileWorkspaceListing,
} from "@/contracts/messages/MobileWorkspace";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { t } from "@webview/i18n";
import { WorkspaceEditor } from "./WorkspaceEditor";
import { buildWorkspaceTree, WorkspaceTree } from "./WorkspaceTree";
import "./WorkspaceWorkbench.css";

export interface WorkspaceReference {
  path: string;
  rootUri: string;
  content: string;
}

interface OpenFile extends MobileWorkspaceFile {
  path: string;
  initialText: string;
  baseline: string;
  instance: number;
}

class WorkspaceRequestError extends Error {
  constructor(readonly status: number, readonly code?: MobileWorkspaceErrorCode) {
    super(t("workspace.requestFailed", { status }));
  }
}

async function workspaceRequest<T>(route: string, file?: MobileWorkspaceFile, lifetime?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (lifetime?.aborted) {abort();}
  lifetime?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15000);
  try {
    const response = await fetch("/ui/workspace/" + route, {
      method: file ? "PUT" : "GET",
      signal: controller.signal,
      cache: "no-store",
      headers: { "X-YcraSy-Workspace": "1", ...(file ? { "Content-Type": "application/json" } : {}) },
      body: file ? JSON.stringify(file) : undefined,
    });
    if (response.status === 409) {throw new Error(t("workspace.conflict"));}
    if (!response.ok) {
      const failure = await response.json().catch(() => undefined) as MobileWorkspaceFailure | undefined;
      throw new WorkspaceRequestError(response.status, failure?.code);
    }
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
    lifetime?.removeEventListener("abort", abort);
  }
}

export default function WorkspaceWorkbench({ children, onAttach }: {
  children: ReactNode;
  onAttach: (reference: WorkspaceReference) => void;
}) {
  const [listing, setListing] = useState<MobileWorkspaceListing>();
  const [reload, setReload] = useState({ id: 0, silent: false });
  const [filter, setFilter] = useState("");
  const [file, setFile] = useState<OpenFile>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<"files" | "editor" | "chat">("chat");
  const dirty = !!file && file.text !== file.baseline;

  const requestListing = useCallback((silent: boolean) => {
    setReload(current => ({ id: current.id + 1, silent }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void workspaceRequest<MobileWorkspaceListing>("files", undefined, controller.signal)
      .then(next => {if (!controller.signal.aborted) {setListing(next);}})
      .catch((failure: unknown) => {
        if (!controller.signal.aborted && !reload.silent) {setError(errorMessage(failure));}
      });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (tab !== "files") {return;}
    requestListing(true);
    const poll = () => {
      if (document.visibilityState !== "hidden") {requestListing(true);}
    };
    const interval = window.setInterval(poll, 10000);
    document.addEventListener("visibilitychange", poll);
    window.addEventListener("focus", poll);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", poll);
      window.removeEventListener("focus", poll);
    };
  }, [requestListing, tab]);

  useEffect(() => {
    if (!dirty) {return;}
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const query = filter.trim().toLowerCase();
  const tree = useMemo(() => buildWorkspaceTree((listing?.files ?? [])
    .filter(path => path.toLowerCase().includes(query))), [listing, query]);
  const editText = useCallback((text: string) => {
    setFile(current => current ? { ...current, text } : current);
    setStatus(undefined);
  }, []);

  async function openFile(path: string, discard = false) {
    if (busy) {return;}
    if (file?.path === path && !discard) {setTab("editor"); return;}
    if (dirty && !discard) {setError(t("workspace.unsaved")); setTab("editor"); return;}
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    setTab("editor");
    try {
      const opened = await workspaceRequest<MobileWorkspaceFile>(fileRoute(path));
      const text = opened.text.replace(/\r\n/g, "\n");
      setFile({ ...opened, text, path, baseline: text, initialText: text, instance: Date.now() });
    } catch (failure) {
      setError(errorMessage(failure));
      if (staleListing(failure)) {requestListing(true);}
    } finally {
      setBusy(false);
    }
  }

  async function saveFile() {
    if (!file || !dirty || busy) {return;}
    const { path, text, revision } = file;
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      const saved = await workspaceRequest<MobileWorkspaceFile>(fileRoute(path), { text, revision });
      if (saved.text.replace(/\r\n/g, "\n") !== text) {throw new Error(t("workspace.conflict"));}
      setFile(current => current ? { ...current, revision: saved.revision, baseline: text } : current);
      setStatus(t("workspace.saved"));
    } catch (failure) {
      setError(errorMessage(failure));
      if (staleListing(failure)) {requestListing(true);}
    } finally {
      setBusy(false);
    }
  }

  return <div className="workspaceWorkbench" data-tab={tab}>
    <nav className="workspaceNavigation" aria-label={t("workspace.navigation")}>
      <button type="button" onClick={() => setTab("files")} aria-pressed={tab === "files"}>{t("workspace.files")}</button>
      <button type="button" onClick={() => setTab("editor")} aria-pressed={tab === "editor"}>{t("workspace.editor")}</button>
      <button type="button" onClick={() => setTab("chat")} aria-pressed={tab === "chat"}>{t("workspace.chat")}</button>
    </nav>
    <aside className="workspaceFiles" aria-label={t("workspace.files")}>
      <div className="workspaceToolbar">
        <strong>{listing?.workspace ?? t("workspace.files")}</strong>
        <button type="button" onClick={() => {setError(undefined); requestListing(false);}}>{t("workspace.refresh")}</button>
      </div>
      <input type="search" aria-label={t("workspace.filter")} placeholder={t("workspace.filter")} value={filter}
        onChange={event => setFilter(event.target.value)} />
      <WorkspaceTree tree={tree} active={file?.path} expanded={!!query} onOpen={path => void openFile(path)} />
    </aside>
    <section className="workspaceEditorPane" aria-label={t("workspace.editor")}>
      {file ? <>
        <div className="workspaceToolbar">
          <strong title={file.path}>{file.path}{dirty ? " •" : ""}</strong>
          <button type="button" onClick={() => void saveFile()} disabled={!dirty || busy}>{t("workspace.save")}</button>
          <button type="button" onClick={() => {
            if (!listing) {return;}
            onAttach({ path: file.path, rootUri: listing.rootUri, content: file.baseline });
            setTab("chat");
          }} disabled={dirty || busy || !listing}>{t("workspace.attach")}</button>
          {dirty && <button type="button" disabled={busy} onClick={() => {
            if (window.confirm(t("workspace.discardConfirm"))) {void openFile(file.path, true);}
          }}>{t("workspace.discard")}</button>}
        </div>
        <WorkspaceEditor key={file.instance} path={file.path} initialText={file.initialText} onChange={editText} />
      </> : <p className="workspacePlaceholder">{t("workspace.openFile")}</p>}
    </section>
    <section className="workspaceChatPane" aria-label={t("workspace.chat")}>{children}</section>
    {error ? <p className="workspaceFeedback" role="alert">{error}</p> : status ?
      <p className="workspaceFeedback" role="status">{status}</p> : null}
  </div>;
}

function fileRoute(path: string): string {
  return "file?" + new URLSearchParams({ path });
}

function staleListing(error: unknown): boolean {
  return error instanceof WorkspaceRequestError && (error.code === "missing" || error.code === "notTracked");
}

function errorMessage(error: unknown): string {
  if (error instanceof WorkspaceRequestError) {
    switch (error.code) {
      case "missing": return t("workspace.fileMissing");
      case "notTracked": return t("workspace.fileNotTracked");
      case "symlink": return t("workspace.fileSymlink");
    }
  }
  return error instanceof Error && error.name === "Error" ? error.message : t("workspace.connectionFailed");
}
