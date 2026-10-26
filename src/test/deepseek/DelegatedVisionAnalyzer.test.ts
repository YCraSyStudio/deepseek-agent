import assert from "node:assert/strict";
import { createDelegatedVisionAnalyzer } from "@/infrastructure/deepseek/provider/DelegatedVisionAnalyzer";
import { DEFAULT_CONFIG } from "@/contracts";
import type { ModelProviderFactory } from "@/application/ports";
import { createUsageAggregate } from "@/shared/usage/Usage";
import type { ScreenshotStore } from "@/infrastructure/images/ScreenshotStore";

suite("multi-source delegated vision", () => {
  test("records successfully prepared sources when a later upload fails and cleans them", async () => {
    const deleted: string[] = [];
    let uploads = 0;
    const analyzer = createDelegatedVisionAnalyzer({
      providerConfig: { ...DEFAULT_CONFIG, model: "deepseek-v4-pro", apiKey: "test" },
      usageAggregate: createUsageAggregate(true), modelProviderFactory: {} as ModelProviderFactory,
      screenshots: { lookup: async (id: string) => ({ bytes: Buffer.from(id), metadata: { id, fileName: id + ".png" } }) } as unknown as ScreenshotStore,
      upload: async () => {if (++uploads === 2) {throw new Error("second upload failed");} return { id: "file-api-first", bytes: 1, filename: "first.png", createdAt: 1 };},
      deleteFile: async ({ fileId }) => {deleted.push(fileId);},
    })!;
    await assert.rejects(analyzer({ question: "Compare", screenshotIds: ["screenshot-1", "screenshot-2"] }), (error: unknown) => {
      assert.match(String(error), /screenshot:screenshot-1/);
      assert.ok(!String(error).includes("screenshot:screenshot-2"));
      return true;
    });
    await analyzer.dispose();
    assert.deepEqual(deleted, ["file-api-first"]);
  });

  test("settles an in-flight upload before deleting and never sends it after disposal", async () => {
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {started = resolve;});
    const gate = new Promise<void>((resolve) => {release = resolve;});
    const deleted: string[] = [];
    const analyzer = createDelegatedVisionAnalyzer({
      providerConfig: { ...DEFAULT_CONFIG, model: "deepseek-v4-pro", apiKey: "test" },
      usageAggregate: createUsageAggregate(true), modelProviderFactory: {} as ModelProviderFactory,
      screenshots: { lookup: async () => ({ bytes: Buffer.from("png"), metadata: { id: "screenshot-1", fileName: "1.png" } }) } as unknown as ScreenshotStore,
      upload: async () => {started(); await gate; return { id: "file-api-late", bytes: 3, filename: "1.png", createdAt: 1 };},
      deleteFile: async ({ fileId }) => {deleted.push(fileId);},
    })!;
    const operation = analyzer({ question: "Read", screenshotIds: ["1"] });
    const rejected = assert.rejects(operation, /closed/);
    await ready;
    const disposal = analyzer.dispose();
    assert.equal(analyzer.dispose(), disposal);
    release();
    await rejected;
    await disposal;
    assert.deepEqual(deleted, ["file-api-late"]);
  });

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
    const results = await Promise.all([0, 1].map(() => analyzer({ question: "Describe", screenshotIds: ["latest"] })));
    for (const result of results) {assert.match(result, /Images sent.*screenshot:screenshot-1/); }
    assert.equal(uploaded.length, 1);
    await analyzer.dispose();
    assert.deepEqual(deleted, ["file-api-test"]);
    await assert.rejects(analyzer({ question: "Again" }), /closed/);
  });
  test("rejects unsupported models and excessive source count before upload", async () => {
    const options = { providerConfig: { ...DEFAULT_CONFIG, model: "unknown" }, modelProviderFactory: {} as ModelProviderFactory, usageAggregate: createUsageAggregate(true, "unknown") };
    assert.equal(createDelegatedVisionAnalyzer(options), undefined);
    assert.equal(createDelegatedVisionAnalyzer({ ...options, providerConfig: { ...DEFAULT_CONFIG, model: "deepseek-flash" } }), undefined);
    const analyzer = createDelegatedVisionAnalyzer({ ...options, providerConfig: { ...DEFAULT_CONFIG, model: "deepseek-v4-pro" } })!;
    await assert.rejects(analyzer({ question: "test", paths: Array(9).fill("image.png") }), /At most 8/);
    await assert.rejects(analyzer({ question: "test", attachmentIds: ["missing"] }), /Unknown attachment/);
    await analyzer.dispose();
  });
});
