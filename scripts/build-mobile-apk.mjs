import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const mobileDirectory = join(projectRoot, "legacy", "tauri");
const artifactsDirectory = join(projectRoot, "artifacts");

const targetArgument = process.argv.indexOf("--target");
const target = targetArgument === -1 ? "aarch64" : process.argv[targetArgument + 1];
if (!target) {
  throw new Error("Falta el valor de --target (por ejemplo aarch64).");
}

const fail = (message) => {
  console.error(`build-mobile-apk: ${message}`);
  process.exit(1);
};

const sdkDirectory = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? "/opt/android-sdk";
if (!existsSync(sdkDirectory)) {
  fail(`no se encuentra el SDK de Android en ${sdkDirectory}. Exporta ANDROID_HOME.`);
}

const javaCandidates = [
  process.env.JAVA_HOME,
  "/usr/lib/jvm/java-21-openjdk-amd64",
  "/usr/lib/jvm/java-17-openjdk-amd64"
].filter((candidate) => candidate && existsSync(join(candidate, "bin", "javac")));
if (javaCandidates.length === 0) {
  fail("no se encuentra un JDK 17-21 (Gradle no admite versiones superiores). Exporta JAVA_HOME.");
}
const javaHome = javaCandidates[0];

const ndkRoot = join(sdkDirectory, "ndk");
if (!existsSync(ndkRoot)) {
  fail(`no hay NDK instalado en ${ndkRoot}. Instala uno con sdkmanager.`);
}
const ndkVersions = (await readdir(ndkRoot)).sort((left, right) =>
  left.localeCompare(right, "en", { numeric: true })
);
const ndkHome = process.env.NDK_HOME ?? join(ndkRoot, ndkVersions.at(-1));
const toolchain = join(ndkHome, "toolchains", "llvm", "prebuilt", "linux-x86_64", "bin");
if (!existsSync(toolchain)) {
  fail(`no se encuentra el toolchain del NDK en ${toolchain}.`);
}

const cargoDirectory = join(homedir(), ".cargo", "bin");
const env = {
  ...process.env,
  ANDROID_HOME: sdkDirectory,
  ANDROID_SDK_ROOT: sdkDirectory,
  JAVA_HOME: javaHome,
  NDK_HOME: ndkHome,
  PATH: [
    cargoDirectory,
    join(javaHome, "bin"),
    join(sdkDirectory, "cmdline-tools", "latest", "bin"),
    join(sdkDirectory, "platform-tools"),
    toolchain,
    process.env.PATH ?? ""
  ].join(":"),
  CARGO_CFG_TARGET_OS: "android",
  [`CC_${target}_linux_android`]: join(toolchain, `${target}-linux-android24-clang`),
  [`AR_${target}_linux_android`]: join(toolchain, "llvm-ar"),
  [`CARGO_TARGET_${target.toUpperCase()}_LINUX_ANDROID_LINKER`]: join(
    toolchain,
    `${target}-linux-android24-clang`
  )
};

console.log(`build-mobile-apk: target ${target}, NDK ${ndkHome}, JDK ${javaHome}`);

const apkRoot = join(mobileDirectory, "src-tauri", "gen", "android", "app", "build", "outputs", "apk");
const jniLibsDirectory = join(
  mobileDirectory,
  "src-tauri",
  "gen",
  "android",
  "app",
  "src",
  "main",
  "jniLibs"
);
for (const stalePath of [jniLibsDirectory, apkRoot]) {
  if (existsSync(stalePath)) {
    await rm(stalePath, { recursive: true, force: true });
    console.log(`build-mobile-apk: limpio ${stalePath}`);
  }
}

const overridesDirectory = join(mobileDirectory, "android");
const generatedJavaDirectory = join(
  mobileDirectory,
  "src-tauri",
  "gen",
  "android",
  "app",
  "src",
  "main",
  "java"
);
if (existsSync(overridesDirectory)) {
  const generatedFiles = existsSync(generatedJavaDirectory)
    ? await readdir(generatedJavaDirectory, { recursive: true, encoding: "utf8" })
    : [];
  for (const name of (await readdir(overridesDirectory)).filter((entry) => entry.endsWith(".kt"))) {
    const matches = generatedFiles.filter((path) => path.endsWith(`/${name}`) || path === name);
    if (matches.length === 0) {
      fail(`no se encontró ${name} en el proyecto Android generado. Ejecuta tauri android init.`);
    }
    for (const match of matches) {
      await copyFile(join(overridesDirectory, name), join(generatedJavaDirectory, match));
      console.log(`build-mobile-apk: plantilla ${name} aplicada en ${match}`);
    }
  }
}

execFileSync("npm", ["run", "tauri", "--", "android", "build", "--debug", "--apk", "--target", target], {
  cwd: mobileDirectory,
  env,
  stdio: "inherit"
});

const candidates = existsSync(apkRoot)
  ? (await readdir(apkRoot, { recursive: true }))
      .filter((name) => name.endsWith(".apk"))
      .map((name) => join(apkRoot, name))
  : [];
if (candidates.length === 0) {
  fail(`Gradle terminó sin generar ningún APK en ${apkRoot}.`);
}
const built = await Promise.all(
  candidates.map(async (path) => ({ path, modified: (await stat(path)).mtimeMs }))
);
const apkPath = built.sort((left, right) => right.modified - left.modified)[0].path;

const version = JSON.parse(await readFile(join(mobileDirectory, "package.json"), "utf8")).version;
await mkdir(artifactsDirectory, { recursive: true });
const destination = join(
  artifactsDirectory,
  `deepseek-agent-mobile-${version}-${target}-debug.apk`
);
await copyFile(apkPath, destination);

const contents = await readFile(destination);
const sha256 = createHash("sha256").update(contents).digest("hex");
console.log(`build-mobile-apk: ${destination}`);
console.log(`build-mobile-apk: ${contents.length} bytes, sha256 ${sha256}`);
