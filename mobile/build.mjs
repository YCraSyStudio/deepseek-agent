import { mkdir, writeFile } from "node:fs/promises";
import { mobileAssets } from "../src/vscode/mobileIde/MobilePage.ts";

const dist = new URL("./dist/", import.meta.url);
await mkdir(dist, { recursive: true });
await Promise.all([...mobileAssets].map(([path, asset]) =>
  writeFile(new URL(path === "/" ? "index.html" : path.slice(1), dist), asset.body),
));
