import assert from "node:assert/strict";
import { createDelegatedVisionAnalyzer } from "@/infrastructure/deepseek/provider/DelegatedVisionAnalyzer";
import { DEFAULT_CONFIG } from "@/contracts";
import type { ModelProviderFactory } from "@/application/ports";
import { createUsageAggregate } from "@/shared/usage/Usage";
import type { ScreenshotStore } from "@/infrastructure/images/ScreenshotStore";

suite("multi-source delegated vision", () => {
  test("works with no prompt attachments, reuses hash uploads and deletes on disposal", async () => {
    const uploaded: string[] = []; const deleted: string[] = [];
    const analyzer = createDelegatedVisionAnalyzer({
      providerConfig: { ...DEFAULT_CONFIG, model: "deepseek-v4-pro", apiKey: "test" },
      usageAggregate: createUsageAggregate(true, "deepseek-v4-pro"),
      modelProviderFactory: { create: () => ({ chatCompletion: async () => ({ choices: [{ message: { content: "A white square" } }] }) }) } as unknown as ModelProviderFactory,
      screenshots: { lookup: async () => ({ bytes: Buffer.from("89504e470d0a1a0a", "hex"), metadata: { id: "screenshot-1", fileName: "1-web.png" } }) } as unknown as ScreenshotStore,
      upload: async (options) => {
        assert.equal(options.expiresAfterSeconds, 3600);
        uploaded.push(options.filename);
        return { id: "file-api-test", bytes: 8, filename: options.filename, createdAt: 1 };
      },
      deleteFile: async (options) => {deleted.push(options.fileId);},
    })!;
    assert.ok(analyzer);
    for (let index = 0; index < 2; index++) {
      assert.match(await analyzer({ question: "Describe", screenshotIds: ["latest"] }), /Images sent.*screenshot:screenshot-1/);
    }
    assert.equal(uploaded.length, 1);
    await analyzer.dispose();
    assert.deepEqual(deleted, ["file-api-test"]);
    await assert.rejects(analyzer({ question: "Again" }), /closed/);
  });
  test("rejects unsupported models and excessive source count before upload", async () => {
    const options = { providerConfig: { ...DEFAULT_CONFIG, model: "unknown" }, modelProviderFactory: {} as ModelProviderFactory, usageAggregate: createUsageAggregate(true, "unknown") };
    assert.equal(createDelegatedVisionAnalyzer(options), undefined);
    const analyzer = createDelegatedVisionAnalyzer({ ...options, providerConfig: { ...DEFAULT_CONFIG, model: "deepseek-flash" } })!;
    await assert.rejects(analyzer({ question: "test", paths: Array(9).fill("image.png") }), /At most 8/);
    await assert.rejects(analyzer({ question: "test", attachmentIds: ["missing"] }), /Unknown attachment/);
    await analyzer.dispose();
  });
});
