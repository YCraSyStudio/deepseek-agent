import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { isSensitiveWorkspacePath } from "@/infrastructure/tools/ToolWorkspace";

const git = promisify(execFile);
const maxFileBytes = 128 * 1024;

export class MobileError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export class MobileWorkspace {
  private saving = false;

  constructor(readonly root: vscode.WorkspaceFolder) {}

  async files(): Promise<string[]> {
    this.requireWorkspace();
    const { stdout } = await git("git", ["ls-files", "-z", "--stage", "--", "."], {
      cwd: this.root.uri.fsPath, timeout: 5000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    }).catch(() => { throw new MobileError(422, "No se pudo listar el repositorio Git de esta carpeta."); });
    return stdout.split("\0").flatMap(entry => {
      const separator = entry.indexOf("\t");
      const metadata = entry.slice(0, separator);
      const file = entry.slice(separator + 1);
      return /^100(?:644|755) [0-9a-f]+ 0$/.test(metadata) && allowedPath(file) ? [file] : [];
    }).sort();
  }

  async read(file: string) {
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
    if (!allowedPath(file) || !(await this.files()).includes(file)) {
      throw new MobileError(404, "Solo puedes abrir archivos versionados de la carpeta seleccionada.");
    }
    const root = await realpath(this.root.uri.fsPath);
    const target = path.join(root, file);
    const canonical = await realpath(target).catch(() => "");
    if (!canonical || path.relative(target, canonical) !== "") {
      throw new MobileError(404, "El archivo no está disponible o contiene enlaces simbólicos.");
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
