import * as assert from "node:assert";
import { normalizeCommandForDecision, parseCommandFacts } from "@/infrastructure/tools/safety/CommandFacts";

suite("deterministic command facts", () => {
  test("recognizes a chained version diagnostic", () => {
    const facts = parseCommandFacts("dotnet --version && node --version && npm --version");
    assert.strictEqual(facts.classification, "read-only-diagnostic");
    assert.deepStrictEqual(facts.programs, ["dotnet", "node", "npm"]);
  });

  test("recognizes semicolon chains and availability queries", () => {
    assert.strictEqual(parseCommandFacts("git --version; git --help").classification, "read-only-diagnostic");
    assert.strictEqual(parseCommandFacts("where node").classification, "read-only-diagnostic");
    assert.strictEqual(parseCommandFacts("which npm").classification, "read-only-diagnostic");
    assert.strictEqual(parseCommandFacts("command -v node").classification, "read-only-diagnostic");
  });

  test("does not treat a compound mutation as a read-only diagnostic", () => {
    for (const command of [
      "npm --version && rm -rf dist",
      "node --version; git status",
      "rm -rf build",
      "npm --version | tee log.txt",
      "npm --version > log.txt",
      'node -e "require(`fs`).rmSync(`x`)"',
      "npm run build",
    ]) {
      assert.notStrictEqual(parseCommandFacts(command).classification, "read-only-diagnostic", command);
    }
  });

  test("keeps cmd, PowerShell, and POSIX quoting from widening a diagnostic", () => {
    assert.strictEqual(parseCommandFacts('"node" --version').classification, "read-only-diagnostic");
    assert.strictEqual(parseCommandFacts("node '--version'").classification, "read-only-diagnostic");
    assert.notStrictEqual(parseCommandFacts('cmd /c "rmdir /s /q build"').classification, "read-only-diagnostic");
    assert.notStrictEqual(parseCommandFacts('powershell -Command "Remove-Item -Recurse -Force ."').classification, "read-only-diagnostic");
  });

  test("detects a finite workspace script run", () => {
    const facts = parseCommandFacts("powershell -NoProfile -ExecutionPolicy Bypass -File test-api.ps1");
    assert.strictEqual(facts.classification, "script-execution");
    assert.strictEqual(facts.script?.path, "test-api.ps1");
    assert.strictEqual(facts.script?.language, "powershell");
    assert.strictEqual(facts.processScopedPolicyBypass, true);
    assert.strictEqual(facts.changesExecutionPolicy, false);
    assert.strictEqual(facts.escalatesPrivileges, false);
  });

  test("detects POSIX and Node script operands", () => {
    assert.strictEqual(parseCommandFacts("bash deploy.sh").script?.language, "shell");
    assert.strictEqual(parseCommandFacts("python3 ./tools/build.py").script?.language, "python");
    assert.strictEqual(parseCommandFacts("node scripts/check.js").script?.language, "javascript");
    assert.strictEqual(parseCommandFacts("bash -c 'rm -rf /'").classification, "unknown");
    assert.strictEqual(parseCommandFacts("node -e 'process.exit(0)'").classification, "unknown");
  });

  test("separates process-scoped execution policy from a machine policy change", () => {
    assert.strictEqual(parseCommandFacts("powershell -ExecutionPolicy Bypass -File run.ps1").changesExecutionPolicy, false);
    assert.strictEqual(parseCommandFacts("Set-ExecutionPolicy Unrestricted").changesExecutionPolicy, true);
    assert.strictEqual(parseCommandFacts("Set-ExecutionPolicy -Scope Process Bypass").changesExecutionPolicy, false);
    assert.strictEqual(parseCommandFacts("Set-ExecutionPolicy -Scope LocalMachine Bypass").changesExecutionPolicy, true);
  });

  test("flags privilege escalation", () => {
    assert.strictEqual(parseCommandFacts("sudo apt-get install -y curl").escalatesPrivileges, true);
    assert.strictEqual(parseCommandFacts("Start-Process powershell -Verb RunAs").escalatesPrivileges, true);
    assert.strictEqual(parseCommandFacts("npm run build").escalatesPrivileges, false);
  });

  test("never classifies an empty or shell-expanded command", () => {
    for (const command of ["", "   ", "node --version $(whoami)", "npm run build && echo $HOME", "node --version%"]) {
      assert.strictEqual(parseCommandFacts(command).classification, "unknown", command);
    }
  });

  test("normalizes command text for decision keys", () => {
    assert.strictEqual(normalizeCommandForDecision("  npm   --version \n"), "npm --version");
  });
});
