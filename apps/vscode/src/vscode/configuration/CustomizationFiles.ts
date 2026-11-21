import * as vscode from "vscode";

export interface CustomizationWatchTarget {
  directory: vscode.Uri;
  pattern: string;
  /** Watch this directory's creation/deletion as well as its contents. */
  parent?: { directory: vscode.Uri; name: string };
}

/** Shared lifecycle for customization files, including files outside the workspace. */
export function watchCustomizationFiles(
  view: vscode.WebviewView,
  targets: () => CustomizationWatchTarget[],
  refresh: () => void,
): vscode.Disposable {
  let watchers: vscode.Disposable[] = [];
  const bind = () => {
    watchers.forEach((watcher) => watcher.dispose());
    watchers = [];
    for (const target of targets()) {
      const files = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(target.directory, target.pattern));
      watchers.push(files, files.onDidCreate(refresh), files.onDidChange(refresh), files.onDidDelete(refresh));
      if (target.parent) {
        const parent = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(target.parent.directory, target.parent.name));
        const changed = () => {bind();refresh();};
        watchers.push(parent, parent.onDidCreate(changed), parent.onDidDelete(changed));
      }
    }
  };
  const rebind = () => {bind();refresh();};
  bind();
  return vscode.Disposable.from(
    new vscode.Disposable(() => {watchers.forEach((watcher) => watcher.dispose());}),
    vscode.workspace.onDidChangeWorkspaceFolders(rebind),
    vscode.window.onDidChangeWindowState((state) => {if (state.focused) {rebind();}}),
    view.onDidChangeVisibility(() => {if (view.visible) {refresh();}}),
  );
}

export async function openCustomizationFile(file: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(document, { preview: false });
}
