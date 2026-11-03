import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { runWithToolWorkspaceHost, type ToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import { movePathHandler, movePathHandlerForced } from "@/infrastructure/tools/builtins/fileSystem/MovePath";
import { deletePathHandler, deletePathHandlerForced } from "@/infrastructure/tools/builtins/fileSystem/DeletePath";

type Handler = (args: Record<string, unknown>) => Promise<string>;

suite("move_path behavior", () => {
  const handlers: Handler[] = [movePathHandler, movePathHandlerForced];
  const invalid: Array<[Record<string, unknown>, RegExp]> = [
    [{}, /path parameter is required/],
    [{ path: 1 }, /path parameter is required/],
    [{ path: " " }, /path parameter is required/],
    [{ path: "source" }, /destination parameter is required/],
    [{ path: "source", destination: " " }, /destination parameter is required/],
    [{ path: "x".repeat(1025), destination: "target" }, /longer than 1024/],
    [{ path: "source", destination: "x".repeat(1025) }, /longer than 1024/],
    [{ path: "./source/", destination: "source" }, /same path/],
    [{ path: "source\\child", destination: "source/child/" }, /same path/],
    [{ path: ".", destination: "target" }, /root cannot be moved/],
    [{ path: "source", destination: "." }, /root cannot be moved/],
    [{ path: "source", destination: "/" }, /root cannot be moved/],
    [{ path: "../escape", destination: "target" }, /traversal/],
  ];
  for (const [index, [args, error]] of invalid.entries()) {
    test(`rejects unsafe or malformed move request ${index} before mutation`, async () => {
      const h = harness();
      for (const handler of handlers) { assert.match(await h.run(handler, args), error); }
      assert.deepEqual(h.changes, []);
    });
  }
  test("previews a file move with its current hash without modifying it", async () => {
    const h = harness();
    const preview = JSON.parse(await h.run(movePathHandler, { path: "source", destination: "target" }));
    assert.equal(preview.requiresConfirmation, true); assert.equal(preview.dangerLevel, "caution");
    assert.equal(preview.beforeHash, digest("original")); assert.match(preview.warningMessage, /file/);
    assert.deepEqual(h.changes, []); assert.equal(h.files.get("source"), "original");
  });
  for (const kind of ["directory", "unknown"] as const) {
    test(`moves a ${kind} source without trying to hash it`, async () => {
      const h = harness(); h.kinds.set("source", kind);
      const preview = JSON.parse(await h.run(movePathHandler, { path: "source", destination: "target" }));
      assert.equal(preview.beforeHash, undefined); assert.match(preview.warningMessage, new RegExp(kind));
      const result = JSON.parse(await h.run(movePathHandlerForced, { path: "source", destination: "target" }));
      assert.equal(result.sourceKind, kind); assert.equal(result.type, "fileMove");
      assert.deepEqual(h.changes, [{ operation: "move", source: "source", destination: "target", overwrite: false }]);
    });
  }
  test("moves the confirmed version and reports the before hash", async () => {
    const h = harness();
    const result = JSON.parse(await h.run(movePathHandlerForced, { path: "source", destination: "target", expectedBeforeHash: digest("original") }));
    assert.equal(result.type, "fileMove"); assert.equal(result.beforeHash, digest("original"));
    assert.equal(h.files.has("source"), false); assert.equal(h.files.get("target"), "original");
  });
  test("rejects changed files after confirmation", async () => {
    const h = harness();
    assert.match(await h.run(movePathHandlerForced, { path: "source", destination: "target", expectedBeforeHash: digest("older") }), /changed after confirmation/);
    assert.deepEqual(h.changes, []);
  });
  test("never overwrites an existing destination", async () => {
    const h = harness(); h.files.set("target", "user destination");
    for (const handler of handlers) { assert.match(await h.run(handler, { path: "source", destination: "target" }), /already exists/); }
    assert.deepEqual(h.changes, []); assert.equal(h.files.get("target"), "user destination");
  });
  test("reports destination lookup failures instead of treating them as missing", async () => {
    const h = harness(); const stat = h.host.stat; h.host.stat = async (file) => { if (file === "target") { throw new Error("permission denied"); } return stat(file); };
    assert.match(await h.run(movePathHandlerForced, { path: "source", destination: "target" }), /permission denied/);
    assert.deepEqual(h.changes, []);
  });
  test("reports missing sources and read failures without moving anything", async () => {
    const h = harness();
    assert.match(await h.run(movePathHandlerForced, { path: "missing", destination: "target" }), /missing/);
    h.host.readFile = async () => { throw new Error("read failed"); };
    assert.match(await h.run(movePathHandlerForced, { path: "source", destination: "target" }), /read failed/);
    assert.deepEqual(h.changes, []);
  });
  test("reports hosts without move support and mutation failures", async () => {
    const h = harness(); h.host.movePath = undefined;
    assert.match(await h.run(movePathHandlerForced, { path: "source", destination: "target" }), /does not support moving/);
    h.host.movePath = async () => { throw new Error("rename failed"); };
    assert.match(await h.run(movePathHandlerForced, { path: "source", destination: "target" }), /rename failed/);
  });
});

suite("delete_path behavior", () => {
  const handlers: Handler[] = [deletePathHandler, deletePathHandlerForced];
  const invalid: Array<[Record<string, unknown>, RegExp]> = [
    [{}, /path parameter is required/], [{ path: false }, /path parameter is required/], [{ path: " " }, /path parameter is required/],
    [{ path: "x".repeat(1025) }, /longer than 1024/], [{ path: "source", recursive: "true" }, /recursive parameter must be a boolean/],
    [{ path: "source", permanent: "true" }, /permanent parameter must be a boolean/], [{ path: "." }, /root cannot be deleted/],
    [{ path: ".\\" }, /root cannot be deleted/], [{ path: "/" }, /root cannot be deleted/], [{ path: "../escape" }, /traversal/],
  ];
  for (const [index, [args, error]] of invalid.entries()) {
    test(`rejects unsafe or malformed deletion ${index} before mutation`, async () => {
      const h = harness(); for (const handler of handlers) { assert.match(await h.run(handler, args), error); }
      assert.deepEqual(h.changes, []);
    });
  }
  for (const permanent of [false, true]) {
    test(`asks for confirmation and preserves the requested deletion mode, permanent=${permanent}`, async () => {
      const h = harness();
      const preview = JSON.parse(await h.run(deletePathHandler, { path: "source", permanent }));
      assert.equal(preview.requiresConfirmation, true); assert.equal(preview.dangerLevel, permanent ? "destructive" : "dangerous");
      assert.deepEqual(h.changes, []);
      const result = JSON.parse(await h.run(deletePathHandlerForced, { path: "source", permanent }));
      assert.equal(result.type, "fileDelete"); assert.equal(result.permanent, permanent); assert.equal(result.entryType, "file");
      assert.deepEqual(h.changes, [{ operation: "delete", path: "source", recursive: false, useTrash: !permanent }]);
      assert.equal(h.files.has("source"), false);
    });
  }
  for (const count of [0, 1, 2]) {
    test(`directory deletion requires an explicit recursive flag and reports ${count} entries`, async () => {
      const h = harness(); h.kinds.set("source", "directory"); h.children = Array.from({ length: count }, (_, index) => [`child-${index}`, "file"]);
      for (const handler of handlers) { assert.match(await h.run(handler, { path: "source" }), /recursive to true/); }
      const preview = JSON.parse(await h.run(deletePathHandler, { path: "source", recursive: true }));
      assert.match(preview.warningMessage, count === 1 ? /1 entry/ : new RegExp(`${count} entries`));
      const result = JSON.parse(await h.run(deletePathHandlerForced, { path: "source", recursive: true }));
      assert.equal(result.entryCount, count); assert.equal(result.entryType, "directory");
      assert.equal(h.changes[0]!.recursive, true);
    });
  }
  test("unknown entry types are described as paths rather than files", async () => {
    const h = harness(); h.kinds.set("source", "unknown");
    const preview = JSON.parse(await h.run(deletePathHandler, { path: "source" })); assert.match(preview.warningMessage, /path/);
    const result = JSON.parse(await h.run(deletePathHandlerForced, { path: "source" })); assert.equal(result.entryType, "path");
  });
  test("defaults to trash and reports missing files distinctly from access errors", async () => {
    const h = harness();
    assert.match(await h.run(deletePathHandlerForced, { path: "missing" }), /path does not exist/);
    h.host.stat = async () => { throw new Error("permission denied"); };
    assert.match(await h.run(deletePathHandlerForced, { path: "source" }), /permission denied/);
    assert.deepEqual(h.changes, []);
  });
  test("does not delete a directory whose contents cannot be inspected", async () => {
    const h = harness(); h.kinds.set("source", "directory"); h.host.readDirectory = async () => { throw new Error("cannot list"); };
    assert.match(await h.run(deletePathHandlerForced, { path: "source", recursive: true }), /cannot list/);
    assert.deepEqual(h.changes, []);
  });
  test("reports unsupported hosts and deletion errors", async () => {
    const h = harness(); h.host.deletePath = undefined;
    assert.match(await h.run(deletePathHandlerForced, { path: "source" }), /does not support deleting/);
    h.host.deletePath = async () => { throw new Error("trash unavailable"); };
    assert.match(await h.run(deletePathHandlerForced, { path: "source" }), /trash unavailable/);
  });
});

function digest(text: string) { return createHash("sha256").update(text).digest("hex"); }
function harness() {
  const files = new Map([["source", "original"]]);
  const kinds = new Map<string, "file" | "directory" | "unknown">();
  const changes: Array<Record<string, unknown>> = [];
  const state = { children: [] as Array<[string, "file"]> };
  const host: ToolWorkspaceHost = {
    getRootPath: () => path.join(tmpdir(), "path-mutations-project"),
    readFile: async (file) => { const value = files.get(file); if (value === undefined) { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } return Buffer.from(value); },
    writeFile: async (file, content) => { files.set(file, Buffer.from(content).toString("utf8")); },
    stat: async (file) => { if (!files.has(file) && !kinds.has(file)) { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } return { type: kinds.get(file) ?? "file", size: 8 }; },
    createParentDirectory: async () => undefined,
    readDirectory: async () => state.children,
    movePath: async (source, options) => { changes.push({ operation: "move", source, ...options }); files.set(options.destination, files.get(source)!); files.delete(source); },
    deletePath: async (file, options) => { changes.push({ operation: "delete", path: file, ...options }); files.delete(file); },
  };
  return Object.assign(state, { files, kinds, changes, host, run: (handler: Handler, args: Record<string, unknown>) => runWithToolWorkspaceHost(host, () => handler(args)) });
}
