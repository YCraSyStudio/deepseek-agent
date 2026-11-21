#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'HELP'
Usage: ./build.sh [all|core|vsix|apk] [options]

  all   Build all three artifacts (default).
  core  Publish the ASP.NET host to artifacts/core/.
  vsix  Package and verify the VS Code extension.
  apk   Build the signed MAUI Android debug APK.

  --target aarch64|arm64|arm|x86|x86_64  APK architecture (default: aarch64).
  --skip-checks                         Skip VSIX compilation checks and lint.
  --with-tests                          Run the VSIX unit and integration tests.
HELP
}

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$project_root"

mode="all"
case "${1:-}" in
  all|core|vsix|apk) mode="$1"; shift ;;
esac

run_checks=1
run_tests=0
target="aarch64"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-checks) run_checks=0 ;;
    --with-tests) run_tests=1 ;;
    --target)
      if [ "$#" -lt 2 ]; then
        usage >&2
        exit 2
      fi
      target="$2"
      shift
      ;;
    --target=*) target="${1#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown build command or option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

case "$target" in
  aarch64|arm64) target="aarch64"; rid="android-arm64" ;;
  arm) rid="android-arm" ;;
  x86) rid="android-x86" ;;
  x86_64) rid="android-x64" ;;
  *) printf 'Unsupported Android architecture: %s\n' "$target" >&2; exit 2 ;;
esac

if [[ "$mode" != vsix ]] && ! command -v dotnet >/dev/null; then
  printf 'Install the .NET 10 SDK before building the core or APK.\n' >&2
  exit 1
fi

build_core() {
  npm run build:webview
  dotnet publish apps/core/YCraSy.Agent.Runtime.csproj \
    --configuration Release --self-contained false --output artifacts/core
  dotnet publish apps/core/sshRelay --configuration Release --self-contained false --output artifacts/core/relay
  mkdir -p artifacts/core/dist/webview
  cp -R dist/webview/. artifacts/core/dist/webview/
  printf 'Published the ASP.NET host to artifacts/core/\n'
}

build_vsix() {
  if [ ! -d node_modules ]; then
    printf "node_modules is missing; run 'npm ci' first.\n" >&2
    return 1
  fi

  if [ "$run_checks" -eq 1 ]; then
    npm run compile
    npm run lint
  fi
  if [ "$run_tests" -eq 1 ]; then
    npm test
  fi

  npm run package:vsix
  npm run verify:vsix
}

build_apk() (
  local project="apps/android/YCraSy.Agent.Android.csproj"
  local staging apk_path

  local workloads
  workloads="$(dotnet workload list)"
  if [[ ! "$workloads" =~ (^|[[:space:]])maui-android([[:space:]]|$) ]]; then
    printf 'Missing .NET workload: maui-android. Run this command on one line:\n' >&2
    printf '  dotnet workload restore %s\n' "$project" >&2
    printf 'Run the restore as your build user. SDKs that require system writes may need elevation.\n' >&2
    exit 1
  fi
  if [ -z "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ] && [ -d /opt/android-sdk ]; then
    export ANDROID_HOME=/opt/android-sdk
  fi

  if [ -z "${JAVA_HOME:-}" ]; then
    local jdk
    for jdk in /usr/lib/jvm/java-21-openjdk /usr/lib/jvm/java-21-openjdk-*; do
      if [ -x "$jdk/bin/javac" ]; then
        export JAVA_HOME="$jdk"
        break
      fi
    done
  fi

  staging="$(mktemp -d)"
  trap 'rm -rf -- "$staging"' EXIT

  dotnet publish "$project" --configuration Debug --framework net10.0-android \
    --runtime "$rid" --output "$staging" -p:AndroidPackageFormats=apk -p:EmbedAssembliesIntoApk=true

  shopt -s nullglob
  signed_packages=("$staging"/*-Signed.apk)
  if [ "${#signed_packages[@]}" -ne 1 ]; then
    printf 'Expected one signed APK, found %s.\n' "${#signed_packages[@]}" >&2
    exit 1
  fi

  local version
  version="$(dotnet msbuild "$project" -nologo -getProperty:ApplicationDisplayVersion)"
  apk_path="artifacts/deepseek-agent-maui-${version}-${target}-debug.apk"
  mkdir -p artifacts
  install -m 0644 "${signed_packages[0]}" "$apk_path"
  printf 'Generated %s\n' "$apk_path"
)

case "$mode" in
  all) build_core; build_vsix; build_apk ;;
  core) build_core ;;
  vsix) build_vsix ;;
  apk) build_apk ;;
esac
