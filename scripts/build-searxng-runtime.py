#!/usr/bin/env python3
"""Build and smoke-test a one-file SearXNG runtime for the current host."""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
RUNTIME_VERSION = "2026.08.22-9fea41204-v2"
EXPECTED_COMMIT = "9fea41204fdfa7a5cfa15b0ebd12904c520478ce"


def runtime_platform_key() -> str:
    machine = platform.machine().lower()
    arch = "x64" if machine in {"x86_64", "amd64"} else "arm64" if machine in {"aarch64", "arm64"} else machine
    system = {"linux": "linux", "win32": "win32", "darwin": "darwin"}.get(sys.platform)
    if system is None or arch not in {"x64", "arm64"}:
        raise RuntimeError(f"Unsupported runtime platform: {sys.platform}-{machine}")
    return f"{system}-{arch}"


def run(*args: str, cwd: Path | None = None) -> None:
    subprocess.run(list(args), cwd=cwd, check=True)


def verify_source(source: Path) -> str:
    marker = source / ".deepseek-agent-searxng-commit"
    if not marker.is_file():
        raise RuntimeError(f"Pinned source marker is missing: {marker}")
    commit = marker.read_text(encoding="utf-8").strip()
    if commit != EXPECTED_COMMIT:
        raise RuntimeError(f"Expected SearXNG {EXPECTED_COMMIT}, got {commit}")
    return commit


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def settings_yaml(port: int) -> str:
    return f'''use_default_settings: true

general:
  debug: false
  instance_name: "YCraSy DeepSeek Agent Search"
  enable_metrics: false

search:
  safe_search: 0
  autocomplete: ""
  formats:
    - json

server:
  bind_address: "127.0.0.1"
  port: {port}
  secret_key: "deepseek-agent-runtime-smoke-test-secret"
  limiter: false
  public_instance: false
  image_proxy: false

outgoing:
  request_timeout: 4.0
  max_request_timeout: 8.0
'''


def smoke_test(executable: Path) -> None:
    port = free_port()
    # Windows can retain a short-lived lock on redirected log handles after the
    # process exits. The smoke test result must not be turned into a failure by
    # best-effort cleanup of the temporary directory.
    with tempfile.TemporaryDirectory(prefix="deepseek-agent-searxng-", ignore_cleanup_errors=True) as temporary:
        temp = Path(temporary)
        settings = temp / "settings.yml"
        cache = temp / "cache"
        cache.mkdir(parents=True)
        settings.write_text(settings_yaml(port), encoding="utf-8")
        env = os.environ.copy()
        env["SEARXNG_SETTINGS_PATH"] = str(settings)
        env["XDG_CACHE_HOME"] = str(cache)
        env["PYTHONUNBUFFERED"] = "1"
        log_path = temp / "runtime.log"
        with log_path.open("w+", encoding="utf-8") as log:
            process = subprocess.Popen([str(executable)], env=env, stdout=log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 120
                url = f"http://127.0.0.1:{port}/config"
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        break
                    try:
                        with urllib.request.urlopen(url, timeout=2) as response:
                            payload = json.loads(response.read().decode("utf-8"))
                        if payload.get("instance_name") == "YCraSy DeepSeek Agent Search":
                            print(f"SearXNG runtime smoke test passed at {url}")
                            return
                    except Exception:
                        time.sleep(0.5)
                log.flush()
                log.seek(0)
                details = log.read()[-12000:]
                raise RuntimeError(f"SearXNG runtime did not become ready (exit={process.poll()}).\n{details}")
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("searxng_source", type=Path)
    parser.add_argument("output_directory", type=Path)
    args = parser.parse_args()
    source = args.searxng_source.resolve()
    output = args.output_directory.resolve()
    commit = verify_source(source)

    key = runtime_platform_key()
    asset_name = f"searxng-runtime-{key}{'.exe' if sys.platform == 'win32' else ''}"
    build_root = PROJECT_ROOT / ".tmp" / "searxng-runtime" / key
    shutil.rmtree(build_root, ignore_errors=True)
    output.mkdir(parents=True, exist_ok=True)

    run(
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name",
        asset_name.removesuffix(".exe"),
        "--distpath",
        str(output),
        "--workpath",
        str(build_root / "work"),
        "--specpath",
        str(build_root / "spec"),
        "--paths",
        str(source),
        "--collect-all",
        "searx",
        str(PROJECT_ROOT / "scripts" / "searxng-runtime-entry.py"),
        cwd=PROJECT_ROOT,
    )

    executable = output / asset_name
    if not executable.is_file():
        raise RuntimeError(f"PyInstaller output missing: {executable}")
    if sys.platform != "win32":
        executable.chmod(0o755)
    if sys.platform == "darwin":
        run("codesign", "--force", "--deep", "--sign", "-", str(executable))

    smoke_test(executable)
    print(json.dumps({
        "runtime_version": RUNTIME_VERSION,
        "searxng_commit": commit,
        "platform_key": key,
        "asset": asset_name,
        "python_version": platform.python_version(),
        "size": executable.stat().st_size,
    }, indent=2))


if __name__ == "__main__":
    main()
