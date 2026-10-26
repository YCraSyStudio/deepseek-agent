import type * as vscode from "vscode";
import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { getDefaultUserDataDirectory, resolveUserDataDirectory } from "@/infrastructure/persistence/UserDataPaths";

// Kept outside the selected directory so it can be found before loading settings.
const STORAGE_DIRECTORY_KEY = "storageDirectory";

export function getConfiguredStorageDirectory(context: Pick<vscode.ExtensionContext, "globalState">): string {
  return resolveUserDataDirectory(context.globalState.get<string>(STORAGE_DIRECTORY_KEY) ?? getDefaultUserDataDirectory());
}

export async function saveStorageDirectory(context: Pick<vscode.ExtensionContext, "globalState">, value: string): Promise<string> {
  const directory = resolveUserDataDirectory(value);
  await mkdir(directory, { recursive: true });
  await access(directory, constants.R_OK | constants.W_OK);
  await context.globalState.update(STORAGE_DIRECTORY_KEY, directory === getDefaultUserDataDirectory() ? undefined : directory);
  return directory;
}
