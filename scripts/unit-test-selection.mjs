import { isAbsolute, relative, sep } from "node:path";

export function selectUnitTests(files, testDir, args) {
  const positions = args.flatMap((arg, index) => arg === "--path" ? [index] : []);
  if (positions.length === 0) { return files; }
  if (positions.length !== 1) { throw new Error("Use --path only once."); }
  const requested = args[positions[0] + 1];
  if (!requested || requested.startsWith("--") || isAbsolute(requested)) {
    throw new Error("--path requires a file or directory relative to src/test.");
  }
  const parts = requested.replaceAll("\\", "/").split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) {
    throw new Error("--path must stay within src/test.");
  }
  const prefix = parts.join("/");
  const selected = files.filter((file) => {
    const name = relative(testDir, file).split(sep).join("/");
    return name === prefix || name.startsWith(`${prefix}/`);
  });
  if (!selected.length) { throw new Error(`No unit tests found for --path ${requested}.`); }
  return selected;
}
