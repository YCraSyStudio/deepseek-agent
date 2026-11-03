import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { mergeLegacyJson } from "./MergeLegacyJson";

/** Caller holds both settings locks and the destination migration lock. */
export async function mergeLegacyData(legacy: string, destination: string): Promise<void> {
  const hadSettings = await statIfPresent(path.join(destination, "settings.json"));
  for (const name of await readdir(legacy)) {
    if (name === "settings.json.lock") {continue;}
    if (name === "settings.json.transaction.json" && hadSettings) {
      await preserveFile(path.join(legacy, name), name, destination, "legacy");
      await unlink(path.join(legacy, name));
    } else {
      await mergeEntry(path.join(legacy, name), path.join(destination, name), name, destination);
    }
  }
}

async function mergeEntry(source: string, target: string, relative: string, destination: string): Promise<void> {
  const from = await lstat(source);
  const to = await statIfPresent(target);
  if (from.isSymbolicLink() || to?.isSymbolicLink()) {throw new Error("Refusing redirected legacy data migration");}
  if (!to) {
    try {await rename(source, target); return;}
    catch (error) {if (!(error instanceof Error && "code" in error && error.code === "EXDEV")) {throw error;}}
    if (from.isFile()) {
      await copyFile(source, target, constants.COPYFILE_EXCL);
      await unlink(source);
      return;
    }
    await mkdir(target);
  }
  if (from.isDirectory() && (!to || to.isDirectory())) {
    for (const name of await readdir(source)) {
      await mergeEntry(path.join(source, name), path.join(target, name), path.join(relative, name), destination);
    }
    await rmdir(source);
    return;
  }
  if (!from.isFile() || !to?.isFile()) {throw new Error(`Conflicting data entry types: ${relative}`);}
  const oldContent = await readFile(source);
  const currentContent = await readFile(target);
  if (oldContent.equals(currentContent)) {await unlink(source); return;}
  await preserveFile(source, relative, destination, "legacy");
  await preserveFile(target, relative, destination, "current");
  let result: Buffer;
  if (relative.endsWith(".json")) {
    let old: unknown;
    let current: unknown;
    let oldValid = true;
    let currentValid = true;
    try {old = JSON.parse(oldContent.toString("utf8"));} catch {oldValid = false;}
    try {current = JSON.parse(currentContent.toString("utf8"));} catch {currentValid = false;}
    if (oldValid && currentValid) {
      const merged = mergeLegacyJson(old, current);
      result = Buffer.from(`${JSON.stringify(merged.value, null, 2)}\n`);
    } else {
      result = oldValid ? oldContent : currentValid ? currentContent
        : oldContent.length > currentContent.length ? oldContent : currentContent;
    }
  } else {
    result = oldContent.length > currentContent.length ? oldContent : currentContent;
  }
  const temporary = `${target}.${randomUUID()}.migration.tmp`;
  try {
    await writeFile(temporary, result, { mode: 0o600, flag: "wx" });
    await rename(temporary, target);
  } finally {await rm(temporary, { force: true });}
  await unlink(source);
}

async function preserveFile(source: string, relative: string, destination: string, side: "legacy" | "current"): Promise<string> {
  const stat = await lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink()) {throw new Error("Refusing to archive redirected legacy data");}
  const content = await readFile(source);
  const hash = createHash("sha256").update(content).digest("hex");
  const backup = path.join(destination, "migration-backups", side, `${relative}.${hash}.bak`);
  await safeParents(destination, path.dirname(backup));
  try {await copyFile(source, backup, constants.COPYFILE_EXCL);}
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {throw error;}
  }
  const entry = await lstat(backup);
  if (!entry.isFile() || entry.isSymbolicLink() || !content.equals(await readFile(backup))) {throw new Error("Legacy backup verification failed");}
  return backup;
}

async function safeParents(destination: string, directory: string): Promise<void> {
  let parent = destination;
  for (const name of path.relative(destination, directory).split(path.sep)) {
    parent = path.join(parent, name);
    await mkdir(parent).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {throw error;}
    });
    const entry = await lstat(parent);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {throw new Error("Refusing redirected migration backup");}
  }
}

async function statIfPresent(file: string) {
  return lstat(file).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {return undefined;}
    throw error;
  });
}
