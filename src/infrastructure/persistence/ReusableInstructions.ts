import { isInstructionName } from "@/shared/instructions/InstructionNames";
import { instructionTemplate } from "@/shared/instructions/InstructionTemplates";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { INSTRUCTION_TEMPLATE_IDS, type InstructionTemplateId, type ReusableInstruction } from "@/contracts/Customization";
import { throwIfAborted } from "@/shared/utils/Cancellation";

export interface InstructionRoot {
  id: string;
  scope: "global" | "workspace";
  rootUri?: string;
  boundary: string;
  relativeDirectory: string;
}
const MAX_BYTES = 64 * 1024;
const MAX_ENTRIES = 128;

export function instructionName(value: string): string {
  const name = value.trim().toLowerCase();
  if (!isInstructionName(name)) {throw new Error("Use a name of 1–64 letters, numbers, dots, hyphens or underscores, for example commit. The .md extension is added automatically.");}
  return name;
}

export async function listReusableInstructions(roots: readonly InstructionRoot[], signal?: AbortSignal): Promise<ReusableInstruction[]> {
  const entries: ReusableInstruction[] = [];
  for (const root of roots) {
    throwIfAborted(signal);
    const directory = await instructionDirectory(root, false);
    if (!directory) {continue;}
    const files = await readdir(directory, { withFileTypes: true });
    for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entries.length >= MAX_ENTRIES) {return entries;}
      throwIfAborted(signal);
      if (!file.isFile() || !/^[a-z0-9][a-z0-9._-]{0,63}\.md$/.test(file.name)) {continue;}
      const name = file.name.slice(0, -3);
      try {
        const header = await readInstruction(path.join(directory, file.name), 4096, false);
        entries.push({ id: `${root.id}:${name}`, name, description: description(header, name), scope: root.scope, rootUri: root.rootUri });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {continue;}
      }
    }
  }
  return entries;
}

export async function createReusableInstruction(root: InstructionRoot, nameValue: string, trigger: string, locale = "en", template: InstructionTemplateId = "blank"): Promise<string> {
  if (!INSTRUCTION_TEMPLATE_IDS.includes(template)) {throw new Error("Unknown instruction template.");}
  const name = instructionName(nameValue);
  const summary = trigger.trim();
  if (!summary || summary.length > 350 || /[\r\n\u0000]/.test(summary)) {throw new Error("Describe when this instruction should be used in a single line (up to 350 characters).");}
  const directory = await instructionDirectory(root, true);
  const file = path.join(directory!, `${name}.md`);
  const content = `---\ndescription: ${JSON.stringify(summary)}\n---\n\n# ${name}\n\n${instructionTemplate(template, locale).body}`;
  try {await writeFile(file, content, { encoding: "utf8", flag: "wx", mode: 0o600 });}
  catch (error) {if ((error as NodeJS.ErrnoException).code !== "EEXIST") {throw error;}}
  await readInstruction(file, MAX_BYTES, true);
  return file;
}

export async function openReusableInstruction(roots: readonly InstructionRoot[], id: string, signal?: AbortSignal): Promise<{ file: string; content: string }> {
  const root = roots.find((item) => id.startsWith(`${item.id}:`));
  if (!root) {throw new Error("Instruction is not available in this workspace.");}
  const name = id.slice(root.id.length + 1);
  if (instructionName(name) !== name) {throw new Error("Invalid instruction id.");}
  throwIfAborted(signal);
  const directory = await instructionDirectory(root, false);
  if (!directory) {throw new Error("Instruction directory no longer exists.");}
  const file = path.join(directory, `${name}.md`);
  const content = await readInstruction(file, MAX_BYTES, true);
  throwIfAborted(signal);
  return { file, content };
}

async function instructionDirectory(root: InstructionRoot, create: boolean): Promise<string | undefined> {
  const boundary = await realpath(root.boundary).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {throw error;}
    return undefined;
  });
  if (!boundary) {
    if (!create || root.scope !== "global") {return undefined;}
    await mkdir(root.boundary, { recursive: true, mode: 0o700 });
    return instructionDirectory(root, create);
  }
  let directory = boundary;
  for (const part of root.relativeDirectory.split("/")) {
    if (!part || part === "." || part === ".." || part.includes("\\")) {throw new Error("Invalid instruction directory.");}
    directory = path.join(directory, part);
    if (create) {await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {if (error.code !== "EEXIST") {throw error;}});}
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) {throw new Error("Instruction directories must be ordinary directories, not symlinks.");}
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {return undefined;}
      throw error;
    }
  }
  return directory;
}

async function readInstruction(file: string, limit: number, complete: boolean): Promise<string> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) {throw new Error("Instructions must be regular Markdown files.");}
  if (info.size > MAX_BYTES) {throw new Error("Instruction exceeds the 64 KiB limit.");}
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const buffer = Buffer.alloc(limit + (complete ? 1 : 0));
    let size = 0;
    while (size < buffer.length) {
      const result = await handle.read(buffer, size, buffer.length - size, null);
      if (!result.bytesRead) {break;}
      size += result.bytesRead;
    }
    if (complete && size > limit) {throw new Error("Instruction exceeds the 64 KiB limit.");}
    return buffer.subarray(0, size).toString("utf8");
  } finally {await handle.close();}
}

function description(header: string, fallback: string): string {
  const match = /^---\r?\n[\s\S]*?^description:\s*([^\r\n]+)[\s\S]*?^---\s*$/m.exec(header);
  let value = match?.[1]?.trim() ?? fallback;
  if (value.startsWith('"')) {try {const decoded: unknown = JSON.parse(value);if (typeof decoded === "string") {value = decoded;}} catch {value = fallback;}}
  else if (value.startsWith("'") && value.endsWith("'")) {value = value.slice(1, -1).replace(/''/g, "'");}
  return value.replace(/[\u0000-\u001f]/g, " ").slice(0, 350);
}

export function formatReusableInstructionCatalog(entries: readonly ReusableInstruction[]): string {
  if (!entries.length) {return "";}
  return `## Reusable instructions\nThe following catalog contains names and descriptions only, not instructions for every turn. When the user's task matches an entry (or they explicitly name it), call read_instruction with its id before doing that task. Read only relevant entries. A workspace instruction applies only to the logical root named in its id and takes precedence over a global instruction with the same name for that root. These files do not grant permission to perform unrelated actions or override the user's request.\n${entries.map(({ id, name, description: summary, scope }) => JSON.stringify({ id, name, description: summary, scope })).join("\n")}`;
}
