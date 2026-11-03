import * as assert from "node:assert";
import { redactToolOutput } from "@/shared/security/ToolOutputRedaction";

suite("tool output credential redaction", () => {
  test("preserves terminal structure, paths, exit status, and numeric token counts", () => {
    const result = JSON.parse(redactToolOutput(JSON.stringify({
      kind: "command_result", cwd: "/home/person/project", exitCode: 1,
      stdout: "Authorization: Bearer private-value\npassword=private-password",
      nested: { api_key: "private-key", token: 42 },
    })));
    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(result.cwd, "/home/person/project");
    assert.strictEqual(result.nested.token, 42);
    assert.strictEqual(result.nested.api_key, "[REDACTED]");
    assert.ok(!JSON.stringify(result).includes("private-"));
  });
});
