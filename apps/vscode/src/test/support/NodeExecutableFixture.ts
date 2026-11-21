import { createRequire, syncBuiltinESMExports } from "node:module";
import type * as ChildProcess from "node:child_process";

/** Launch a test's Node script through Node on hosts without shebang support. */
export function nodeExecutableFixture(executable: string): () => void {
  const childProcess = createRequire(import.meta.url)("node:child_process") as typeof ChildProcess;
  const original = childProcess.spawn;
  childProcess.spawn = ((command: string, args: readonly string[], options: ChildProcess.SpawnOptions) =>
    command === executable
      ? original(process.execPath, [executable, ...args], options)
      : original(command, args, options)) as typeof ChildProcess.spawn;
  syncBuiltinESMExports();
  return () => { childProcess.spawn = original; syncBuiltinESMExports(); };
}
