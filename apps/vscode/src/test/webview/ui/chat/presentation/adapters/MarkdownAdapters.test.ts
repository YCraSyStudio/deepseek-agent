import assert from "node:assert/strict";
import { createElement } from "react";
import { MarkdownMessage } from "@webview/components/chatView/messages/MarkdownMessage";
import { markdownFixture } from "../../../../../support/MarkdownAdapterMock";
import { createDomHarness } from "../../../../../support/DomHarness";

suite("markdown rendering-library boundary", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>;
  setup(async () => { h = await createDomHarness(); markdownFixture.fail = false; markdownFixture.tree = undefined; markdownFixture.children = "code\n"; markdownFixture.className = "language-js"; });
  teardown(async () => { await h.dispose(); });
  const render = () => h.render(createElement(MarkdownMessage, { content: "source", role: "assistant" }));

  test("highlighter failures retain the original unescaped code text", async () => {
    markdownFixture.fail = true; markdownFixture.children = '<tag>\n'; await render();
    assert.equal(h.query("code").textContent, "<tag>"); assert.equal(h.container.querySelector("tag"), null);
  });
  test("a highlighter without children falls back to source rather than an empty preview", async () => {
    markdownFixture.tree = { type: "root" }; await render(); assert.equal(h.query("code").textContent, "code");
  });
  test("valid nested highlighter nodes preserve class strings, class arrays and plain text", async () => {
    markdownFixture.tree = { type: "root", children: [
      { type: "element", tagName: "span", properties: { className: ["token", "keyword"] }, children: [{ type: "text", value: "const" }] },
      { type: "element", tagName: "span", properties: { className: "token plain" }, children: [{ type: "text", value: " value" }] },
      { type: "element", tagName: "span", children: [{ type: "text", value: " = 1" }] },
      { type: "element", tagName: "span" }, { type: "text" }, { type: "comment", value: "must not render" },
    ] };
    await render(); assert.equal(h.query("code").textContent, "const value = 1");
    assert.ok(h.container.querySelector(".token.keyword")); assert.ok(h.container.querySelector(".token.plain"));
    assert.doesNotMatch(h.container.textContent!, /must not render/);
  });
  test("the renderer accepts ReactNode children without dropping nested code fragments", async () => {
    markdownFixture.children = [createElement("strong", { key: "wrapped" }, "wrapped"), 42, null, false, [" nested", "\n"]];
    await render(); assert.equal(h.query(".code-block").getAttribute("data-code-text"), "wrapped42 nested");
  });
  test("unlabelled multiline nodes use the text fallback language", async () => {
    markdownFixture.className = undefined; markdownFixture.children = "first\nsecond\n"; await render();
    assert.equal(h.query(".lang-label").textContent, "text"); assert.equal(h.query("code").textContent, "first\nsecond");
  });
  test("unrecognised code classes retain a safe fallback language", async () => {
    markdownFixture.className = "custom-class"; markdownFixture.children = "text\n"; await render();
    assert.equal(h.query(".lang-label").textContent, "text");
  });
});
