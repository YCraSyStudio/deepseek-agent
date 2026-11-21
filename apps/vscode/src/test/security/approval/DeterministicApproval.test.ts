import * as assert from "node:assert";
import { parseCommandFacts } from "@/infrastructure/tools/safety/CommandFacts";
import {
  approveReadOnlyDiagnostic,
  approveVerifiedWorkspaceScript,
  approveWorkspaceFileMutation,
  approveGitRecoverablePathChange,
  type GitRecoverablePathFacts,
} from "@/infrastructure/tools/safety/DeterministicApproval";
import { createDecisionKey, isCacheableScope, PositiveDecisionCache } from "@/infrastructure/tools/safety/DecisionCache";

const BOUNDED_PROFILE = { bounded: true, capabilities: ["http-localhost"], blockedBy: [] };
const UNBOUNDED_PROFILE = { bounded: false, capabilities: [], blockedBy: ["non-local-network"] };

suite("deterministic approval rules", () => {
  test("approves Git-backed path changes only with a known nonsensitive recoverable path", () => {
    const base: GitRecoverablePathFacts = { toolName: "delete_path", effect: "workspace-mutation", filePath: "src/old.ts", sensitivePath: false, insideRepository: true, recoverable: true, reason: "tracked-clean" };
    for (const toolName of ["delete_path", "move_path"]) {
      const verdict = approveGitRecoverablePathChange({ ...base, toolName });
      assert.strictEqual(verdict.kind, "approve"); assert.strictEqual(verdict.code, "git-recoverable-path-change");
      assert.strictEqual(verdict.facts.gitReason, "tracked-clean"); assert.strictEqual(verdict.facts.filePath, base.filePath);
    }
    const cases: Array<[Partial<GitRecoverablePathFacts>, string]> = [
      [{ toolName: "edit_file" }, "not-a-path-change-tool"],
      [{ effect: "external-effect" }, "unexpected-effect"],
      [{ filePath: undefined }, "path-unknown"],
      [{ sensitivePath: true }, "sensitive-path"],
      [{ insideRepository: false, reason: "outside-repository" }, "git-outside-repository"],
      [{ recoverable: false, reason: "untracked" }, "git-untracked"],
    ];
    for (const [patch, code] of cases) {
      const verdict = approveGitRecoverablePathChange({ ...base, ...patch });
      assert.strictEqual(verdict.kind, "review"); assert.strictEqual(verdict.code, code);
    }
  });
  test("requires review for tools outside the file mutation allowlist", () => {
    const facts = { toolName: "run_terminal_command", effect: "workspace-mutation", workspaceContained: true, filePath: "src/app.ts", sensitivePath: false };
    const verdict = approveWorkspaceFileMutation(facts);
    assert.strictEqual(verdict.kind, "review");
    assert.strictEqual(verdict.code, "not-a-file-mutation");
    assert.deepStrictEqual(verdict.facts, { ...facts, reasonCode: undefined });
  });
  for (const flag of ["escalatesPrivileges", "changesExecutionPolicy"] as const) {
    test(`requires review even for diagnostic/script classifications when ${flag} is present`, () => {
      const diagnostic = { ...parseCommandFacts("node --version"), [flag]: true };
      const code = flag === "escalatesPrivileges" ? "privilege-escalation" : "execution-policy-change";
      assert.strictEqual(approveReadOnlyDiagnostic(diagnostic).kind, "review");
      assert.strictEqual(approveReadOnlyDiagnostic(diagnostic).code, code);
      const script = { ...parseCommandFacts("node test-api.js"), [flag]: true };
      const verdict = approveVerifiedWorkspaceScript({ facts: script, contained: true, provenance: "agent-authored", profile: BOUNDED_PROFILE, hash: "fixture" });
      assert.strictEqual(verdict.kind, "review"); assert.strictEqual(verdict.code, code);
      assert.strictEqual(verdict.facts.hash, "fixture");
    });
  }
  test("approves a workspace-contained file mutation", () => {
    const verdict = approveWorkspaceFileMutation({
      toolName: "edit_file",
      effect: "workspace-mutation",
      workspaceContained: true,
      filePath: "src/app.ts",
      sensitivePath: false,
    });
    assert.strictEqual(verdict.kind, "approve");
  });

  test("keeps file mutations outside the workspace in review", () => {
    for (const facts of [
      { workspaceContained: true, reasonCode: "outside-workspace", filePath: "src/app.ts" },
      { workspaceContained: undefined, reasonCode: undefined, filePath: "src/app.ts" },
      { workspaceContained: true, reasonCode: undefined, filePath: undefined },
      { workspaceContained: true, reasonCode: undefined, filePath: "src/app.ts", sensitivePath: true },
      { workspaceContained: true, reasonCode: undefined, filePath: "src/app.ts", effect: "external-effect" },
    ]) {
      const verdict = approveWorkspaceFileMutation({
        toolName: "edit_file",
        effect: "workspace-mutation",
        sensitivePath: false,
        ...facts,
      });
      assert.strictEqual(verdict.kind, "review", JSON.stringify(facts));
    }
  });

  test("approves only finite version and help diagnostics", () => {
    assert.strictEqual(approveReadOnlyDiagnostic(parseCommandFacts("dotnet --version && npm --version")).kind, "approve");
    assert.strictEqual(approveReadOnlyDiagnostic(parseCommandFacts("rm -rf dist")).kind, "review");
    assert.strictEqual(approveReadOnlyDiagnostic(parseCommandFacts("Set-ExecutionPolicy Unrestricted")).kind, "review");
    assert.strictEqual(approveReadOnlyDiagnostic(parseCommandFacts("sudo node --version")).kind, "review");
  });

  test("runs a workspace script unattended only with every fact verified", () => {
    const facts = parseCommandFacts("powershell -NoProfile -ExecutionPolicy Bypass -File test-api.ps1");
    const approved = approveVerifiedWorkspaceScript({
      facts,
      contained: true,
      provenance: "agent-authored",
      profile: BOUNDED_PROFILE,
      hash: "abc",
    });
    assert.strictEqual(approved.kind, "approve");

    const blockedCases = [
      { contained: false, provenance: "agent-authored", profile: BOUNDED_PROFILE },
      { contained: true, provenance: "changed", profile: BOUNDED_PROFILE },
      { contained: true, provenance: "unknown", profile: BOUNDED_PROFILE },
      { contained: true, provenance: "agent-authored", profile: UNBOUNDED_PROFILE },
    ] as const;
    for (const blocked of blockedCases) {
      const verdict = approveVerifiedWorkspaceScript({
        facts,
        contained: blocked.contained,
        provenance: blocked.provenance,
        profile: blocked.profile,
      });
      assert.strictEqual(verdict.kind, "review", JSON.stringify(blocked));
    }

    const escalated = parseCommandFacts("powershell -File test-api.ps1 ; Set-ExecutionPolicy Unrestricted");
    assert.strictEqual(
      approveVerifiedWorkspaceScript({
        facts: escalated,
        contained: true,
        provenance: "agent-authored",
        profile: BOUNDED_PROFILE,
      }).kind,
      "review",
    );
  });
});

suite("positive decision cache", () => {
  const scope = { conversationId: "c1", workspaceId: "ws:1", permissionFingerprint: "fp1" };

  test("requires conversation, workspace, and permission fingerprint to cache", () => {
    assert.strictEqual(isCacheableScope(scope), true);
    assert.strictEqual(isCacheableScope({ workspaceId: "ws:1", permissionFingerprint: "fp1" }), false);
    assert.strictEqual(isCacheableScope({ conversationId: "c1", permissionFingerprint: "fp1" }), false);
    assert.strictEqual(isCacheableScope({ conversationId: "c1", workspaceId: "ws:1" }), false);
  });

  test("changes the key when any justifying fact changes", () => {
    const base = createDecisionKey({ ...scope, toolName: "run_terminal_command", subject: "npm test", contentHash: "h1" });
    assert.strictEqual(
      base,
      createDecisionKey({ ...scope, toolName: "run_terminal_command", subject: "npm test", contentHash: "h1" }),
    );
    assert.notStrictEqual(base, createDecisionKey({ ...scope, toolName: "run_terminal_command", subject: "npm test", contentHash: "h2" }));
    assert.notStrictEqual(base, createDecisionKey({ ...scope, toolName: "run_terminal_command", subject: "npm run test", contentHash: "h1" }));
    assert.notStrictEqual(base, createDecisionKey({ ...scope, conversationId: "c2", toolName: "run_terminal_command", subject: "npm test", contentHash: "h1" }));
    assert.notStrictEqual(base, createDecisionKey({ ...scope, permissionFingerprint: "fp2", toolName: "run_terminal_command", subject: "npm test", contentHash: "h1" }));
  });

  test("evicts the oldest decision beyond its bound", () => {
    const cache = new PositiveDecisionCache(2);
    cache.remember("a");
    cache.remember("b");
    cache.remember("c");
    assert.strictEqual(cache.size, 2);
    assert.strictEqual(cache.has("a"), false);
    assert.strictEqual(cache.has("c"), true);
    cache.clear();
    assert.strictEqual(cache.size, 0);
  });
});
