# SPDX-License-Identifier: MIT
"""Entry point frozen into the YCraSy DeepSeek Agent SearXNG sidecar.

Runtime releases are immutable; publishing a rebuild requires a new runtime version.
"""

from searx.webapp import run


if __name__ == "__main__":
    run()
