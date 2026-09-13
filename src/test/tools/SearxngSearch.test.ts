import * as assert from "node:assert";
import * as http from "node:http";
import {
  configureSearxngEngineSelection,
  fetchSearxngEngines,
  normalizeSearxngEndpoint,
  searchSearxng,
} from "@/infrastructure/browser/SearxngSearch";

suite("SearXNG search", () => {
  teardown(() => configureSearxngEngineSelection(() => []));

  test("allows loopback HTTP and requires HTTPS for remote endpoints", () => {
    assert.strictEqual(normalizeSearxngEndpoint("http://127.0.0.1:8888").origin, "http://127.0.0.1:8888");
    assert.strictEqual(normalizeSearxngEndpoint("https://search.example.com/searx").origin, "https://search.example.com");
    assert.throws(() => normalizeSearxngEndpoint("http://search.example.com"), /HTTPS/);
    assert.throws(() => normalizeSearxngEndpoint("https://user:secret@search.example.com"), /credentials/);
  });

  test("reads the available engine matrix from SearXNG config", async () => {
    const server = http.createServer((request, response) => {
      assert.strictEqual(request.url, "/config");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        engines: [
          { name: "Google", shortcut: "g", categories: ["general"], enabled: true },
          { name: "DuckDuckGo", shortcut: "ddg", categories: ["general"], enabled: false },
          { name: "Invalid", shortcut: "not valid!", enabled: true },
        ],
      }));
    });
    const port = await listen(server);
    try {
      const engines = await fetchSearxngEngines(`http://127.0.0.1:${port}`);
      assert.deepStrictEqual(engines, [
        { name: "DuckDuckGo", shortcut: "ddg", categories: ["general"], enabled: false },
        { name: "Google", shortcut: "g", categories: ["general"], enabled: true },
      ]);
    } finally {
      await close(server);
    }
  });

  test("parses JSON results, keeps public HTTPS URLs, and respects result limits", async () => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      assert.strictEqual(url.pathname, "/search");
      assert.strictEqual(url.searchParams.get("q"), "deepseek agent");
      assert.strictEqual(url.searchParams.get("format"), "json");
      assert.strictEqual(url.searchParams.get("language"), "es-ES");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        results: [
          { url: "https://example.com/one" },
          { url: "http://example.com/insecure" },
          { url: "https://127.0.0.1/private" },
          { url: "https://example.org/two" },
          { url: "https://example.net/three" },
        ],
      }));
    });
    const port = await listen(server);
    try {
      const result = await searchSearxng(
        `http://127.0.0.1:${port}`,
        "deepseek agent",
        { language: "es", region: "ES", tag: "es-ES" },
        2,
      );
      assert.deepStrictEqual(result.urls, ["https://example.com/one", "https://example.org/two"]);
      assert.match(result.contentHash, /^[a-f0-9]{64}$/);
    } finally {
      await close(server);
    }
  });

  test("combines selected SearXNG engines with inclusive bangs", async () => {
    configureSearxngEngineSelection(() => ["g", "ddg", "g"]);
    const server = http.createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      assert.strictEqual(url.searchParams.get("q"), "!g !ddg deepseek v4");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ results: [{ url: "https://example.com/result" }] }));
    });
    const port = await listen(server);
    try {
      const result = await searchSearxng(
        `http://127.0.0.1:${port}`,
        "deepseek v4",
        { language: "es", region: "ES", tag: "es-ES" },
        10,
      );
      assert.deepStrictEqual(result.urls, ["https://example.com/result"]);
    } finally {
      await close(server);
    }
  });
});

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Test server did not expose a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
