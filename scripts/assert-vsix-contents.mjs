import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yauzl from "yauzl";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const expectedFileName = `deepseek-agent-${packageJson.version}.vsix`;
const vsixPath = resolve(process.argv[2] ?? join(projectRoot, "artifacts", expectedFileName));
if (basename(vsixPath) !== expectedFileName) {
  throw new Error(`Unexpected VSIX filename: expected ${expectedFileName}, received ${basename(vsixPath)}`);
}
if (!existsSync(vsixPath)) {
  throw new Error(`VSIX not found: ${vsixPath}`);
}

const entries = await listEntries(vsixPath);
const manifest = await readTextEntry(vsixPath, "extension.vsixmanifest");
const required = [
  "extension/package.json",
  "extension/dist/extension.js",
  "extension/dist/webview/index.html",
  "extension/readme.md",
];
for (const file of required) {
  if (!entries.has(file)) {
    throw new Error(`Required VSIX entry is missing: ${file}`);
  }
}

const allowedExact = new Set([
  "[Content_Types].xml",
  "extension.vsixmanifest",
  "extension/LICENSE.txt",
  "extension/changelog.md",
  "extension/package.json",
  "extension/readme.md",
]);
const unexpected = [...entries].filter((file) =>
  !allowedExact.has(file) &&
  !file.startsWith("extension/dist/") &&
  !file.startsWith("extension/src/assets/"),
);
if (unexpected.length > 0) {
  throw new Error(`Unexpected files outside the VSIX allowlist:\n${unexpected.join("\n")}`);
}
if (/Microsoft\.VisualStudio\.Code\.PreRelease/i.test(manifest)) {
  throw new Error("The VSIX must use the normal Marketplace release channel, not pre-release.");
}
if (!/<GalleryFlags>\s*Public Preview\s*<\/GalleryFlags>/i.test(manifest)) {
  throw new Error("The VSIX must retain the Public Preview gallery flag from package.json.");
}

console.log(`Verified ${entries.size} intentional VSIX entries and the normal-release/Public-Preview channel.`);

function listEntries(file) {
  return new Promise((resolveList, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) {
        reject(error ?? new Error("Unable to open VSIX"));
        return;
      }
      const names = new Set();
      zip.on("entry", (entry) => {
        if (!entry.fileName.endsWith("/")) {
          names.add(entry.fileName);
        }
        zip.readEntry();
      });
      zip.once("error", reject);
      zip.once("end", () => resolveList(names));
      zip.readEntry();
    });
  });
}

function readTextEntry(file, entryName) {
  return new Promise((resolveText, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) {
        reject(error ?? new Error("Unable to open VSIX"));
        return;
      }
      let found = false;
      zip.on("entry", (entry) => {
        if (entry.fileName !== entryName) {
          zip.readEntry();
          return;
        }
        found = true;
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            reject(streamError ?? new Error(`Unable to read ${entryName}`));
            return;
          }
          const chunks = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.once("error", reject);
          stream.once("end", () => {
            zip.close();
            resolveText(Buffer.concat(chunks).toString("utf8"));
          });
        });
      });
      zip.once("error", reject);
      zip.once("end", () => {
        if (!found) {reject(new Error(`VSIX entry is missing: ${entryName}`));}
      });
      zip.readEntry();
    });
  });
}
