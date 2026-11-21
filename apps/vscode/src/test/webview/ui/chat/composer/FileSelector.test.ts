import assert from "node:assert/strict";
import { act, createElement } from "react";
import type { PathCompletionItem } from "@/contracts";
import { FileSelector } from "@webview/components/chatView/fileSelector/FileSelector";
import { setInterfaceLanguage } from "@webview/i18n";
import { createDomHarness } from "../../../../support/DomHarness";

suite("file and instruction selector behavior", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>;
  let selections: PathCompletionItem[];
  setup(async () => { h = await createDomHarness(); selections = []; setInterfaceLanguage("en"); });
  teardown(async () => { await h.dispose(); });
  async function render(completions: PathCompletionItem[], activeIndex = 0, isOpen = true) {
    await h.render(createElement(FileSelector, { completions, activeIndex, isOpen, listboxId: "suggestions", onSelect: (item) => selections.push(item) }));
  }
  test("closed selectors render no options and empty searches announce their status", async () => {
    await render([], -1, false); assert.equal(h.container.textContent, "");
    await render([]); assert.equal(h.query("#suggestions").getAttribute("role"), "status");
    assert.match(h.query(".pathCompletionEmpty").textContent!, /No files, folders or instructions/i);
  });
  test("file options preserve index/selection metadata and select without stealing focus", async () => {
    const files: PathCompletionItem[] = [{ type: "file", label: "file.ts", path: "src/file.ts" }, { type: "directory", label: "src", path: "src/" }];
    await render(files, 1);
    const options = h.container.querySelectorAll<HTMLButtonElement>("[role='option']");
    assert.equal(options.length, 2); assert.equal(options[1]!.getAttribute("aria-selected"), "true");
    assert.equal(options[1]!.getAttribute("aria-posinset"), "2"); assert.equal(options[0]!.getAttribute("aria-setsize"), "2");
    const event = new h.dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true });
    await act(async () => { options[0]!.dispatchEvent(event); });
    assert.equal(event.defaultPrevented, true); assert.deepEqual(selections, [files[0]]);
    await render(files.slice(0, 1), -1); assert.equal(h.container.querySelectorAll("[aria-selected='true']").length, 0);
  });
  test("workspace and global instructions have separate groups and useful descriptions", async () => {
    const instructions: PathCompletionItem[] = [
      { type: "instruction", label: "Workspace rules", path: "@rules", instructionId: "rules", instructionScope: "workspace", description: "Project rules", workspaceName: "Project" },
      { type: "instruction", label: "Global rules", path: "@global", instructionId: "global", instructionScope: "global", description: "Personal rules" },
    ];
    await render(instructions);
    assert.equal(h.container.querySelectorAll(".pathCompletionSubheading").length, 2);
    assert.equal(h.query("small").textContent, "Project"); assert.equal(h.query("[role='option']").getAttribute("data-tooltip"), "Project rules");
    assert.equal(h.container.querySelectorAll(".codicon-book").length, 2);
    await render(instructions.slice(0, 1)); assert.equal(h.container.querySelectorAll(".pathCompletionSubheading").length, 1);
  });
  const extensions: Array<[string[], string]> = [
    [["js", "jsx", "mjs", "cjs"], ".js"],
    [["ts", "tsx", "cs", "java", "kt", "kts", "go", "rs", "py", "rb", "php", "swift", "c", "h", "cpp", "hpp", "cc", "csproj", "fs", "fsx"], ".object"],
    [["json", "jsonc"], ".json"], [["html", "htm", "xml", "svg"], ".html"], [["css", "scss", "sass", "less"], ".css"],
    [["md", "mdx"], ".markdown"], [["png", "jpg", "jpeg", "gif", "webp", "ico"], ".media"], [["lock"], ".lock"], [["other", "", "TXT"], ".file"],
  ];
  for (const [names, icon] of extensions) {
    test(`file extensions ${names.join(",")} retain their recognizable icon`, async () => {
      for (const extension of names) {
        await render([{ type: "file", label: extension ? `file.${extension}` : "README", path: "file" }]);
        assert.ok(h.container.querySelector(`.pathCompletionIcon${icon}`), extension);
      }
    });
  }
});
