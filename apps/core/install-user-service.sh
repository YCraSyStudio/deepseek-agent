#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"
npm run build:webview
install_dir="$HOME/.local/lib/ycrasy-agent"
unit_dir="$HOME/.config/systemd/user"
dotnet publish apps/core -c Release --no-self-contained -o "$install_dir"
dotnet publish apps/core/sshRelay -c Release --no-self-contained -o "$install_dir/relay"
mkdir -p "$install_dir/dist/webview" "$unit_dir"
cp -R dist/webview/. "$install_dir/dist/webview/"
install -m 0644 apps/core/systemd/ycrasy-agent.{service,socket} "$unit_dir/"
systemctl --user daemon-reload
systemctl --user enable --now ycrasy-agent.socket
systemctl --user try-restart ycrasy-agent.service
loginctl enable-linger "$(id -un)"
