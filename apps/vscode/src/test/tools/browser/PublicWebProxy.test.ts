import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { createServer, Socket } from "node:net";
import type { AddressInfo, Server } from "node:net";
import { createPublicWebProxy } from "@/infrastructure/browser/PublicWebProxy";

const require = createRequire(import.meta.url);
const net = require("node:net") as typeof import("node:net");
const dns = require("node:dns/promises") as typeof import("node:dns/promises");

suite("public web proxy tunnel lifecycle", () => {
  const originalConnect = net.connect;
  const originalLookup = dns.lookup;
  let echo: Server; let port: number; let upstream: Socket | undefined;
  let controller: AbortController; let proxy: Awaited<ReturnType<typeof createPublicWebProxy>>;
  let client: Socket | undefined; let captured: unknown;
  let mode: "normal" | "error" | "timeout" | "delayed";
  setup(async () => {
    mode = "normal"; upstream = undefined; client = undefined; captured = undefined;
    echo = createServer(socket => { socket.on("error", () => undefined); socket.pipe(socket); });
    await new Promise<void>((resolve, reject) => { echo.once("error", reject); echo.listen(0, "127.0.0.1", resolve); });
    port = (echo.address() as AddressInfo).port;
    net.connect = ((options: unknown) => {
      captured = options;
      const socket = mode === "delayed" ? new Socket() : originalConnect({ host: "127.0.0.1", port });
      upstream = socket;
      if (mode === "error") { queueMicrotask(() => socket.emit("error", new Error("upstream unavailable"))); }
      if (mode === "timeout") {
        socket.setTimeout = ((_ms: number, callback: () => void) => { queueMicrotask(callback); return socket; }) as Socket["setTimeout"];
      }
      return socket;
    }) as typeof net.connect;
    dns.lookup = (async () => [{ address: "1.1.1.1", family: 4 }]) as unknown as typeof dns.lookup;
    syncBuiltinESMExports(); controller = new AbortController(); proxy = await createPublicWebProxy(controller.signal);
  });
  teardown(async () => {
    client?.destroy(); upstream?.destroy();
    await proxy?.close(); await new Promise<void>(resolve => echo.close(() => resolve()));
    net.connect = originalConnect; dns.lookup = originalLookup; syncBuiltinESMExports();
  });
  async function open() {
    const url = new URL(proxy.url); client = new Socket(); client.on("error", () => undefined);
    await new Promise<void>((resolve, reject) => { client!.once("error", reject); client!.connect(Number(url.port), url.hostname, resolve); });
    return client;
  }
  async function until(check: () => boolean) {
    for (let i = 0; i < 100 && !check(); i++) { await new Promise(resolve => setTimeout(resolve, 2)); }
    assert.equal(check(), true, "Expected tunnel lifecycle event");
  }
  for (const head of ["", "initial bytes"]) {
    test(`pins the validated destination and relays both directions with initial bytes=${Boolean(head)}`, async () => {
      const socket = await open(); let received = "";
      socket.on("data", data => { received += data.toString(); });
      socket.write(`CONNECT public.example.com:443 HTTP/1.1\r\nHost: public.example.com\r\n\r\n${head}`);
      await until(() => received.includes("200 Connection Established") && received.includes(head));
      assert.deepEqual(captured, { host: "1.1.1.1", family: 4, port: 443 });
      socket.write("follow-up bytes"); await until(() => received.includes("follow-up bytes"));
      socket.destroy(); await until(() => Boolean(upstream?.destroyed));
    });
  }
  for (const failure of ["error", "timeout"] as const) {
    test(`closes the client and upstream after an upstream ${failure}`, async () => {
      mode = failure; const socket = await open(); const closed = new Promise<void>(resolve => socket.once("close", () => resolve()));
      socket.write("CONNECT public.example.com:443 HTTP/1.1\r\nHost: public.example.com\r\n\r\n");
      await closed; assert.equal(upstream?.destroyed, true);
    });
  }
  test("discards a late upstream connection after its client has disconnected", async () => {
    mode = "delayed"; const socket = await open();
    socket.write("CONNECT public.example.com:443 HTTP/1.1\r\nHost: public.example.com\r\n\r\n");
    await until(() => Boolean(upstream)); socket.resetAndDestroy(); await until(() => Boolean(upstream?.destroyed));
    upstream!.emit("connect"); assert.equal(upstream!.destroyed, true);
  });
  test("aborting its owner closes an established tunnel and refuses pre-cancelled startup", async () => {
    const socket = await open(); let received = ""; socket.on("data", data => { received += data.toString(); });
    socket.write("CONNECT public.example.com:443 HTTP/1.1\r\nHost: public.example.com\r\n\r\n");
    await until(() => received.includes("200 Connection Established"));
    const closed = new Promise<void>(resolve => socket.once("close", () => resolve()));
    controller.abort(new Error("owner disposed")); await closed;
    assert.equal(upstream?.destroyed, true);
    const cancelled = new AbortController(); cancelled.abort(new Error("already cancelled"));
    await assert.rejects(createPublicWebProxy(cancelled.signal), /already cancelled/);
  });
});
