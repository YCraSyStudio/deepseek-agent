import assert from "node:assert/strict";
import { waitForOwnedCdpProxy } from "@/infrastructure/capture/OwnedCdpProxy";

suite("owned browser page adapter", () => {
  test("waits for the concrete owned child and never queries unrelated sessions", async () => {
    const root = { id: "launcher" };
    const child = { id: "page", parentSession: root };
    let ready = false;
    const queried: string[] = [];
    const result = await waitForOwnedCdpProxy(root, () => [{ id: "unrelated" }, child], async (session) => {
      queried.push(session.id);
      if (session.id === "launcher") {return undefined;}
      if (!ready) {ready = true; return undefined;}
      return { host: "127.0.0.1", port: 1234, path: "/owned" };
    }, new AbortController().signal);
    assert.equal(result.session.id, "page");
    assert.deepEqual(result.address, { host: "127.0.0.1", port: 1234, path: "/owned" });
    assert.ok(!queried.includes("unrelated"));
    assert.equal(queried.filter((id) => id === "launcher").length, 1);
  });

  test("an unanswered launcher cannot block its owned page adapter", async function () {
    this.timeout(5000);
    const root = { id: "launcher" };
    const child = { id: "page", parentSession: root };
    const result = await waitForOwnedCdpProxy(root, () => [child], (session) => session.id === root.id
      ? new Promise(() => {}) : Promise.resolve({ host: "127.0.0.1", port: 1234, path: "/owned" }), new AbortController().signal);
    assert.equal(result.session, child);
  });

  test("bounds an adapter request that never answers", async () => {
    await assert.rejects(waitForOwnedCdpProxy({ id: "launcher" }, () => [], () => new Promise(() => {}),
      new AbortController().signal, 10), /timeout|timed out/i);
  });
});
