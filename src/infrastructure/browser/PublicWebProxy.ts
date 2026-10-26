import { createServer } from "node:http";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { resolvePublicHostname, validatePublicWebUrl } from "./NetworkPolicy";

/** HTTPS tunnels resolve once and connect to the validated address, preventing DNS rebinding. */
export async function createPublicWebProxy(signal: AbortSignal): Promise<{ url: string; close(): Promise<void> }> {
  signal.throwIfAborted();
  const sockets = new Set<Duplex>();
  const server = createServer((_request, response) => {response.writeHead(403); response.end();});
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
  });
  server.on("connect", (request, client, head) => {
    void (async () => {
      const url = validatePublicWebUrl(`https://${request.url}/`);
      const addresses = await resolvePublicHostname(url.hostname);
      signal.throwIfAborted();
      if (client.destroyed) {return;}
      const address = addresses[0]!;
      const upstream: Socket = connect({ host: address.address, family: address.family, port: 443 });
      sockets.add(upstream);
      upstream.setTimeout(30_000, () => upstream.destroy());
      upstream.once("close", () => {sockets.delete(upstream); client.destroy();});
      upstream.on("error", () => {upstream.destroy(); client.destroy();});
      client.once("close", () => upstream.destroy());
      upstream.once("connect", () => {
        if (client.destroyed || signal.aborted) {upstream.destroy(); return;}
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) {upstream.write(head);}
        upstream.pipe(client); client.pipe(upstream);
      });
    })().catch(() => client.destroy());
  });
  const abort = () => {for (const socket of sockets) {socket.destroy();} server.close();};
  signal.addEventListener("abort", abort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {server.removeListener("error", reject); resolve();});
    });
    signal.throwIfAborted();
  } catch (error) {signal.removeEventListener("abort", abort); abort(); throw error;}
  const address = server.address();
  if (!address || typeof address === "string") {abort(); throw new Error("Could not start web network isolation");}
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      signal.removeEventListener("abort", abort);
      for (const socket of sockets) {socket.destroy();}
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
