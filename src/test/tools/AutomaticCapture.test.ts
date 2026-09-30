import assert from "node:assert/strict";
import { automaticCapture, changedUiPaths, knownCaptureTarget } from "@/infrastructure/capture/AutomaticCapture";
import type { StoredToolCall } from "@/contracts";
import type { ScreenshotMetadata } from "@/infrastructure/images/ScreenshotStore";
const call = (path: string, status: StoredToolCall["status"] = "completed"): StoredToolCall => ({ toolCallId: path, toolName: "edit_file", arguments: "{}", status, result: JSON.stringify({ type: "fileEdit", path }) });
suite("Optional automatic capture", () => {
  test("triggers only on completed UI-facing file mutations, deduplicating paths", () => {
    assert.deepEqual(changedUiPaths([call("a.tsx"), call("a.tsx"), call("b.prefab"), call("data.cs"), call("c.css", "rejected"), { ...call("read.html"), toolName: "read_file" }]), ["a.tsx", "b.prefab"]);
    assert.deepEqual(changedUiPaths([{ ...call("a.css"), isError: true }]), []);
  });
  test("resolves known precise targets and refuses screen capture", () => {
    const metadata = { kind: "web", target: "http://localhost:3000", width: 800, height: 600 } as ScreenshotMetadata;
    assert.equal(knownCaptureTarget(metadata)?.url, metadata.target);
    assert.equal(knownCaptureTarget({ ...metadata, kind: "screen" }), undefined);
    assert.equal(knownCaptureTarget({ ...metadata, kind: "window", target: "window:0x123", pid: 123 })?.process, "123");
    assert.equal(knownCaptureTarget({ ...metadata, target: "javascript:alert(1)" }), undefined);
  });
  test("disabled mode, cap and unavailable targets never run the backend", async () => {
    let calls = 0;
    const options = { enabled: true, paths: ["a.css"], count: 0, limit: 10, capture: async () => {calls++; throw new Error("Wayland requires portal consent");} };
    assert.deepEqual(await automaticCapture({ ...options, enabled: false }), {});
    assert.match((await automaticCapture(options)).note!, /No known/);
    assert.match((await automaticCapture({ ...options, count: 10 })).note!, /limit/);
    assert.match((await automaticCapture({ ...options, unavailable: "remote workspace" })).note!, /remote/);
    assert.equal(calls, 0);
    assert.match((await automaticCapture({ ...options, target: { target: "debug" } })).note!, /Wayland/);
    assert.equal(calls, 1);
  });
});
