import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

export async function writeJsonFileAtomic(targetPath: string, value: unknown): Promise<void> {
  const directory = path.dirname(targetPath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.${path.basename(targetPath)}.${randomUUID()}.tmp`);

  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    try {
      await rename(temporaryPath, targetPath);
    } catch (error) {
      if (!isReplaceConflict(error)) {throw error;}
      await replaceWithRecoverableBackup(temporaryPath, targetPath);
    }
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function withFileLock<T>(targetPath: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${targetPath}.lock`;
  const deadline = Date.now() + 10_000;
  await mkdir(path.dirname(lockPath), { recursive: true });
  while (true) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if (!isAlreadyExists(error)) {throw error;}
      if (await isStaleLock(lockPath)) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for storage lock: ${path.basename(targetPath)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25 + Math.floor(Math.random() * 50)));
    }
  }
  try {
    return await operation();
  } finally {
    await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function replaceWithRecoverableBackup(temporaryPath: string, targetPath: string): Promise<void> {
  const backupPath = `${targetPath}.${randomUUID()}.bak`;
  let backupCreated = false;
  try {
    await rename(targetPath, backupPath);
    backupCreated = true;
    await rename(temporaryPath, targetPath);
    await rm(backupPath, { force: true });
  } catch (error) {
    if (backupCreated) {
      await rename(backupPath, targetPath).catch(() => undefined);
    }
    throw error;
  }
}

async function isStaleLock(lockPath: string): Promise<boolean> {
  try {
    return Date.now() - (await stat(lockPath)).mtimeMs > 30_000;
  } catch {
    return false;
  }
}

function isReplaceConflict(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {return false;}
  const code = String((error as { code?: unknown }).code);
  return code === "EEXIST" || code === "EPERM";
}

function isAlreadyExists(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EEXIST";
}
