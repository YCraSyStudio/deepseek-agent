# Agent service migration

The per-account ASP.NET Core runtime serves the React webview, manages encrypted
provider credentials and streams text chat. The VS Code extension still hosts
its editor tools and orchestration.

## Build artifacts

Run `./build.sh all` to publish the ASP.NET host, package the VSIX, and build
the Android APK. Use `core`, `vsix`, or `apk` to build just one component.
The core command publishes to `artifacts/core/` and does not install a service.

## Android connection

Install the per-user service below and enable OpenSSH on the PC. In the MAUI
app, enter the host, SSH user and password or private key. OpenSSH certificates
and key passphrases are supported. Verify the host fingerprint on first use.
The app starts a short-lived relay over the authenticated SSH session. Its
loopback port is assigned for that connection and SSH forwarding must be
enabled. The relay connects to the account's private backend socket. The
text chat can run with VS Code closed. Workspace file editing and agent tool
calls have not yet moved to this runtime.

Build the Android client with the .NET 10 SDK, the MAUI Android workload,
Android SDK and JDK 21. Restore the workload as the user who will build the
APK when the .NET SDK stores workloads per user:

```sh
dotnet workload restore apps/android
./build.sh apk
```

The script writes the signed debug APK to `artifacts/`. It targets ARM64 by default. Use `--target x86_64` for an x64 emulator.

## Per-user .NET runtime and credential import

On a Linux host with .NET 10 and user-scoped systemd credentials, run
`apps/core/install-user-service.sh` as the account that will own the agent.
The installer publishes the runtime and webview, enables a private socket at
`/run/user/<uid>/ycrasy-agent.sock`, and enables lingering so systemd can
activate the backend before graphical login. Check the installation locally:

```sh
curl --unix-socket "/run/user/$(id -u)/ycrasy-agent.sock" http://localhost/health
```

Starting with version 0.1.17, installing or updating the extension schedules
credential migration at VS Code startup, without opening the chat. The extension
imports saved SecretStorage credentials by provider origin. Pending entries are
retried on the next activation. The runtime
verifies decryption before acknowledging the import. A different existing
backend key causes a conflict and leaves both credentials intact. On success
the extension records backend ownership, removes its old entry and uses the
backend for subsequent reads and changes. An unavailable managed backend
causes an error. Each provider origin has a separate host-bound, user-scoped
systemd credential.
