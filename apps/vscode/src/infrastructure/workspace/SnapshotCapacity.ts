import { lstat, readdir, statfs } from "node:fs/promises";
import * as path from "node:path";

const DISK_RESERVE = 100 * 1024 * 1024;

export async function assertSnapshotCapacity(dataRoot: string, limitMb: number, bytesToCopy: number,
  freeBytes?: number): Promise<void> {
  const snapshotRoot = path.join(dataRoot, "snapshoots");
  let used = 0;
  const pending = [snapshotRoot];
  while (pending.length) {
    const directory = pending.pop()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {pending.push(file);}
      else {used += (await lstat(file)).size;}
    }
  }
  // Includes staging and replacing the mirror: independent copies can temporarily coexist.
  const required = bytesToCopy * 2;
  if (used + required > limitMb * 1024 * 1024) {
    throw new Error(`Recovery snapshots would exceed the configured ${limitMb} MiB storage limit. Delete old chats/snapshots or raise the limit in Settings.`);
  }
  const available = Number(freeBytes ?? await statfs(dataRoot).then((info) => Number(info.bavail) * Number(info.bsize)));
  if (!Number.isFinite(available) || available < required + DISK_RESERVE) {throw new Error("Not enough free disk space for a recovery copy while keeping 100 MiB free");}
}
