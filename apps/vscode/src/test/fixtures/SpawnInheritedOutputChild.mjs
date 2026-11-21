import { spawn } from "node:child_process";

const [marker] = process.argv.slice(2);
const script = [
  "const { writeFileSync } = require('node:fs');",
  `setTimeout(() => writeFileSync(${JSON.stringify(marker)}, "survived"), 5000);`,
  "setInterval(() => process.stdout.write('.'), 100);",
].join("");

const child = spawn(process.execPath, ["-e", script], {
  stdio: ["ignore", "inherit", "inherit"],
  detached: true,
});
child.unref();
