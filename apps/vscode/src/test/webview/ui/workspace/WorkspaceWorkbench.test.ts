import assert from "node:assert/strict";
import { EditorView } from "codemirror";
import { act, createElement } from "react";
import { setInterfaceLanguage } from "@webview/i18n";
import WorkspaceWorkbench, { type WorkspaceReference } from "@webview/workspace/WorkspaceWorkbench";
import { createDomHarness } from "../../../support/DomHarness";

suite("mobile workspace editor", () => {
  test("keeps a conflicting draft, saves by revision and attaches the saved file", async () => {
    const h = await createDomHarness();
    Object.defineProperties(h.dom.window.Range.prototype, {
      getClientRects: { value: () => [] },
      getBoundingClientRect: { value: () => new h.dom.window.DOMRect() },
    });
    const fetch = globalThis.fetch;
    const abortAny = Object.getOwnPropertyDescriptor(AbortSignal, "any");
    const abortTimeout = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");
    Object.defineProperties(AbortSignal, {
      any: { value: undefined, configurable: true },
      timeout: { value: undefined, configurable: true },
    });
    const references: WorkspaceReference[] = [];
    const writes: unknown[] = [];
    setInterfaceLanguage("en");
    globalThis.fetch = async (input, init) => {
      assert.equal(new Headers(init?.headers).get("X-YcraSy-Workspace"), "1");
      if (input === "/ui/workspace/files") {
        return Response.json({ workspace: "Project", rootUri: "file:///project", files: ["src/notes.txt"] });
      }
      assert.equal(input, "/ui/workspace/file?path=src%2Fnotes.txt");
      if (init?.method === "PUT") {
        writes.push(JSON.parse(String(init.body)));
        return writes.length === 1 ? new Response(null, { status: 409 }) : Response.json({ text: "edited", revision: "next" });
      }
      return Response.json({ text: "original", revision: "base" });
    };
    try {
      await h.render(createElement(WorkspaceWorkbench, { children: "Chat content", onAttach: (reference) => references.push(reference) }));
      await h.click(".workspaceTree button");
      await h.flush();
      const editor = EditorView.findFromDOM(h.query(".cm-editor"));
      assert.ok(editor);
      await act(async () => editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "edited" } }));
      const toolbar = () => [...h.container.querySelectorAll<HTMLButtonElement>(".workspaceEditorPane button")];
      const button = (label: string) => {
        const result = toolbar().find(item => item.textContent === label);
        assert.ok(result, label);
        return result;
      };
      assert.equal(button("Add to chat").disabled, true);
      await h.click(button("Save"));
      assert.match(h.query('[role="alert"]').textContent!, /draft is still here/);
      assert.equal(editor.state.doc.toString(), "edited");
      await h.click(button("Save"));
      assert.deepEqual(writes, [{ text: "edited", revision: "base" }, { text: "edited", revision: "base" }]);
      await h.click(button("Add to chat"));
      assert.deepEqual(references, [{ path: "src/notes.txt", rootUri: "file:///project", content: "edited" }]);
      assert.equal(h.query(".workspaceWorkbench").getAttribute("data-tab"), "chat");
    } finally {
      await h.dispose();
      globalThis.fetch = fetch;
      if (abortAny) {Object.defineProperty(AbortSignal, "any", abortAny);}
      if (abortTimeout) {Object.defineProperty(AbortSignal, "timeout", abortTimeout);}
    }
  });

  test("reloads the listing when the files view becomes active and on demand", async () => {
    const h = await createDomHarness();
    const fetch = globalThis.fetch;
    let listings = 0;
    setInterfaceLanguage("en");
    globalThis.fetch = async (input) => {
      assert.equal(input, "/ui/workspace/files");
      listings += 1;
      return Response.json({
        workspace: "Project",
        rootUri: "file:///project",
        files: listings === 1 ? ["src/notes.txt"] : ["src/notes.txt", "src/added.txt"],
      });
    };
    const names = () => [...h.container.querySelectorAll<HTMLButtonElement>(".workspaceTree button")]
      .map(button => button.textContent);
    try {
      await h.render(createElement(WorkspaceWorkbench, { children: "Chat content", onAttach: () => undefined }));
      assert.equal(listings, 1);
      assert.deepEqual(names(), ["notes.txt"]);
      await h.click(".workspaceNavigation button");
      await h.flush();
      assert.equal(listings, 2);
      assert.deepEqual(names(), ["notes.txt", "added.txt"]);
      await h.click([...h.container.querySelectorAll<HTMLButtonElement>(".workspaceFiles .workspaceToolbar button")][0]);
      await h.flush();
      assert.equal(listings, 3);
    } finally {
      await h.dispose();
      globalThis.fetch = fetch;
    }
  });

  test("explains a file that disappeared on the PC and refreshes the list", async () => {
    const h = await createDomHarness();
    const fetch = globalThis.fetch;
    let listings = 0;
    setInterfaceLanguage("en");
    globalThis.fetch = async (input) => {
      if (input === "/ui/workspace/files") {
        listings += 1;
        return Response.json({ workspace: "Project", rootUri: "file:///project", files: listings === 1 ? [".c8rc.json"] : [] });
      }
      return Response.json({ error: "El archivo ya no existe en el PC.", code: "missing" }, { status: 404 });
    };
    try {
      await h.render(createElement(WorkspaceWorkbench, { children: "Chat content", onAttach: () => undefined }));
      await h.click(".workspaceTree button");
      await h.flush();
      assert.equal(listings, 2);
      assert.match(h.query('[role="alert"]').textContent!, /no longer exists on the PC/);
    } finally {
      await h.dispose();
      globalThis.fetch = fetch;
    }
  });
});
