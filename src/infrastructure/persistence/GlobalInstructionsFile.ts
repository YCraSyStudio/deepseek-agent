import { mkdir, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { getUserDataDirectory } from "./UserDataPaths";

export function getGlobalInstructionsFilePath(directory = getUserDataDirectory()): string {
  return path.join(directory, "AGENTS.md");
}

/** Opening customization never replaces the user's existing instructions. */
export async function ensureGlobalInstructionsFile(directory = getUserDataDirectory()): Promise<string> {
  const file = getGlobalInstructionsFilePath(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {await writeFile(file, "", { encoding: "utf8", flag: "wx", mode: 0o600 });}
  catch (error) {if ((error as NodeJS.ErrnoException).code !== "EEXIST") {throw error;}}
  if (!(await stat(file)).isFile()) {throw new Error("Global AGENTS.md must be a file.");}
  return file;
}
