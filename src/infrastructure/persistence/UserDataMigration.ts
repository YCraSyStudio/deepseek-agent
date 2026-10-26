import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { getGenerationCheckpointPath, getHistoryDirectory, getLegacyGenerationCheckpointDirectory } from "./UserDataPaths";
import { link, copyFile, mkdir, readFile, lstat, readdir, realpath, rename, rm, rmdir, unlink } from "node:fs/promises";
import * as path from "node:path";
import { withFileLock } from "./JsonFileStorage";

/** Remove the obsolete runtime directories left by older extension versions. */
export async function removeLegacyRuntimes(directory: string): Promise<void> {
  const root = await lstat(directory).catch((error: unknown) => {
    if (isMissing(error)) {return undefined;}
    throw error;
  });
  if (!root) {return;}
  if (!root.isDirectory() || root.isSymbolicLink()) {throw new Error("Refusing to clean runtimes through a redirected data directory");}
  for (const name of ["runtimes", "runtime-state"]) {
    // rm removes symlinks themselves without following their targets.
    await rm(path.join(directory, name), { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
  }
}

/** Run only while the old checkpoint folder exists; preserve destination conflicts. */
export async function migrateGenerationCheckpoints(): Promise<void> {
  const legacy = getLegacyGenerationCheckpointDirectory();
  if (!await entryExists(legacy)) {return;}
  const root = await lstat(legacy);
  if (!root.isDirectory() || root.isSymbolicLink()) {throw new Error("Refusing to migrate redirected generation checkpoints");}
  const history = await lstat(getHistoryDirectory()).catch((error: unknown) => {if (isMissing(error)) {return undefined;} throw error;});
  if (history?.isSymbolicLink()) {throw new Error("Refusing redirected checkpoint history");}
  await withFileLock(path.join(getHistoryDirectory(), ".checkpoint-migration"), async () => {
    const entries = await readdir(legacy, { withFileTypes: true }).catch((error: unknown) => {
      if (isMissing(error)) {return [];}
      throw error;
    });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {continue;}
      const source = path.join(legacy, entry.name);
      const stat = await lstat(source);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) {throw new Error("Invalid legacy checkpoint file");}
      const content = await readFile(source, "utf8");
      const checkpoint: unknown = JSON.parse(content);
      if (!checkpoint || typeof checkpoint !== "object" || !("conversationId" in checkpoint) ||
        typeof checkpoint.conversationId !== "string" ||
        entry.name !== `${checkpoint.conversationId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 512)}.json`) {
        throw new Error("Invalid legacy checkpoint identity; original file was preserved");
      }
      const target = getGenerationCheckpointPath(checkpoint.conversationId);
      await mkdir(path.dirname(target), { recursive: true });
      const parent = await lstat(path.dirname(target));
      if (!parent.isDirectory() || parent.isSymbolicLink()) {throw new Error("Refusing redirected checkpoint destination");}
      if (await entryExists(target)) {
        const destination = await lstat(target);
        if (!destination.isFile() || destination.isSymbolicLink() || destination.size > 16 * 1024 * 1024 ||
          JSON.stringify(JSON.parse(await readFile(target, "utf8"))) !== JSON.stringify(checkpoint)) {
          throw new Error("Checkpoint migration conflict; both copies were preserved");
        }
      } else {
        const temporary = path.join(path.dirname(target), `.checkpoint-migration-${randomUUID()}.tmp`);
        try {
          await copyFile(source, temporary, constants.COPYFILE_EXCL);
          // Publish the completed copy atomically without replacing a newer file.
          await link(temporary, target);
        } finally {
          await rm(temporary, { force: true });
        }
      }
      await unlink(source);
    }
    await rmdir(legacy).catch((error: unknown) => {
      if (isMissing(error) || (error instanceof Error && "code" in error && ["ENOTEMPTY", "EEXIST"].includes(String(error.code)))) {return;}
      throw error;
    });
  });
}

/** Run on upgrade only while the legacy root exists; never overwrite destination data. */
export async function migrateUserDataDirectory(legacyDirectory: string, directory: string): Promise<void> {
  const legacy = path.resolve(legacyDirectory);
  const destination = path.resolve(directory);
  if (legacy === destination) {return;}
  if (destination.startsWith(`${legacy}${path.sep}`) || legacy.startsWith(`${destination}${path.sep}`)) {
    throw new Error("Agent data directories must not be nested");
  }
  if (!await entryExists(legacy)) {return;}

  await withFileLock(path.join(destination, ".legacy-migration"), async () => {
    const source = await lstat(legacy).catch((error: unknown) => {
      if (isMissing(error)) {return undefined;}
      throw error;
    });
    if (!source) {return;}
    if (source.isSymbolicLink()) {
      if (await realpath(legacy) === await realpath(destination)) {
        await unlink(legacy);
        return;
      }
      throw new Error("Legacy agent data points to another directory; migration was not performed");
    }
    if (!source.isDirectory()) {throw new Error("Legacy agent data is not a directory");}
    const target = await lstat(destination);
    if (!target.isDirectory() || target.isSymbolicLink()) {throw new Error("Agent data destination must be a directory");}

    await withFileLock(path.join(legacy, "settings.json"), () =>
      withFileLock(path.join(destination, "settings.json"), async () => {
        const entries = (await readdir(legacy)).filter((name) => name !== "settings.json.lock");
        for (const name of entries) {
          if (await entryExists(path.join(destination, name))) {
            throw new Error(`Agent data migration conflict: ${name} already exists at the destination; both copies were preserved`);
          }
        }
        for (const name of entries) {
          await rename(path.join(legacy, name), path.join(destination, name));
        }
      }),
    );
    await rmdir(legacy);
  });
}

async function entryExists(file: string): Promise<boolean> {
  try {await lstat(file); return true;}
  catch (error) {if (isMissing(error)) {return false;} throw error;}
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
