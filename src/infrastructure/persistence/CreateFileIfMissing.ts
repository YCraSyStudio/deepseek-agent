import { writeFile } from "node:fs/promises";

/** Atomically creates a file while preserving any existing user content. */
export async function createFileIfMissing(file: string, content: string, mode: number): Promise<void> {
  try {await writeFile(file, content, { encoding: "utf8", flag: "wx", mode });}
  catch (error) {if ((error as NodeJS.ErrnoException).code !== "EEXIST") {throw error;}}
}
