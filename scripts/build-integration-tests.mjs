import { build } from "esbuild";

await build({
  entryPoints: [
    "src/test/integration/Extension.test.ts",
    "src/test/integration/PackagedSmoke.test.ts",
    "src/test/integration/PackagedRunner.ts",
  ],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode", "mocha"],
  outdir: ".tmp/integration-tests",
});
