#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveReleaseMode } from "./release-mode.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8"));

const mode = resolveReleaseMode({
  eventName: process.env.GITHUB_EVENT_NAME ?? "",
  ref: process.env.GITHUB_REF ?? "",
  headCommitMessage: process.env.HEAD_COMMIT_MESSAGE ?? "",
  version: manifest.version,
});

const outputs = `release=${mode.release}\ntag=${mode.tag}\nreason=${mode.reason}\n`;
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, outputs);
} else {
  process.stdout.write(outputs);
}
console.log(
  `Release mode: ${mode.release} (${mode.reason})${mode.release ? ` -> ${mode.tag}` : ""}.`,
);
