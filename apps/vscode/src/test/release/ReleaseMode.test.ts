import * as assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = process.cwd();
const scriptPath = resolve(projectRoot, "scripts/detect-release-mode.mjs");
const manifest = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")) as { version: string };

suite("release mode detection", () => {
  test("publishes a pushed version tag", () => {
    assert.deepStrictEqual(
      run({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/v0.1.14" }),
      { release: "true", tag: "v0.1.14", reason: "v-tag" },
    );
  });

  test("publishes a main push whose commit subject requests a release", () => {
    assert.deepStrictEqual(
      run({
        GITHUB_EVENT_NAME: "push",
        GITHUB_REF: "refs/heads/main",
        HEAD_COMMIT_MESSAGE: "release: fix v0.1.14 preview\n\nLonger explanation.",
      }),
      { release: "true", tag: `v${manifest.version}`, reason: "release-commit" },
    );
  });

  test("reads the release request from the subject only", () => {
    assert.deepStrictEqual(
      run({
        GITHUB_EVENT_NAME: "push",
        GITHUB_REF: "refs/heads/main",
        HEAD_COMMIT_MESSAGE: "fix: preview focus\n\nrelease: v0.1.15",
      }),
      { release: "false", tag: "", reason: "none" },
    );
  });

  test("accepts a release request that is not lower case", () => {
    assert.deepStrictEqual(
      run({
        GITHUB_EVENT_NAME: "push",
        GITHUB_REF: "refs/heads/main",
        HEAD_COMMIT_MESSAGE: "Release: cut v0.1.14",
      }),
      { release: "true", tag: `v${manifest.version}`, reason: "release-commit" },
    );
  });

  test("ignores a release request outside main", () => {
    for (const ref of ["refs/heads/develop", "refs/heads/release-0.1"]) {
      assert.deepStrictEqual(
        run({ GITHUB_EVENT_NAME: "push", GITHUB_REF: ref, HEAD_COMMIT_MESSAGE: "release: cut v0.1.14" }),
        { release: "false", tag: "", reason: "none" },
        `Unexpected release for ${ref}.`,
      );
    }
  });

  test("ignores events that cannot carry a release request", () => {
    const events: NodeJS.ProcessEnv[] = [
      { GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/pull/98/merge", HEAD_COMMIT_MESSAGE: "release: cut v0.1.14" },
      { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", HEAD_COMMIT_MESSAGE: "" },
      { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main", HEAD_COMMIT_MESSAGE: "Merge pull request #98 from YCraSyStudio/develop" },
    ];
    for (const event of events) {
      assert.deepStrictEqual(run(event), { release: "false", tag: "", reason: "none" }, JSON.stringify(event));
    }
  });

  test("writes the outputs to stdout when GitHub provides no output file", () => {
    assert.deepStrictEqual(
      run({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/v0.1.14", GITHUB_OUTPUT: "" }),
      { release: "true", tag: "v0.1.14", reason: "v-tag" },
    );
  });
});

function run(env: NodeJS.ProcessEnv): Record<string, string> {
  const outputPath = join(mkdtempSync(join(tmpdir(), "release-mode-")), "github-output.txt");
  const stdout = execFileSync(process.execPath, [scriptPath], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, HEAD_COMMIT_MESSAGE: "", GITHUB_OUTPUT: outputPath, ...env },
  });
  return parseOutputs(existsSync(outputPath) ? readFileSync(outputPath, "utf8") : stdout);
}

function parseOutputs(text: string): Record<string, string> {
  const outputs: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator > 0) {
      outputs[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }
  return outputs;
}
