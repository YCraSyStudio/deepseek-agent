import * as assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createExecutionPolicy } from "@/infrastructure/execution/ExecutionPolicy";
import { createSeatbeltProfile, createSeccompFilter } from "@/infrastructure/execution/UnixBackends";
import { createWindowsRequest, executeWindowsCommand } from "@/infrastructure/execution/WindowsBackend";

suite("sandbox execution policy", () => {
  let root: string;
  let project: string;
  setup(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ycrasy-policy-test-"));
    project = path.join(root, "project");
    await mkdir(project);
  });
  teardown(async () => {await rm(root, { recursive: true, force: true });});

  test("rejects outside cwd and overly broad toolchain mounts", async () => {
    await assert.rejects(createExecutionPolicy(project, root, root), /cwd must be inside/);
    await assert.rejects(createExecutionPolicy(project, project, root, [root]), /ancestor/);
    await assert.rejects(createExecutionPolicy(project, project, root, [path.parse(root).root]), /filesystem root/);
    await assert.rejects(createExecutionPolicy(project, project, root, ["relative"]), /absolute/);
  });

  test("finds nested secrets and agent controls and builds a fresh environment", async () => {
    await mkdir(path.join(project, "nested"));
    await mkdir(path.join(project, ".codex"));
    await writeFile(path.join(project, "nested", ".env.local"), "fixture");
    await writeFile(path.join(project, "nested", "private.key"), "fixture");
    await link(path.join(project, "nested", ".env.local"), path.join(project, "public.txt"));
    const policy = await createExecutionPolicy(project, project, root);
    assert.ok(policy.protectedPaths.includes(path.join(project, "public.txt")));
    assert.ok(policy.protectedPaths.includes(path.join(project, "nested", ".env.local")));
    assert.ok(policy.protectedPaths.includes(path.join(project, "nested", "private.key")));
    assert.ok(policy.protectedPaths.includes(path.join(project, ".codex")));
    assert.equal(policy.environment.OPENAI_API_KEY, undefined);
    assert.equal(policy.environment.SSH_AUTH_SOCK, undefined);
    assert.equal(policy.environment.NODE_OPTIONS, undefined);
    assert.equal(policy.environment.HOME, path.join(root, "home"));
  });

  test("Seatbelt escapes paths and denies network and protected files", async () => {
    const policy = await createExecutionPolicy(project, project, root);
    policy.protectedPaths = [path.join(project, 'a"b\\c')];
    const profile = createSeatbeltProfile(policy);
    assert.ok(profile.includes("(deny default)"));
    assert.ok(profile.includes("(deny network*)"));
    assert.ok(profile.includes(`(deny file-read* file-write* (subpath ${JSON.stringify(policy.protectedPaths[0])}))`));
    assert.ok(!profile.includes("allow network"));
  });

  test("Windows uses explicit MXC containment and no inherited environment or network", async () => {
    const policy = await createExecutionPolicy(project, project, root);
    policy.environment.ComSpec = "C:\\Windows\\System32\\cmd.exe";
    const request = createWindowsRequest('echo "fixture"', policy, 1500);
    assert.equal(request.containment?.type, "processcontainer");
    assert.equal(request.inheritDefaultEnvironment, false);
    assert.equal(request.network?.egress?.default, "deny");
    assert.equal(request.network?.ingress?.hostLoopback, "deny");
    assert.equal(request.timeoutMs, 1500);
    assert.equal(request.ui?.clipboard, "none");
    assert.deepEqual(request.filesystem?.readwritePaths, [policy.workspaceRoot, root]);
    assert.equal(request.filesystem?.clearPolicyOnExit, true);
  });

  test("Windows refuses missing or weaker backends without spawning a command", async () => {
    const policy = await createExecutionPolicy(project, project, root);
    const options = { cwd: policy.cwd, workspaceRoot: policy.workspaceRoot, timeoutMs: 1000, maxOutputBytes: 4096 };
    let spawns = 0;
    const weakSdk = {
      getAvailableBackends: () => [{ backend: "processcontainer" as const, tier: "appcontainer-dacl" as const, capabilities: [], warnings: [] }],
      probe: () => {throw new Error("probe must not run for a rejected backend");},
      spawn: async () => {spawns++; throw new Error("must not spawn");},
    };
    await assert.rejects(executeWindowsCommand("echo blocked", policy, options, undefined, async () => weakSdk), /sandbox_unavailable/);
    assert.equal(spawns, 0);
    const strongSdk = {
      ...weakSdk,
      getAvailableBackends: () => [{ backend: "processcontainer" as const, tier: "base-container" as const, capabilities: ["filesystemDeniedPaths" as const], warnings: [] }],
      probe: () => ({ tier: "appcontainer-dacl" as const, needsDaclAugmentation: true, warnings: [], probes: {} as ReturnType<typeof import("@microsoft/mxc-sdk/v1").probe>["probes"] }),
    };
    await assert.rejects(executeWindowsCommand("echo blocked", policy, options, undefined, async () => strongSdk), /ACL augmentation/);
    assert.equal(spawns, 0);
  });

  test("seccomp validates architecture and denies sockets on supported ABIs", () => {
    for (const [architecture, audit, socket] of [["x64", 0xc000003e, 41], ["arm64", 0xc00000b7, 198]] as const) {
      const filter = createSeccompFilter(architecture);
      assert.equal(filter.readUInt32LE(12), audit);
      const values = Array.from({ length: filter.length / 8 }, (_, index) => filter.readUInt32LE(index * 8 + 4));
      assert.ok(values.includes(socket));
      assert.ok(values.includes(0x00050001));
    }
    assert.throws(() => createSeccompFilter("ia32"), /not implemented/);
  });
});
