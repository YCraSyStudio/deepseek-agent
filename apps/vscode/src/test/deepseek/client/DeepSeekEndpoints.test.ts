import * as assert from "assert";
import { deepseekFetch, buildApiUrl } from "@/infrastructure/deepseek/client/DeepSeekFetch";

suite("DeepSeek URLs", () => {
  test("allows same-origin absolute URLs and rejects cross-origin URLs", () => {
    assert.strictEqual(
      buildApiUrl("https://example.test/v1", "https://example.test/models"),
      "https://example.test/models",
    );
    assert.throws(
      () => buildApiUrl("https://example.test/v1", "https://example.test.evil.invalid/models"),
      /different origin/,
    );
  });

  test("follows same-origin redirects while retaining authorization", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; authorization: string | null }> = [];
    try {
      globalThis.fetch = async (input, init) => {
        calls.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return calls.length === 1
          ? new Response(null, { status: 307, headers: { location: "/v1/final" } })
          : new Response("{}", { status: 200 });
      };

      await deepseekFetch({
        pathOrUrl: "chat/completions",
        apiKey: "sk-redirect-secret",
        baseUrl: "https://example.test/v1",
      });

      assert.deepStrictEqual(calls.map((call) => call.url), [
        "https://example.test/v1/chat/completions",
        "https://example.test/v1/final",
      ]);
      assert.deepStrictEqual(calls.map((call) => call.authorization), [
        "Bearer sk-redirect-secret",
        "Bearer sk-redirect-secret",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects cross-origin redirects before authorizing the destination", async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    try {
      globalThis.fetch = async () => {
        callCount += 1;
        return new Response(null, {
          status: 302,
          headers: { location: "https://example.test.evil.invalid/steal" },
        });
      };

      await assert.rejects(
        deepseekFetch({
          pathOrUrl: "chat/completions",
          apiKey: "sk-never-forward",
          baseUrl: "https://example.test/v1",
        }),
        /different origin/,
      );
      assert.strictEqual(callCount, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not expose an API response body through errors", async () => {
    const originalFetch = globalThis.fetch;
    const reflectedCredential = "opaque-credential-reflected-by-server";
    try {
      globalThis.fetch = async () => new Response(
        JSON.stringify({ error: { message: reflectedCredential } }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      );

      await assert.rejects(
        deepseekFetch({
          pathOrUrl: "chat/completions",
          apiKey: reflectedCredential,
          baseUrl: "https://example.test/v1",
        }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.strictEqual(error.message, "Invalid API credentials.");
          assert.strictEqual(error.message.includes(reflectedCredential), false);
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("shows bounded validation details without credentials and does not retry rejected requests", async () => {
    const originalFetch = globalThis.fetch;
    const credential = "opaque-credential-reflected-by-server";
    let calls = 0;
    try {
      for (const status of [400, 422]) {
        globalThis.fetch = async () => {
          calls++;
          return Response.json({ error: {
            code: "invalid_request_error",
            message: `Invalid schema for function read_file: unsupported type.\nAuthorization: Bearer ${credential}`,
          } }, { status });
        };
        await assert.rejects(deepseekFetch({
          pathOrUrl: "chat/completions", apiKey: credential,
          requestInit: { method: "POST", body: "{}" },
        }), (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /Invalid schema for function read_file: unsupported type/);
          assert.ok(!error.message.includes(credential));
          assert.ok(!error.message.includes("\n"));
          return true;
        });
      }
      assert.strictEqual(calls, 2);
      for (const body of ["not JSON", JSON.stringify({ error: { message: "x".repeat(2049) } })]) {
        globalThis.fetch = async () => new Response(body, { status: 400, headers: { "content-type": "application/json" } });
        await assert.rejects(deepseekFetch({ pathOrUrl: "chat/completions", apiKey: credential }),
          /^DeepSeekApiError: API request failed with HTTP 400\.$/);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
