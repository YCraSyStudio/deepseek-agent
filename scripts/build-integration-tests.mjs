import { build } from "esbuild";

await build({
  entryPoints: [
    "apps/vscode/src/test/integration/Extension.test.ts",
    "apps/vscode/src/test/integration/PackagedSmoke.test.ts",
    "apps/vscode/src/test/integration/PackagedRunner.ts",
  ],
  bundle: true,
  sourcemap: process.env.DEEPSEEK_AGENT_TEST_COVERAGE === "1",
  platform: "node",
  format: "cjs",
  external: ["vscode", "mocha"],
  outdir: ".tmp/integration-tests",
});
