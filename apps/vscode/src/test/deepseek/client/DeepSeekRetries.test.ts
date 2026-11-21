import assert from "node:assert/strict";
import { mock } from "node:test";
import { deepseekFetch } from "@/infrastructure/deepseek/client/DeepSeekFetch";

suite("DeepSeek HTTP retry and redirect lifecycle", () => {
  let original: typeof fetch;
  setup(() => { original = globalThis.fetch; });
  teardown(() => { globalThis.fetch = original; mock.timers.reset(); });
  const flush = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); } };
  const options = { pathOrUrl: "models", apiKey: "fixture-key", baseUrl: "https://api.deepseek.com" };
  for (const [retryAfter, delay] of [["2", 2000], ["-1", 0], ["100", 30000], ["not-a-delay", 500], [null, 500]] as const) {
    test(`waits for a bounded retry delay, header=${retryAfter}`, async () => {
      mock.timers.enable({ apis: ["setTimeout"] }); let calls = 0;
      globalThis.fetch = async () => ++calls === 1 ? new Response(retryAfter === "2" ? "Busy" : null, { status: 429, headers: retryAfter === null ? {} : { "retry-after": retryAfter } }) : Response.json({ ok: true });
      const pending = deepseekFetch(options); await flush(); assert.equal(calls, 1);
      if (delay > 0) { mock.timers.tick(delay - 1); await flush(); assert.equal(calls, 1); }
      mock.timers.tick(delay > 0 ? 1 : 0); await flush();
      assert.equal((await pending).status, 200); assert.equal(calls, 2);
    });
  }
  test("uses an HTTP-date retry header relative to the current clock", async () => {
    const now = Date.UTC(2026, 0, 1); mock.timers.enable({ apis: ["setTimeout", "Date"], now }); let calls = 0;
    globalThis.fetch = async () => ++calls === 1 ? new Response(null, { status: 503, headers: { "retry-after": new Date(now + 2000).toUTCString() } }) : Response.json({ ok: true });
    const pending = deepseekFetch(options); await flush(); mock.timers.tick(1999); await flush(); assert.equal(calls, 1);
    mock.timers.tick(1); await flush(); await pending; assert.equal(calls, 2);
  });
  test("retries network failures with exponential delays and preserves the final failure", async () => {
    mock.timers.enable({ apis: ["setTimeout"] }); let calls = 0; const failure = new Error("Network unavailable");
    globalThis.fetch = async () => { calls++; throw failure; };
    const pending = deepseekFetch(options); const rejected = assert.rejects(pending, error => error === failure);
    await flush(); assert.equal(calls, 1); mock.timers.tick(500); await flush(); assert.equal(calls, 2);
    mock.timers.tick(999); await flush(); assert.equal(calls, 2); mock.timers.tick(1); await rejected; assert.equal(calls, 3);
  });
  for (const beforeWait of [false, true]) {
    test(`cancels retry waits without another request, already aborted=${beforeWait}`, async () => {
      mock.timers.enable({ apis: ["setTimeout"] }); const controller = new AbortController(); let calls = 0;
      globalThis.fetch = async () => { calls++; if (beforeWait) { controller.abort(null); } return new Response(null, { status: 408 }); };
      const pending = deepseekFetch({ ...options, requestInit: { signal: controller.signal } });
      const rejected = assert.rejects(pending, error => beforeWait ? error instanceof Error && error.name === "AbortError" : error === controller.signal.reason);
      await flush(); if (!beforeWait) { controller.abort(new Error("User cancelled")); }
      await rejected; mock.timers.tick(30000); await flush(); assert.equal(calls, 1);
    });
  }
  for (const method of ["HEAD", "OPTIONS"]) {
    test(`retries transient ${method} responses and stops after the attempt limit`, async () => {
      mock.timers.enable({ apis: ["setTimeout"] }); let calls = 0;
      globalThis.fetch = async () => { calls++; return new Response(null, { status: 500 }); };
      const pending = deepseekFetch({ ...options, requestInit: { method } }); const rejected = assert.rejects(pending, /HTTP 500/);
      await flush(); mock.timers.tick(500); await flush(); mock.timers.tick(1000); await rejected; assert.equal(calls, 3);
    });
  }
  for (const status of [301, 302, 303]) {
    test(`rewrites a POST redirect to GET and removes its body and length, status=${status}`, async () => {
      const requests: Array<{ method?: string; body: unknown; headers: Headers }> = [];
      globalThis.fetch = async (_url, init) => { requests.push({ method: init?.method, body: init?.body, headers: new Headers(init?.headers) });
        return requests.length === 1 ? new Response(null, { status, headers: { location: "/next" } }) : Response.json({ ok: true }); };
      await deepseekFetch({ ...options, requestInit: { method: "POST", body: "{}", headers: { "content-type": "application/json", "content-length": "2" } } });
      assert.equal(requests[1].method, "GET"); assert.equal(requests[1].body, undefined);
      assert.equal(requests[1].headers.has("content-length"), false);
      // Authentication applies the standard JSON content type to the new request.
      assert.equal(requests[1].headers.get("Authorization"), "Bearer fixture-key");
    });
  }
  test("rejects missing redirect locations and redirect loops with bounded request counts", async () => {
    let calls = 0; globalThis.fetch = async () => { calls++; return new Response(null, { status: 302 }); };
    await assert.rejects(deepseekFetch(options), /HTTP 302/); assert.equal(calls, 1);
    calls = 0; globalThis.fetch = async () => { calls++; return new Response(null, { status: 307, headers: { location: "/loop" } }); };
    await assert.rejects(deepseekFetch(options), /redirect limit/); assert.equal(calls, 6);
  });
  test("handles non-JSON and malformed error envelopes without exposing raw response text", async () => {
    for (const response of [new Response("Untrusted HTML error", { status: 400 }), Response.json(null, { status: 400 }), Response.json({ error: "bad envelope" }, { status: 400 })]) {
      globalThis.fetch = async () => response;
      await assert.rejects(deepseekFetch({ ...options, requestInit: { method: "POST" } }), error => error instanceof Error && /HTTP 400/.test(error.message) && !/Untrusted HTML/.test(error.message));
    }
  });
});
