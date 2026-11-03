import assert from "node:assert/strict";
import * as path from "node:path";
import { resolveVisionImageSources } from "@/infrastructure/images/VisionImageSources";
import { detectImageMediaType } from "@/infrastructure/images/ImageFormat";
import { runWithToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import type { ToolWorkspaceHost } from "@/application/ports";

suite("vision source confinement", () => {
  const root = path.resolve("/project");
  const workspace = {
    getRootPath: () => root,
    realPath: async (input: string) => input === path.join(root, "escape.png") ? path.resolve("/private/secret.png") : input,
    stat: async () => ({ size: 6, type: "file" }),
    readFile: async () => Buffer.from("GIF89a"),
  } as unknown as ToolWorkspaceHost;
  test("detects image bytes rather than trusting extensions", () => {
    assert.equal(detectImageMediaType(Buffer.from("GIF89a")), "image/gif");
    assert.equal(detectImageMediaType(Buffer.from("plain text")), undefined);
  });
  test("accepts workspace images but rejects secrets, traversal and symlink escapes", async () => {
    await runWithToolWorkspaceHost(workspace, async () => {
      const sources = await resolveVisionImageSources({ question: "test", paths: ["design.gif"] }, []);
      assert.equal(sources.local[0]?.source, "design.gif");
      for (const input of ["../secret.png", ".env", "escape.png"]) {
        await assert.rejects(resolveVisionImageSources({ question: "test", paths: [input] }, []));
      }
    });
  });
});
