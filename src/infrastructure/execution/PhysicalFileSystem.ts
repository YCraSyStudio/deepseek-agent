import * as nodeFs from "node:fs";
import { createRequire } from "node:module";

// Electron's patched fs exposes ASAR members as virtual filesystem paths.
// OS sandbox runners must operate on the physical namespace seen by the kernel.
// Do not change process.noAsar: other extension-host operations may run concurrently.
export function physicalFileSystem(): typeof nodeFs.promises {
  if (!process.versions.electron) {return nodeFs.promises;}
  const original = createRequire(process.execPath)("original-fs") as typeof nodeFs;
  return original.promises;
}
