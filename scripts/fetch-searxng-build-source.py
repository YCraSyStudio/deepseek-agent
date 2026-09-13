#!/usr/bin/env python3
"""Fetch the pinned SearXNG source without materializing Windows-invalid paths."""

from __future__ import annotations

import argparse
import io
import shutil
import tarfile
import urllib.request
from pathlib import Path, PurePosixPath

EXPECTED_COMMIT = "9fea41204fdfa7a5cfa15b0ebd12904c520478ce"
VERSION_STRING = "2026.8.22+9fea41204"
ROOT_FILES = {"setup.py", "requirements.txt", "requirements-dev.txt", "README.rst", "LICENSE"}


def selected(relative: PurePosixPath) -> bool:
    text = relative.as_posix()
    return text in ROOT_FILES or text.startswith("searx/")


def apply_portability_patches(output: Path) -> None:
    """Keep the pinned source runnable on Windows without changing Linux/macOS behavior."""
    valkeydb = output / "searx" / "valkeydb.py"
    text = valkeydb.read_text(encoding="utf-8")

    import_block = "import os\nimport pwd\nimport logging\n"
    portable_import_block = (
        "import os\n"
        "try:\n"
        "    import pwd\n"
        "except ImportError:  # Windows has no pwd module\n"
        "    pwd = None\n"
        "import logging\n"
    )
    if import_block not in text:
        raise RuntimeError("Pinned SearXNG valkeydb.py no longer matches the expected import block")
    text = text.replace(import_block, portable_import_block, 1)

    error_block = (
        "        _CLIENT = None\n"
        "        _pw = pwd.getpwuid(os.getuid())\n"
        "        logger.exception(\"[%s (%s)] can't connect valkey DB ...\", _pw.pw_name, _pw.pw_uid)\n"
    )
    portable_error_block = (
        "        _CLIENT = None\n"
        "        if pwd is not None and hasattr(os, 'getuid'):\n"
        "            _pw = pwd.getpwuid(os.getuid())\n"
        "            logger.exception(\"[%s (%s)] can't connect valkey DB ...\", _pw.pw_name, _pw.pw_uid)\n"
        "        else:\n"
        "            logger.exception(\"can't connect valkey DB ...\")\n"
    )
    if error_block not in text:
        raise RuntimeError("Pinned SearXNG valkeydb.py no longer matches the expected error block")
    valkeydb.write_text(text.replace(error_block, portable_error_block, 1), encoding="utf-8")

    (output / "DEEPSEEK-AGENT-PATCHES.txt").write_text(
        "YCraSy DeepSeek Agent portability patch\n"
        "==================================\n\n"
        "The pinned SearXNG source is unmodified except for searx/valkeydb.py, where the Unix-only\n"
        "pwd module is made optional so the standalone sidecar can start on Windows. Linux and macOS\n"
        "behavior is unchanged. The patch also preserves safe error logging if Valkey is configured.\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("commit")
    parser.add_argument("output_directory", type=Path)
    args = parser.parse_args()
    if args.commit != EXPECTED_COMMIT:
        raise RuntimeError(f"Unexpected SearXNG revision: {args.commit}")

    output = args.output_directory.resolve()
    shutil.rmtree(output, ignore_errors=True)
    output.mkdir(parents=True, exist_ok=True)
    url = f"https://github.com/searxng/searxng/archive/{args.commit}.tar.gz"
    request = urllib.request.Request(url, headers={"User-Agent": "deepseek-agent-runtime-builder"})
    with urllib.request.urlopen(request, timeout=60) as response:
        archive_bytes = response.read()
    if len(archive_bytes) > 64 * 1024 * 1024:
        raise RuntimeError("SearXNG source archive is unexpectedly large")

    with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:gz") as archive:
        for member in archive.getmembers():
            parts = PurePosixPath(member.name).parts
            if len(parts) < 2:
                continue
            relative = PurePosixPath(*parts[1:])
            if not selected(relative):
                continue
            target = output.joinpath(*relative.parts).resolve()
            if output not in target.parents and target != output:
                raise RuntimeError(f"Unsafe SearXNG archive path: {member.name}")
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            if not member.isfile():
                continue
            source = archive.extractfile(member)
            if source is None:
                raise RuntimeError(f"Unable to extract {member.name}")
            target.parent.mkdir(parents=True, exist_ok=True)
            with source, target.open("wb") as destination:
                shutil.copyfileobj(source, destination)

    required = [output / name for name in ROOT_FILES] + [output / "searx" / "webapp.py"]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise RuntimeError(f"Pinned SearXNG archive is missing required files: {missing}")

    apply_portability_patches(output)
    (output / ".deepseek-agent-searxng-commit").write_text(f"{args.commit}\n", encoding="utf-8")
    (output / "searx" / "version_frozen.py").write_text(
        "# SPDX-License-Identifier: AGPL-3.0-or-later\n"
        f'VERSION_STRING = "{VERSION_STRING}"\n'
        f'VERSION_TAG = "{VERSION_STRING}"\n'
        f'DOCKER_TAG = "{VERSION_STRING.replace("+", "-")}"\n'
        'GIT_URL = "https://github.com/searxng/searxng"\n'
        'GIT_BRANCH = "master"\n',
        encoding="utf-8",
    )
    print(f"Prepared SearXNG {args.commit} in {output}")


if __name__ == "__main__":
    main()
