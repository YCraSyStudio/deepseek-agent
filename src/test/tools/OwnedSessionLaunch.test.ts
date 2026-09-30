import assert from "node:assert/strict";
import { launchOwnedSession } from "@/infrastructure/capture/OwnedSessionLaunch";
suite("Owned browser session lifecycle", () => {
  test("stops an owned session arriving after cancellation and releases its listener after launch settles", async () => {
    const controller = new AbortController(); let receive: (session: string) => void = () => {}; let finish: (ok: boolean) => void = () => {};
    let disposed = false; const stopped: string[] = [];
    const pending = launchOwnedSession<string>({ signal: controller.signal,
      subscribe(onSession) {receive = onSession; return { dispose() {disposed = true;} };},
      launch: () => new Promise<boolean>((resolve) => {finish = resolve;}), async stop(session) {stopped.push(session);},
    });
    controller.abort(); await assert.rejects(pending, /cancelled/);
    assert.equal(disposed, false);
    receive("late-owned-session"); finish(true); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(stopped, ["late-owned-session"]); assert.equal(disposed, true);
  });
  test("successful capture disposal stops its session only once", async () => {
    let receive: (session: string) => void = () => {}; let count = 0;
    const pending = launchOwnedSession<string>({ signal: new AbortController().signal,
      subscribe(onSession) {receive = onSession; return { dispose() {} };},
      launch() {receive("owned"); return Promise.resolve(true);}, async stop() {count++;},
    });
    const owned = await pending; await owned.dispose(); await owned.dispose();
    assert.equal(owned.session, "owned"); assert.equal(count, 1);
  });
  test("times out a launch that does not settle without losing ownership of a late session", async () => {
    let receive: (session: string) => void = () => {}; let count = 0;
    await assert.rejects(launchOwnedSession<string>({ signal: new AbortController().signal, timeoutMs: 5,
      subscribe(onSession) {receive = onSession; return { dispose() {} };}, launch: () => new Promise(() => {}), async stop() {count++;},
    }), /timed out/);
    receive("late"); await Promise.resolve(); assert.equal(count, 1);
  });
});
