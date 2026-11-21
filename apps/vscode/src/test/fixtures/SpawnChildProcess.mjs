import { spawn } from "node:child_process";

const markerPath = process.argv[2];
const childScript = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "alive"), 800)`;
spawn(process.execPath, ["-e", childScript], { stdio: "ignore", windowsHide: true });
setInterval(() => undefined, 1000);
