// Keep real disk behavior and inject only individual filesystem failures.
// The unprefixed built-in avoids the test bundle's node:fs/promises alias.
import * as fs from "fs/promises";
export * from "fs/promises";

type Operation = "mkdir" | "rename" | "rm" | "stat" | "writeFile" | "lstat" | "copyFile";
export const storageFaults: Array<{ operation: Operation; error: unknown; when?: (...args: unknown[]) => boolean }> = [];

async function invoke<T>(operation: Operation, args: unknown[], action: () => Promise<T>): Promise<T> {
  const index = storageFaults.findIndex((fault) => fault.operation === operation && (!fault.when || fault.when(...args)));
  if (index >= 0) { const [fault] = storageFaults.splice(index, 1); throw fault!.error; }
  return action();
}
export function mkdir(...args: Parameters<typeof fs.mkdir>) { return invoke("mkdir", args, () => fs.mkdir(...args)); }
export function rename(...args: Parameters<typeof fs.rename>) { return invoke("rename", args, () => fs.rename(...args)); }
export function rm(...args: Parameters<typeof fs.rm>) { return invoke("rm", args, () => fs.rm(...args)); }
export function stat(...args: Parameters<typeof fs.stat>) { return invoke("stat", args, () => fs.stat(...args)); }
export function writeFile(...args: Parameters<typeof fs.writeFile>) { return invoke("writeFile", args, () => fs.writeFile(...args)); }
export function lstat(...args: Parameters<typeof fs.lstat>) { return invoke("lstat", args, () => fs.lstat(...args)); }
export function copyFile(...args: Parameters<typeof fs.copyFile>) { return invoke("copyFile", args, () => fs.copyFile(...args)); }
