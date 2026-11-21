import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import type { MobileWorkspaceErrorCode, MobileWorkspaceFile } from "@/contracts/messages/MobileWorkspace";
import * as vscode from "vscode";
import { isSensitiveWorkspacePath } from "@/infrastructure/tools/ToolWorkspace";

const git = promisify(execFile);
const maxFileBytes = 128 * 1024;

export class MobileError extends Error {
  constructor(readonly status: number, message: string, readonly code?: MobileWorkspaceErrorCode) {
    super(message);
  }
}

export class MobileWorkspace {
  private saving = false;

  constructor(readonly root: vscode.WorkspaceFolder) {}

  async files(): Promise<string[]> {
    this.requireWorkspace();
    const [listed, removed] = await Promise.all([
      this.gitList(["ls-files", "-z", "-t", "--stage", "--", "."], 2 * 1024 * 1024),
      this.gitList(["ls-files", "-z", "--deleted", "--", "."], 256 * 1024),
    ]);
    const deleted = new Set(removed);
    const entries = listed.flatMap(entry => {
      const separator = entry.indexOf("\t");
      const metadata = entry.slice(0, separator);
      const file = entry.slice(separator + 1);
      const match = /^([HS]) 100(?:644|755) [0-9a-f]+ 0$/.exec(metadata);
      return match && allowedPath(file) && !deleted.has(file) ? [{ file, sparse: match[1] === "S" }] : [];
    });
    const files: string[] = [];
    await Promise.all(entries.map(async entry => {
      if (!entry.sparse || await this.exists(entry.file)) { files.push(entry.file); }
    }));
    return files.sort();
  }

  async changes() {
    this.requireWorkspace();
    const [prefix, status] = await Promise.all([
      this.git(["rev-parse", "--show-prefix"]),
      this.git(["--no-optional-locks", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--", "."]),
    ]);
    const relativePrefix = prefix.replace(/\r?\n$/, "");
    return status.split("\0").flatMap(entry => {
      const file = entry.slice(3);
      if (!file.startsWith(relativePrefix)) { return []; }
      const localFile = file.slice(relativePrefix.length);
      return allowedPath(localFile) ? [{ file: localFile, index: entry[0], worktree: entry[1] }] : [];
    });
  }

  async diff(file: string) {
    const change = (await this.changes()).find(entry => entry.file === file);
    if (!change) { throw new MobileError(404, "El archivo no tiene cambios visibles."); }
    if (change.index === "?") { return { staged: "", unstaged: "", untracked: true }; }

    const options = ["--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--submodule=short"];
    const [staged, unstaged] = await Promise.all([
      this.git(["--literal-pathspecs", "diff", "--cached", ...options, "--", file]),
      this.git(["--literal-pathspecs", "diff", ...options, "--", file]),
    ]);
    return { staged, unstaged, untracked: false };
  }

  private async gitList(args: string[], maxBuffer: number): Promise<string[]> {
    const { stdout } = await git("git", args, {
      cwd: this.root.uri.fsPath, timeout: 5000, maxBuffer, windowsHide: true,
    }).catch(() => { throw new MobileError(422, "No se pudo listar el repositorio Git de esta carpeta."); });
    return stdout.split("\0").filter(Boolean);
  }

  private async exists(file: string): Promise<boolean> {
    return (await lstat(path.join(this.root.uri.fsPath, file)).catch(() => undefined))?.isFile() === true;
  }

  private async tracked(file: string): Promise<boolean> {
    const entries = await this.gitList(["--literal-pathspecs", "ls-files", "-z", "--stage", "--", file], 64 * 1024);
    return entries.some(entry => {
      const separator = entry.indexOf("\t");
      return separator > 0 && entry.slice(separator + 1) === file &&
        /^100(?:644|755) [0-9a-f]+ 0$/.test(entry.slice(0, separator));
    });
  }

  private async git(args: string[]): Promise<string> {
    const { stdout } = await git("git", args, {
      cwd: this.root.uri.fsPath, timeout: 5000, maxBuffer: 512 * 1024, windowsHide: true,
    }).catch(() => { throw new MobileError(422, "Git no pudo leer los cambios o superan el límite de tamaño."); });
    return stdout;
  }

  async read(file: string): Promise<MobileWorkspaceFile> {
    const { text, revision } = await this.snapshot(file);
    return { text, revision };
  }

  async save(file: string, text: string, revision: string, signal: AbortSignal): Promise<void> {
    if (this.saving) { throw new MobileError(409, "Hay otro guardado en curso."); }
    if (Buffer.byteLength(text) > maxFileBytes || text.includes("\0") || Buffer.from(text).toString() !== text) {
      throw new MobileError(422, "El contenido debe ser texto UTF-8 de hasta 128 KiB.");
    }

    this.saving = true;
    try {
      const before = await this.snapshot(file);
      const document = await vscode.workspace.openTextDocument(before.uri);
      const current = await this.snapshot(file);
      this.requireWorkspace();
      signal.throwIfAborted();
      if (current.revision !== revision || document.isDirty || document.getText() !== current.text) {
        throw new MobileError(409, "El archivo ha cambiado en el PC. Copia tu borrador y vuelve a abrir el archivo.");
      }
      const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
      const replacement = text.replace(/\r?\n/g, eol);
      const edit = new vscode.WorkspaceEdit();
      const end = document.positionAt(document.getText().length);
      edit.replace(document.uri, new vscode.Range(new vscode.Position(0, 0), end), replacement);
      if (!await vscode.workspace.applyEdit(edit) || document.getText() !== replacement || !await document.save()) {
        throw new MobileError(409, "VS Code no pudo guardar el cambio. Comprueba el archivo en el PC.");
      }
    } finally {
      this.saving = false;
    }
  }

  requireWorkspace(): void {
    if (!vscode.workspace.isTrusted || !vscode.workspace.workspaceFolders?.some(
      folder => folder.uri.toString() === this.root.uri.toString(),
    )) {
      throw new MobileError(403, "La carpeta ya no está disponible como espacio de trabajo de confianza.");
    }
  }

  private async snapshot(file: string) {
    if (!allowedPath(file) || !(await this.tracked(file))) {
      throw new MobileError(404, "Solo puedes abrir archivos versionados de la carpeta seleccionada.", "notTracked");
    }
    const root = await realpath(this.root.uri.fsPath);
    const target = path.join(root, file);
    const canonical = await realpath(target).catch(() => "");
    if (!canonical) {
      throw new MobileError(404, "El archivo ya no existe en el PC. Actualiza la lista de archivos.", "missing");
    }
    if (path.relative(target, canonical) !== "") {
      throw new MobileError(404, "El archivo no está disponible o contiene enlaces simbólicos.", "symlink");
    }
    const metadata = await lstat(target);
    if (!metadata.isFile()) {
      throw new MobileError(422, "Solo se admiten archivos de texto UTF-8 de hasta 128 KiB.");
    }
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink !== 1 || opened.size > maxFileBytes ||
          opened.dev !== metadata.dev || opened.ino !== metadata.ino || await realpath(target) !== canonical) {
        throw new MobileError(422, "Solo se admiten archivos de texto UTF-8 de hasta 128 KiB.");
      }
      const buffer = Buffer.alloc(maxFileBytes + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
        if (result.bytesRead === 0) { break; }
        bytesRead += result.bytesRead;
      }
      const data = buffer.subarray(0, bytesRead);
      const text = data.toString("utf8");
      if (bytesRead > maxFileBytes || text.includes("\0") || !Buffer.from(text).equals(data)) {
        throw new MobileError(422, "Solo se admiten archivos de texto UTF-8 de hasta 128 KiB.");
      }
      return {
        uri: vscode.Uri.joinPath(this.root.uri, file),
        text: text.replace(/^\uFEFF/, ""),
        revision: createHash("sha256").update(data).digest("hex"),
      };
    } finally {
      await handle.close();
    }
  }
}

function allowedPath(file: string): boolean {
  return Boolean(file) && !file.includes("\\") && !file.includes(":") &&
    file.split("/").every(segment => segment !== "" && segment !== "." && segment !== "..") &&
    !isSensitiveWorkspacePath(file);
}
