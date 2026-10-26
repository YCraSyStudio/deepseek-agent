import type * as vscode from "vscode";
import { isRecord } from "@/shared/utils/TypeGuards";
import { redactSensitiveText } from "@/shared/security/Redaction";

// Only project metadata: no source contents, absolute paths or recursive scans.
export async function captureChatSuggestionContext(
  workspace: Pick<typeof vscode.workspace, "workspaceFolders" | "fs">,
  signal: AbortSignal,
): Promise<string> {
  const projects = [];
  for (const folder of (workspace.workspaceFolders ?? []).slice(0, 4)) {
    signal.throwIfAborted();
    let entries: [string, vscode.FileType][] = [];
    let manifest: Record<string, unknown> = {};
    try {
      entries = await workspace.fs.readDirectory(folder.uri);
      if (entries.some(([name, type]) => name === "package.json" && type === 1)) {
        const uri = folder.uri.with({ path: `${folder.uri.path.replace(/\/$/, "")}/package.json` });
        const stat = await workspace.fs.stat(uri);
        if (stat.type === 1 && stat.size <= 64 * 1024) {
          const bytes = await workspace.fs.readFile(uri);
          if (bytes.byteLength <= 64 * 1024) {
            const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
            if (isRecord(parsed)) {manifest = parsed;}
          }
        }
      }
    } catch { /* Missing or malformed metadata must not block drafting. */ }
    signal.throwIfAborted();
    projects.push({
      folder: metadata(folder.name, 120),
      name: metadata(manifest.displayName ?? manifest.name, 120),
      description: metadata(manifest.description, 400),
      entries: entries.filter(([name, type]) => (type === 1 || type === 2) && !name.startsWith(".") &&
        !/^(?:node_modules|dist|build|out|bin|obj|target|coverage)$/i.test(name) &&
        !/(?:secret|credential|\.pem$|\.key$|\.p12$|\.pfx$)/i.test(name))
        .map(([name]) => metadata(name, 80)).sort().slice(0, 12),
    });
  }
  return projects.length ? JSON.stringify({ projects }) : "";
}

function metadata(value: unknown, limit: number): string | undefined {
  return typeof value === "string" ? redactSensitiveText(value).replace(/[\r\n\t]/g, " ").slice(0, limit) : undefined;
}
