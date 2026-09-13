#!/usr/bin/env bash
#
# Packages the extension as artifacts/deepseek-agent-<version>.vsix.
#
# Usage:
#   ./generate-vsix.sh                 type-check, lint, build, package, verify
#   ./generate-vsix.sh --with-tests    also run the unit + integration suites first
#   ./generate-vsix.sh --skip-checks   package the current sources without compile/lint
#
set -euo pipefail

usage() {
  grep '^#' "${BASH_SOURCE[0]}" | sed -n '2,9p' | cut -c 3-
}

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$project_root"

run_checks=1
run_tests=0
for argument in "$@"; do
  case "$argument" in
    --skip-checks) run_checks=0 ;;
    --with-tests) run_tests=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $argument" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ ! -d node_modules ]; then
  echo "node_modules is missing; run 'pnpm install' first." >&2
  exit 1
fi

version="$(node -p "require('./package.json').version")"
vsix_path="artifacts/deepseek-agent-${version}.vsix"

# vsce builds the VSIX from dist/, so the bundles must be regenerated first.
if [ "$run_checks" -eq 1 ]; then
  echo "==> Type-check"
  pnpm run compile
  echo "==> Lint"
  pnpm run lint
fi

if [ "$run_tests" -eq 1 ]; then
  echo "==> Tests"
  pnpm test
fi

echo "==> Build extension and webview bundles"
pnpm run build

# package:vsix clears stale VSIX files from artifacts/ before packaging this version.
echo "==> Package ${vsix_path}"
pnpm run package:vsix

echo "==> Verify VSIX contents"
pnpm run verify:vsix

echo "Generated ${vsix_path} ($(du -h "$vsix_path" | cut -f1))"
