import * as assert from "node:assert";
import {
  getApiOrigin,
  isAllowedApiBaseUrl,
  normalizeApiBaseUrl,
} from "@/shared/security/ApiOrigin";

suite("API origin security", () => {
  test("accepts HTTPS and normalizes only the base path", () => {
    assert.strictEqual(normalizeApiBaseUrl("https://api.deepseek.com/v1///"), "https://api.deepseek.com/v1");
    assert.strictEqual(isAllowedApiBaseUrl("https://example.test:8443/v1"), true);
  });

  test("allows plain HTTP only for explicit loopback hosts", () => {
    for (const value of [
      "http://localhost:11434/v1",
      "http://127.0.0.1:11434/v1",
      "http://127.200.30.40/v1",
      "http://[::1]:11434/v1",
    ]) {
      assert.strictEqual(isAllowedApiBaseUrl(value), true, value);
    }

    for (const value of [
      "http://api.deepseek.com",
      "http://example.test",
      "http://localhost.example.test",
      "http://192.168.1.10:11434",
    ]) {
      assert.strictEqual(isAllowedApiBaseUrl(value), false, value);
    }
  });

  test("rejects URL credentials, queries, fragments and non-HTTP schemes", () => {
    for (const value of [
      "https://user:password@example.test/v1",
      "https://example.test/v1?token=secret",
      "https://example.test/v1#secret",
      "file:///tmp/api",
    ]) {
      assert.strictEqual(isAllowedApiBaseUrl(value), false, value);
    }
  });

  test("compares parsed origins so lookalike domains do not match", () => {
    assert.strictEqual(getApiOrigin("https://api.deepseek.com/v1"), "https://api.deepseek.com");
    assert.notStrictEqual(
      getApiOrigin("https://api.deepseek.com.evil.example/v1"),
      getApiOrigin("https://api.deepseek.com/v1"),
    );
    assert.notStrictEqual(
      getApiOrigin("https://api.deepseek.com:8443/v1"),
      getApiOrigin("https://api.deepseek.com/v1"),
    );
  });
});
