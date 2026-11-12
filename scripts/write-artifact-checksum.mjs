import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const input = resolve(process.argv[2] ?? "");
const output = resolve(process.argv[3] ?? "");
const digest = createHash("sha256")
  .update(await readFile(input))
  .digest("hex");
await writeFile(output, `${digest}  ${basename(input)}\n`, "utf8");
console.log(`${digest}  ${basename(input)}`);
