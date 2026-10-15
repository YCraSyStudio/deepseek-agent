import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// SDK/native modules cannot be bundled by esbuild. Preserve package boundaries and licenses.
// Copy dependency closures with dereferenced pnpm links into the VSIX allowlisted dist directory.
const destination = resolve("dist/node_modules");
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
const copied = new Set();
function copyPackage(name, from) {
  if (copied.has(name)) {return;}
  const require = createRequire(join(from, "package.json"));
  let entry;
  try { entry = require.resolve(`${name}/package.json`); }
  catch {
    entry = require.resolve(name);
    while (!existsSync(join(dirname(entry), "package.json"))) {entry = dirname(entry);}
    entry = join(dirname(entry), "package.json");
  }
  const source = dirname(entry);
  const metadata = JSON.parse(readFileSync(entry, "utf8"));
  const target = join(destination, name);
  copied.add(name);
  cpSync(source, target, { recursive: true, dereference: true,
    filter: (file) => !file.slice(source.length).split(/[\\/]/).includes("node_modules") });
  for (const dependency of Object.keys(metadata.dependencies ?? {})) {copyPackage(dependency, source);}
  if (name === "koffi") {
    for (const architecture of ["x64", "arm64"]) {copyPackage(`@koromix/koffi-win32-${architecture}`, source);}
  }
}
copyPackage("@microsoft/mxc-sdk", process.cwd());
// Only Windows uses MXC here. Keep both Windows architectures for a universal VSIX.
for (const architecture of ["x64", "arm64"]) {
  const bin = join(destination, "@microsoft/mxc-sdk/bin", architecture);
  for (const file of ["libmxc_ffi.so", "libmxc_ffi.dylib", "lxc-exec", "mxc-exec-mac", "unix-test-proxy", "dotnet"]) {
    rmSync(join(bin, file), { recursive: true, force: true });
  }
}
console.log(`Packaged sandbox runtime: ${[...copied].join(", ")}`);

const pty = join(destination, "node-pty");
for (const name of readdirSync(pty)) {
  if (!["package.json", "lib", "prebuilds", "LICENSE"].includes(name)) {rmSync(join(pty, name), { recursive: true, force: true });}
}
const prebuilds = join(pty, "prebuilds");
for (const name of readdirSync(prebuilds)) {
  if (!["win32-x64", "win32-arm64"].includes(name)) {rmSync(join(prebuilds, name), { recursive: true, force: true });}
  else {
    for (const file of readdirSync(join(prebuilds, name))) {
      if (file.endsWith(".pdb")) {rmSync(join(prebuilds, name, file), { force: true });}
    }
  }
}
for (const architecture of ["x64", "arm64"]) {
  if (!existsSync(join(destination, `@koromix/koffi-win32-${architecture}`, `win32_${architecture}`, "koffi.node"))) {
    throw new Error(`Missing Windows ${architecture} FFI binary in sandbox package`);
  }
}
