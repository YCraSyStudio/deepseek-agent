import assert from "node:assert/strict";
import { NativeDebugAnchor } from "@/vscode/tools/capture/NativeDebugAnchor";
import { debug, resetVsCodeMock } from "../../../support/VsCodeMock";

suite("native debug capture process anchor", () => {
  let anchor: NativeDebugAnchor;
  setup(() => { resetVsCodeMock(); anchor = new NativeDebugAnchor(); });
  teardown(() => { anchor.dispose(); resetVsCodeMock(); });
  test("tracks valid process events per session and prefers them to configured process IDs", () => {
    const first = { id: "first", configuration: { processId: "100" } };
    const second = { id: "second", configuration: { processId: "200" } };
    const factory = debug.trackerFactories.get("*")!;
    factory.createDebugAdapterTracker(first).onDidSendMessage({ event: "process", body: { systemProcessId: 123 } });
    factory.createDebugAdapterTracker(second).onDidSendMessage({ event: "process", body: { systemProcessId: 456 } });
    debug.activeDebugSession = first; assert.equal(anchor.pid(), 123);
    debug.activeDebugSession = second; assert.equal(anchor.pid(), 456);
    debug.terminate(first); debug.activeDebugSession = first; assert.equal(anchor.pid(), 100);
    debug.activeDebugSession = second; assert.equal(anchor.pid(), 456);
  });
  test("ignores malformed process events without replacing a known valid process", () => {
    const session = { id: "session", configuration: {} }; debug.activeDebugSession = session;
    const tracker = debug.trackerFactories.get("*")!.createDebugAdapterTracker(session);
    for (const message of [null, {}, { event: "output", body: { systemProcessId: 88 } }, { event: "process" },
      ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "42", null].map(systemProcessId => ({ event: "process", body: { systemProcessId } }))]) {
      tracker.onDidSendMessage(message); assert.equal(anchor.pid(), undefined);
    }
    tracker.onDidSendMessage({ event: "process", body: { systemProcessId: 99 } });
    tracker.onDidSendMessage({ event: "process", body: { systemProcessId: -1 } }); assert.equal(anchor.pid(), 99);
  });
  test("validates configured IDs, handles no active session and disposes registrations and tracked state", () => {
    assert.equal(anchor.pid(), undefined);
    for (const processId of [undefined, null, 0, -1, "invalid", Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      debug.activeDebugSession = { id: "configured", configuration: { processId } }; assert.equal(anchor.pid(), undefined);
    }
    debug.activeDebugSession = { id: "configured", configuration: { processId: "321" } }; assert.equal(anchor.pid(), 321);
    const session = { id: "tracked", configuration: {} }; debug.activeDebugSession = session;
    debug.trackerFactories.get("*")!.createDebugAdapterTracker(session).onDidSendMessage({ event: "process", body: { systemProcessId: 77 } });
    anchor.dispose(); assert.equal(debug.trackerFactories.size, 0); assert.equal(anchor.pid(), undefined);
    debug.terminate(session); assert.equal(anchor.pid(), undefined);
  });
});
