import * as assert from "node:assert";
import { redactDiagnostic } from "@/shared/logging/Logger";
import { redactSensitiveText } from "@/shared/security/Redaction";

suite("credential redaction", () => {
  test("redacts authorization headers and key-like values", () => {
    const secret = "sk-abcdefghijklmnopqrstuvwxyz";
    const diagnostic = redactDiagnostic(
      `Authorization: Bearer ${secret}`,
      new Error(`request failed with apiKey=${secret}`),
    );

    assert.strictEqual(diagnostic.includes(secret), false);
    assert.match(diagnostic, /\[REDACTED\]/);
    assert.strictEqual(redactSensitiveText(`token: "${secret}"`).includes(secret), false);
    assert.strictEqual(redactSensitiveText('{"apiKey":"opaque-credential"}').includes("opaque-credential"), false);
    assert.strictEqual(redactSensitiveText("invalid api key opaque-credential").includes("opaque-credential"), false);
  });

  test("redacts an explicitly supplied opaque credential", () => {
    assert.strictEqual(
      redactSensitiveText("server echoed opaque-value-123", ["opaque-value-123"]),
      "server echoed [REDACTED]",
    );
  });
});
