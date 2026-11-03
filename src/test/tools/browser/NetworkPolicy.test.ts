import assert from "node:assert/strict";
import { mock } from "node:test";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { WebAccessPolicy, extractHttpsUrls, isPublicIp, registrableSite, resolvePublicHostname, validatePublicWebUrl } from "@/infrastructure/browser/NetworkPolicy";

suite("web access policy boundary behavior", () => {
  test("provider grants authorize a route with changing query parameters but not other paths", () => {
    const policy = new WebAccessPolicy(); policy.grantProvider("https://search.example.com/search?q=first");
    assert.equal(policy.assertNavigationAllowed("https://search.example.com/search?q=second").search, "?q=second");
    assert.throws(() => policy.assertNavigationAllowed("https://search.example.com/account"), /not authorized/);
    assert.throws(() => policy.assertNavigationAllowed("https://other.example.com/search?q=second"), /not authorized/);
    assert.equal(policy.isAllowedHostname("static.example.com"), true); assert.equal(policy.isAllowedHostname("example.net"), false);
  });
  test("result grants permit redirects within the registrable site without granting unrelated sites", () => {
    const policy = new WebAccessPolicy(); policy.grantResult("https://docs.example.co.uk/page");
    assert.equal(policy.assertNavigationAllowed("https://www.example.co.uk/redirected").pathname, "/redirected");
    assert.throws(() => policy.assertNavigationAllowed("https://example.com/page"), /not authorized/);
  });
  test("subresource grants allow hostname use without authorizing top-level navigation", () => {
    const policy = new WebAccessPolicy(); policy.grantSubresource("https://cdn.example.net/font.woff");
    assert.equal(policy.isAllowedHostname("assets.example.net"), true); assert.throws(() => policy.assertNavigationAllowed("https://cdn.example.net/font.woff"), /not authorized/);
    for (const host of ["8.8.8.8", "[2606:4700::1111]"]) { assert.equal(policy.isAllowedHostname(host), false); }
  });
  test("invalid user URLs do not discard valid explicit grants", () => {
    const policy = new WebAccessPolicy(); policy.grantUserUrls(["invalid", "http://example.com", "https://example.com/page", "https://localhost/private"]);
    assert.equal(policy.assertNavigationAllowed("https://example.com/page").hostname, "example.com"); assert.equal(policy.isAllowedHostname("localhost"), false);
  });
  test("extracts HTTPS URLs, removes punctuation and deduplicates normalized addresses", () => {
    assert.deepEqual(extractHttpsUrls('Read HTTPS://EXAMPLE.COM/page), and https://example.com/page! <https://other.net/a?q=1>. Ignore http://plain.net and https://localhost/private.'), ["https://example.com/page", "https://other.net/a?q=1"]);
  });
  for (const value of ["", "x".repeat(4097), "relative/path", "http://example.com", "ftp://example.com", "https://user@example.com", "https://user:pass@example.com", "https://example.com:8443", "https://127.0.0.1", "https://[::1]", "https://LOCALHOST.", "https://sub.localhost", "https://device.local", "https://host.internal", "https://metadata.google.internal"]) {
    test(`rejects unauthorized URL syntax or local destinations: ${value.slice(0, 45)}`, () => { assert.throws(() => validatePublicWebUrl(value)); });
  }
  test("normalizes explicit HTTPS port 443 and registrable private suffixes", () => {
    assert.equal(validatePublicWebUrl("https://EXAMPLE.com:443/path").toString(), "https://example.com/path");
    assert.equal(registrableSite("DOCS.EXAMPLE.COM."), "example.com"); assert.equal(registrableSite("project.github.io"), "project.github.io"); assert.equal(registrableSite("intranet"), "intranet");
  });
  const ipv4Cases: Array<[string, boolean]> = [
    ["0.1.2.3", false], ["10.0.0.1", false], ["127.0.0.1", false], ["224.0.0.1", false], ["255.255.255.255", false],
    ["100.63.255.255", true], ["100.64.0.0", false], ["100.127.255.255", false], ["100.128.0.0", true],
    ["169.253.1.1", true], ["169.254.1.1", false], ["172.15.255.255", true], ["172.16.0.0", false], ["172.31.255.255", false], ["172.32.0.0", true],
    ["192.0.1.1", false], ["192.168.1.1", false], ["192.88.98.1", true], ["192.88.99.1", false], ["192.88.100.1", true],
    ["198.17.1.1", true], ["198.18.0.1", false], ["198.19.0.1", false], ["198.20.1.1", true], ["198.51.99.1", true], ["198.51.100.1", false], ["198.51.101.1", true],
    ["203.0.112.1", true], ["203.0.113.1", false], ["203.0.114.1", true], ["8.8.8.8", true],
  ];
  test("classifies IPv4 reserved-range edges without blocking adjacent public ranges", () => {
    for (const [address, expected] of ipv4Cases) { assert.equal(isPublicIp(address), expected, address); }
  });
  test("classifies native and mapped IPv6 addresses including documentation and transition ranges", () => {
    for (const address of ["2001:4860:4860::8888", "2606:4700::1111", "2606:4700:0:0:0:0:0:1111", "::ffff:8.8.8.8"]) { assert.equal(isPublicIp(address), true, address); }
    for (const address of ["::", "::1", "fc00::1", "fe80::1", "ff02::1", "2001::1", "2001:1ff::1", "2001:db8::1", "2002::1", "3fff::1", "4000::1", "::ffff:127.0.0.1", "::ffff:808:808", "not an IP", "999.1.1.1"]) { assert.equal(isPublicIp(address), false, address); }
  });
  test("rejects scoped IPv6 addresses that cannot be interpreted as an unambiguous public destination", () => {
    for (const address of ["2001:4860::8888%eth0", "2606:4700::1111%lo", "fe80::1%eth0"]) {
      assert.equal(isPublicIp(address), false, address);
    }
  });
  test("resolves all public DNS answers while preserving address families", async () => {
    const answers = [{ address: "8.8.8.8", family: 4 }, { address: "2606:4700::1111", family: 6 }]; let requested = "";
    assert.deepEqual(await resolvePublicHostname("example.com", async (value) => { requested = value; return answers; }), answers); assert.equal(requested, "example.com");
  });
  test("the default DNS adapter requests all verbatim answers", async () => {
    const observed: unknown[][] = [];
    const replacement = mock.method(dns, "lookup", async (...args: unknown[]) => { observed.push(args); return [{ address: "8.8.8.8", family: 4 }]; });
    syncBuiltinESMExports();
    try {
      assert.deepEqual(await resolvePublicHostname("example.com"), [{ address: "8.8.8.8", family: 4 }]);
      assert.deepEqual(observed, [["example.com", { all: true, verbatim: true }]]);
    } finally { replacement.mock.restore(); syncBuiltinESMExports(); }
  });
  test("rejects empty and mixed public/private DNS results", async () => {
    await assert.rejects(resolvePublicHostname("example.com", async () => []), /no addresses/);
    await assert.rejects(resolvePublicHostname("example.com", async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]), /non-public/);
  });
  test("rejects local and literal hostnames before invoking DNS", async () => {
    let lookups = 0; for (const host of ["localhost", "host.local", "host.internal", "8.8.8.8", "[::1]"]) {
      await assert.rejects(resolvePublicHostname(host, async () => { lookups++; return []; }), /blocked/);
    }
    assert.equal(lookups, 0);
  });
  test("preserves resolver failures and times out a resolver that never completes", async () => {
    const failure = new Error("resolver unavailable"); await assert.rejects(resolvePublicHostname("example.com", async () => { throw failure; }), (error) => error === failure);
    mock.timers.enable({ apis: ["setTimeout"] });
    try { const pending = resolvePublicHostname("example.com", () => new Promise(() => undefined)); const rejected = assert.rejects(pending, /DNS lookup timed out/); mock.timers.tick(4000); await rejected; }
    finally { mock.timers.reset(); }
  });
});
