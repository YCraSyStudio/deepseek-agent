import * as assert from "node:assert";
import { deleteDeepSeekFile, uploadDeepSeekImage } from "@/infrastructure/deepseek/files/DeepSeekFiles";

suite("DeepSeek Files API", () => {
  test("uploads multipart user_data and returns reusable file metadata", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (input, init) => {
        assert.strictEqual(String(input), "https://api.deepseek.com/files");
        assert.strictEqual(init?.method, "POST");
        assert.strictEqual(new Headers(init?.headers).get("content-type"), null);
        assert.strictEqual(new Headers(init?.headers).get("authorization"), "Bearer test-key");
        assert.ok(init?.body instanceof FormData);
        assert.strictEqual(init.body.get("purpose"), "user_data");
        assert.strictEqual(init.body.get("expires_after[anchor]"), "created_at");
        assert.strictEqual(init.body.get("expires_after[seconds]"), "2592000");
        const file = init.body.get("file");
        assert.ok(file instanceof File);
        assert.strictEqual(file.name, "image.png");
        assert.deepStrictEqual(new Uint8Array(await file.arrayBuffer()), Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        return Response.json({
          id: "file-api-test123",
          object: "file",
          bytes: 8,
          created_at: 1_700_000_000,
          filename: "shot.png",
          purpose: "user_data",
          expires_at: 1_702_592_000,
        });
      };

      const uploaded = await uploadDeepSeekImage({
        apiKey: "test-key",
        baseUrl: "https://api.deepseek.com",
        bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        filename: "shot.png",
        mediaType: "image/png",
        expiresAfterSeconds: 2_592_000,
      });
      assert.strictEqual(uploaded.id, "file-api-test123");
      assert.strictEqual(uploaded.expiresAt, 1_702_592_000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("deletes only a validated file_id on the configured origin", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (input, init) => {
        assert.strictEqual(String(input), "https://api.deepseek.com/files/file-api-test123");
        assert.strictEqual(init?.method, "DELETE");
        return Response.json({ id: "file-api-test123", deleted: true });
      };
      await deleteDeepSeekFile({ apiKey: "test-key", baseUrl: "https://api.deepseek.com", fileId: "file-api-test123" });
      await assert.rejects(
        deleteDeepSeekFile({ apiKey: "test-key", baseUrl: "https://api.deepseek.com", fileId: "../models" }),
        /Invalid DeepSeek file identifier/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
