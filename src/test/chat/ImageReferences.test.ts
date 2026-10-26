import assert from "node:assert/strict";
import { buildImageReferenceContext } from "@/application/chat/context/ImageReferences";
import type { ImageAttachment } from "@/contracts";

const images = [{ id: "screenshot-1", fileName: "1-attachment.png" }, { id: "screenshot-2", fileName: "2-web.png" }];
const attachments: ImageAttachment[] = [{ id: "attachment-1", imageNumber: 1, name: "UI.png", fileId: "file-1",
  mediaType: "image/png", size: 100, source: "clipboard", uploadedAt: 1, expiresAt: 2, apiBaseUrl: "https://api.deepseek.com", cacheFileName: "attachment-1.png" }];

suite("image reference routing", () => {
  test("omits image filenames while preserving numbered references under metadata minimization", () => {
    const context = buildImageReferenceContext(images, [{ ...attachments[0], name: "alice-private-project.png" }], true, true);
    assert.ok(!context.includes("alice-private-project.png"));
    assert.ok(!context.includes("1-attachment.png"));
    assert.match(context, /image 1; id=attachment-1/);
    assert.match(context, /screenshot_id=screenshot-1/);
  });
  test("Flash reads its numbered attachment directly rather than delegating it", () => {
    const context = buildImageReferenceContext(images, attachments, true);
    assert.match(context, /image 1: screenshot_id=screenshot-1/);
    assert.match(context, /image 1; id=attachment-1/);
    assert.match(context, /included as native visual file parts/);
    assert.doesNotMatch(context, /analyze_images/);
  });

  test("Pro delegates the same attachments and numbered references", () => {
    const context = buildImageReferenceContext(images, attachments, false);
    assert.match(context, /current model does not read images natively/);
    assert.match(context, /needs delegated vision/);
    assert.match(context, /screenshot_id=screenshot-2/);
    assert.doesNotMatch(context, /included as native visual file parts/);
  });

  test("Flash does not delegate or invent contents of images absent from its visual context", () => {
    const context = buildImageReferenceContext(images, [], true);
    assert.doesNotMatch(context, /analyze_images/);
    assert.match(context, /report that it is unavailable in your visual context/);
    assert.match(context, /never infer its contents from metadata/);
    assert.match(context, /never substitute a different image/);
  });

  test("incognito attachments use native vision without a persistent number", () => {
    const context = buildImageReferenceContext([], [{ ...attachments[0], imageNumber: undefined }], true);
    assert.match(context, /native visual file parts/);
    assert.doesNotMatch(context, /Conversation image references|image 1/);
    assert.strictEqual(buildImageReferenceContext([], [], true), "");
  });
});
