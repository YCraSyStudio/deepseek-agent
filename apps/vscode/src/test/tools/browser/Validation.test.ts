import assert from "node:assert/strict";
import { validateCursor, validateDomains, validateLanguage, validateOpaqueId, validateOptionalFocus, validateResultLimit, validateSearchQuery } from "@/infrastructure/browser/Validation";

suite("browser tool parameter boundaries", () => {
  test("trims search queries and counts Unicode characters rather than UTF-16 units", () => {
    assert.equal(validateSearchQuery("  Find this  "), "Find this");
    assert.equal(validateSearchQuery("😀".repeat(128)), "😀".repeat(128));
    for (const value of [null, 1, "", "   ", "a".repeat(129), "😀".repeat(129)]) { assert.throws(() => validateSearchQuery(value), /query must contain/); }
  });
  test("accepts only bounded opaque identifiers and bounded cursors returned by web tools", () => {
    assert.equal(validateOpaqueId("A0_-".repeat(128), "result_id").length, 512);
    assert.equal(validateCursor(undefined), undefined); assert.equal(validateCursor("A0_-".repeat(16))?.length, 64);
    for (const value of [null, 1, "", "with space", "../path", "a".repeat(513)]) { assert.throws(() => validateOpaqueId(value, "result_id"), /result_id must be an identifier/); }
    for (const value of [null, 1, "", "with space", "a".repeat(65)]) { assert.throws(() => validateCursor(value), /cursor must be a cursor/); }
  });
  test("trims optional focus and accepts only nonempty bounded text", () => {
    assert.equal(validateOptionalFocus(undefined), undefined); assert.equal(validateOptionalFocus("  Focus  "), "Focus");
    assert.equal(validateOptionalFocus("a".repeat(500))?.length, 500);
    for (const value of [null, 1, "", " \t ", "a".repeat(501)]) { assert.throws(() => validateOptionalFocus(value), /focus must contain/); }
  });
  test("bounds result counts and preserves the default", () => {
    assert.equal(validateResultLimit(undefined), 8); assert.equal(validateResultLimit(1), 1); assert.equal(validateResultLimit(50), 50);
    for (const value of [null, "8", 0, -1, 51, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) { assert.throws(() => validateResultLimit(value), /max_results must be an integer/); }
  });
  test("normalizes and deduplicates domain filters while enforcing DNS label and collection limits", () => {
    assert.deepEqual(validateDomains(undefined), []);
    assert.deepEqual(validateDomains([" HTTPS://EXAMPLE.COM/ ", "example.com", "http://docs.example.net/"]), ["example.com", "docs.example.net"]);
    const longest = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
    assert.equal(longest.length, 253); assert.deepEqual(validateDomains([longest]), [longest]);
    for (const value of [null, "example.com", Array(6).fill("example.com"), [1], [""], ["example.com/path"],
      ["-invalid.com"], ["a..com"], ["a".repeat(64) + ".com"], [longest + "e"], ["host.local"], ["host.localhost"]]) {
      assert.throws(() => validateDomains(value), /domains must contain|Invalid public domain/);
    }
  });
  test("rejects literal IP filters before any private-network classification is needed", () => {
    for (const ip of ["0.1.2.3", "10.0.0.1", "127.0.0.1", "100.64.0.1", "169.254.1.1", "172.16.0.1", "192.0.0.1", "192.168.1.1", "198.18.0.1", "224.0.0.1", "8.8.8.8", "999.1.1.1", "[::1]", "2001:4860::8888"]) {
      assert.throws(() => validateDomains([ip]), /Invalid public domain/);
    }
  });
  test("accepts language, script and region tags without accepting arbitrary locale syntax", () => {
    assert.equal(validateLanguage(undefined), undefined);
    for (const language of ["es", "es-ES", "zh-Hant", "zh-Hant-TW", "es-419", "fil-PH"]) { assert.equal(validateLanguage(` ${language} `), language); }
    for (const value of [null, 1, "", "e", "english", "en_US", "en-US-extra"]) { assert.throws(() => validateLanguage(value), /BCP-47 language tag/); }
  });
});
