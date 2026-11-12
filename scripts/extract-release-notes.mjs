import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [changelogArg, packageArg, tagArg, outputArg] = process.argv.slice(2);
const changelogPath = resolve(changelogArg ?? "CHANGELOG.md");
const packagePath = resolve(packageArg ?? "package.json");
const tagName = tagArg ?? process.env.GITHUB_REF_NAME ?? "";
const outputPath = resolve(outputArg ?? "release-notes.md");

if (!tagName) {
  throw new Error("A release tag is required, for example v0.1.7.");
}

const version = tagName.replace(/^refs\/tags\//, "").replace(/^v/, "");
const manifest = JSON.parse(await readFile(packagePath, "utf8"));
if (manifest.version !== version) {
  throw new Error(
    `Release tag ${tagName} does not match package.json version ${manifest.version}.`,
  );
}

const changelog = await readFile(changelogPath, "utf8");
const release = extractRelease(changelog, version);
const title = release.date ? `Released ${release.date}.` : `Release notes for ${tagName}.`;
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${title}\n\n${release.notes}\n`, "utf8");
console.log(`Prepared release notes for ${tagName}.`);

function extractRelease(changelogContent, releaseVersion) {
  const lines = changelogContent.split(/\r?\n/);
  const escapedVersion = escapeRegExp(releaseVersion);
  const headingPattern = new RegExp(
    `^##\\s+(?:\\[(?:v)?${escapedVersion}\\]|(?:v)?${escapedVersion})(?:\\s+-\\s+(.+))?\\s*$`,
  );

  let start = -1;
  let date = "";
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(headingPattern);
    if (match) {
      start = index + 1;
      date = match[1]?.trim() ?? "";
      break;
    }
  }

  if (start < 0) {
    throw new Error(`CHANGELOG.md does not contain a section for ${releaseVersion}.`);
  }

  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }

  const notes = lines.slice(start, end).join("\n").trim();
  if (!notes) {
    throw new Error(`CHANGELOG.md section for ${releaseVersion} is empty.`);
  }

  return { date, notes };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
