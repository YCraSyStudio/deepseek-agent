import { randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import type { MobileWorkspaceFailure, MobileWorkspaceListing } from "@/contracts/messages/MobileWorkspace";
import { WEBVIEW_PROTOCOL_VERSION } from "@/contracts";
import { QuickChatError, QuickChatSession } from "@/application/chat/QuickChatSession";
import type { ModelProviderFactory, SecretStore, SettingsRepository } from "@/application/ports";
import { MobileError, MobileWorkspace } from "./MobileWorkspace";
import type { MobileWebviewBridge } from "./MobileWebviewBridge";
import type { WebviewProvider } from "@/vscode/webviews/WebviewProvider";

const port = 43189;
const maxRequestBytes = 800 * 1024;
const codeDirectory = join(homedir(), ".deepseek-agent");
const codeFile = join(codeDirectory, "mobile-ide-code");

async function publishCode(code: string): Promise<void> {
  await fs.mkdir(codeDirectory, { recursive: true, mode: 0o700 });
  await fs.writeFile(codeFile, `${code}\n`, { mode: 0o600 });
}

async function retractCode(): Promise<void> {
  await fs.rm(codeFile, { force: true }).catch(() => undefined);
}

export function registerMobileIde(
  context: vscode.ExtensionContext,
  provider: WebviewProvider,
  bridge: MobileWebviewBridge,
  settings: SettingsRepository,
  secrets: SecretStore,
  models: ModelProviderFactory,
): void {
  let active: ReturnType<typeof createSession> | undefined;
  let starting: AbortController | undefined;
  const stop = () => {
    starting?.abort();
    active?.dispose();
    active = undefined;
    void retractCode();
  };

  context.subscriptions.push(
    { dispose: stop },
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (active && !vscode.workspace.workspaceFolders?.some(folder => folder.uri.toString() === active?.folder.uri.toString())) { stop(); }
    }),
    vscode.commands.registerCommand("deepseek-agent.mobileIde.start", async () => {
      if (starting) { return; }
      if (!vscode.workspace.isTrusted || vscode.env.remoteName) {
        void vscode.window.showErrorMessage("Abre una carpeta local de confianza en VS Code para iniciar el IDE móvil.");
        return;
      }
      if (!active) {
        const startup = new AbortController();
        starting = startup;
        try {
          const folders = vscode.workspace.workspaceFolders?.filter(folder => folder.uri.scheme === "file") ?? [];
          const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick();
          if (folder?.uri.scheme !== "file") {
            if (folders.length === 0) { void vscode.window.showErrorMessage("Abre una carpeta local con Git para iniciar el IDE móvil."); }
            return;
          }
          const workspace = new MobileWorkspace(folder);
          await workspace.files();
          if (startup.signal.aborted) { return; }
          const session = createSession(context.extensionUri.fsPath, provider, bridge, workspace, settings, secrets, models);
          await session.listen();
          if (startup.signal.aborted) { session.dispose(); return; }
          await publishCode(session.token);
          active = session;
        } catch (error) {
          const detail = error instanceof MobileError ? error.message : `Comprueba que el puerto ${port} esté libre.`;
          void vscode.window.showErrorMessage(`No se pudo iniciar el IDE móvil. ${detail}`);
          return;
        } finally {
          starting = undefined;
        }
      }
      const session = active;
      const action = await vscode.window.showInformationMessage(
        `IDE móvil activo para ${session.folder.name} en 127.0.0.1:${port}.`, "Copiar código", "Abrir en este PC", "Abrir mediante ASP.NET",
      );
      if (active !== session) { return; }
      if (action === "Copiar código") { await vscode.env.clipboard.writeText(session.token); }
      if (action === "Abrir en este PC") { await vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${port}/ui/?code=${session.token}`)); }
      if (action === "Abrir mediante ASP.NET") { await vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:43190/ui/?code=${session.token}`)); }
    }),
    vscode.commands.registerCommand("deepseek-agent.mobileIde.stop", () => {
      stop();
      void vscode.window.showInformationMessage("IDE móvil detenido.");
    }),
  );
}

function createSession(
  extensionRoot: string,
  provider: WebviewProvider,
  bridge: MobileWebviewBridge,
  workspace: MobileWorkspace,
  settings: SettingsRepository,
  secrets: SecretStore,
  models: ModelProviderFactory,
) {
  const bundleRoot = join(extensionRoot, "dist", "webview");
  let attached = false;
  const token = randomBytes(24).toString("base64url");
  const lifetime = new AbortController();
  const quickChat = new QuickChatSession(settings, secrets, models);
  const eventLog: { id: number; message: unknown }[] = [];
  const clients = new Set<(id: number, message: unknown) => void>();
  let nextEventId = 1;
  let streaming: { dispose: () => void } | undefined;
  const startStream = (): void => {
    if (streaming) { return; }
    streaming = bridge.addSender((message: unknown) => {
      const id = nextEventId++;
      eventLog.push({ id, message });
      if (eventLog.length > 200) { eventLog.shift(); }
      for (const write of clients) { write(id, message); }
    });
  };
  const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, (request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (response.destroyed || response.writableEnded) { return; }
      if (response.headersSent) { response.destroy(); return; }
      const failure = error instanceof MobileError ? error : new MobileError(500, "La operación ha fallado en el PC.");
      json(response, failure.status, { error: failure.message, code: failure.code } satisfies MobileWorkspaceFailure);
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/ui")) {
      response.writeHead(302, { Location: `/ui/${url.search}` });
      response.end();
      return;
    }
    if (url.pathname.startsWith("/ui/")) {
      await serveUi(request, response, url);
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      if (request.method === "GET") {
        url.pathname = `/ui${url.pathname}`;
        await serveUi(request, response, url);
        return;
      }
      throw new MobileError(404, `Ruta no disponible: ${request.method} ${url.pathname}`);
    }
    const received = Buffer.from(request.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${token}`);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new MobileError(401, "El código no es válido. Copia el código actual desde VS Code.");
    }
    if (request.headers["sec-fetch-site"] === "cross-site" || lifetime.signal.aborted) {
      throw new MobileError(403, "La sesión no está disponible.");
    }
    workspace.requireWorkspace();

    if (request.method === "GET" && url.pathname === "/api/files") {
      json(response, 200, { workspace: workspace.root.name, files: await workspace.files(), messages: quickChat.transcript });
      return;
    }
    const file = url.searchParams.get("path") ?? "";
    if (request.method === "GET" && url.pathname === "/api/changes") {
      json(response, 200, { changes: await workspace.changes() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/diff") {
      json(response, 200, await workspace.diff(file));
      return;
    }
    if (url.pathname === "/api/file" && await serveFile(request, response, file)) { return; }
    if (request.method === "POST" && url.pathname === "/api/chat") {
      const input = await readInput(request);
      if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 8000) {
        throw new MobileError(400, "Escribe un mensaje de hasta 8.000 caracteres.");
      }
      const closed = new AbortController();
      response.once("close", () => closed.abort());
      if (response.destroyed) { return; }
      const signal = AbortSignal.any([lifetime.signal, closed.signal, AbortSignal.timeout(90_000)]);
      try {
        json(response, 200, { answer: await quickChat.send(input.prompt, signal) });
      } catch (error) {
        if (!(error instanceof QuickChatError)) { throw error; }
        switch (error.reason) {
          case "busy": throw new MobileError(409, "Hay una consulta en curso.");
          case "missingKey": throw new MobileError(422, "Configura la clave API de DeepSeek en la extensión.");
          case "providerError": throw new MobileError(502, "DeepSeek no respondió. Comprueba la configuración del proveedor o vuelve a intentarlo.");
          case "emptyAnswer": throw new MobileError(502, "DeepSeek no devolvió texto.");
        }
      }
      return;
    }
    throw new MobileError(404, "Ruta no disponible.");
  }

  async function serveFile(request: IncomingMessage, response: ServerResponse, file: string): Promise<boolean> {
    if (request.method === "GET") {
      json(response, 200, await workspace.read(file));
      return true;
    }
    if (request.method === "PUT") {
      const input = await readInput(request);
      if (typeof input.text !== "string" || typeof input.revision !== "string") {
        throw new MobileError(400, "Guardado no válido.");
      }
      if (lifetime.signal.aborted) { throw new MobileError(403, "La sesión se ha cerrado."); }
      await workspace.save(file, input.text, input.revision, lifetime.signal);
      json(response, 200, await workspace.read(file));
      return true;
    }
    return false;
  }

  function matches(candidate: string | null | undefined): boolean {
    if (!candidate) { return false; }
    const received = Buffer.from(candidate);
    const expected = Buffer.from(token);
    return received.length === expected.length && timingSafeEqual(received, expected);
  }

  function allowed(request: IncomingMessage, url: URL): boolean {
    if (matches(url.searchParams.get("code"))) { return true; }
    const header = Buffer.from(request.headers.authorization ?? "");
    const bearer = Buffer.from(`Bearer ${token}`);
    if (header.length === bearer.length && timingSafeEqual(header, bearer)) { return true; }
    const cookie = /(?:^|;\s*)mobile_ide=([^;]+)/.exec(request.headers.cookie ?? "");
    return matches(cookie ? decodeURIComponent(cookie[1]) : undefined);
  }

  async function ensureAttached(): Promise<void> {
    if (attached) { return; }
    attached = true;
    try {
      await provider.ensureMobileView();
    } catch {
      attached = false;
      throw new MobileError(500, "La interfaz del PC no está disponible.");
    }
  }

  async function serveUi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    if (!allowed(request, url)) {
      throw new MobileError(401, "El código no es válido. Copia el código actual desde VS Code.");
    }
    if (url.pathname === "/ui/workspace/files" || url.pathname === "/ui/workspace/file") {
      if (request.headers["sec-fetch-site"] === "cross-site" ||
          request.headers["x-ycrasy-workspace"] !== "1" || lifetime.signal.aborted) {
        throw new MobileError(403, "La sesión no está disponible.");
      }
      workspace.requireWorkspace();
      if (request.method === "GET" && url.pathname.endsWith("/files")) {
        json(response, 200, { workspace: workspace.root.name, rootUri: workspace.root.uri.toString(), files: await workspace.files() } satisfies MobileWorkspaceListing);
        return;
      }
      if (url.pathname.endsWith("/file") && await serveFile(request, response, url.searchParams.get("path") ?? "")) {
        return;
      }
      throw new MobileError(404, "Ruta no disponible.");
    }
    if (request.method === "GET" && url.pathname === "/ui/") {
      await ensureAttached();
      const html = await fs.readFile(join(bundleRoot, "index.html"), "utf8").catch(() => {
        throw new MobileError(500, "Compila la interfaz de la extensión antes de abrirla en el móvil.");
      });
      if (url.searchParams.get("code")) {
        response.setHeader("Set-Cookie", `mobile_ide=${token}; HttpOnly; SameSite=Strict; Path=/ui`);
      }
      response.setHeader("Content-Security-Policy", uiPolicy);
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(withShim(html));
      return;
    }
    if (request.method === "GET" && url.pathname === "/ui/shim.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
      response.end(shimSource);
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/ui/assets/")) {
      const name = url.pathname.slice("/ui/assets/".length);
      if (!/^[\w.-]+$/.test(name) || name.includes("..")) {
        throw new MobileError(404, "Ruta no disponible.");
      }
      const body = await fs.readFile(join(bundleRoot, "assets", name)).catch(() => {
        throw new MobileError(404, "Ruta no disponible.");
      });
      response.writeHead(200, {
        "Content-Type": assetType(name),
        "Cache-Control": "public, max-age=31536000, immutable",
      });
      response.end(body);
      return;
    }
    if (request.method === "POST" && url.pathname === "/ui/post") {
      bridge.receive(await readInput(request));
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/ui/events") {
      await ensureAttached();
      startStream();
      response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive" });
      response.write(": connected\n\n");
      const write = (id: number, message: unknown) => {
        if (!response.writableEnded) { response.write(`id: ${id}\ndata: ${JSON.stringify(message)}\n\n`); }
      };
      const resumed = Number(request.headers["last-event-id"] ?? "0");
      if (Number.isFinite(resumed) && resumed > 0) {
        for (const entry of eventLog) {
          if (entry.id > resumed) { write(entry.id, entry.message); }
        }
      }
      clients.add(write);
      const keepAlive = setInterval(() => {
        if (!response.writableEnded) { response.write(": keep-alive\n\n"); }
      }, 15_000);
      const stop = () => {
        clearInterval(keepAlive);
        clients.delete(write);
      };
      request.on("close", stop);
      response.on("close", stop);
      return;
    }
    throw new MobileError(404, "Ruta no disponible.");
  }

  return {
    folder: workspace.root,
    token,
    listen: () => new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    }),
    dispose: () => {
      lifetime.abort();
      streaming?.dispose();
      clients.clear();
      server.close();
      server.closeAllConnections();
    },
  };
}

const uiPolicy = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const shimSource = [
  "(function () {",
  `  var protocolVersion = ${WEBVIEW_PROTOCOL_VERSION};`,
  "  function reportBootFailure() {",
  '    var status = document.getElementById("mobile-boot-status");',
  '    if (status) { status.textContent = "No se pudo cargar la interfaz. Actualiza Android System WebView o vuelve a conectar."; }',
  "  }",
  '  window.addEventListener("error", reportBootFailure, true);',
  '  window.addEventListener("unhandledrejection", reportBootFailure);',
  "  var bootTimeout = setTimeout(reportBootFailure, 15000);",
  '  document.addEventListener("DOMContentLoaded", function () {',
  '    var root = document.getElementById("root");',
  '    var status = document.getElementById("mobile-boot-status");',
  "    if (!root || !status) { return; }",
  "    var observer = new MutationObserver(didMount);",
  "    observer.observe(root, { childList: true, subtree: true });",
  "    didMount();",
  "    function didMount() {",
  '      if (!root.querySelector(".workspaceWorkbench")) { return; }',
  "      observer.disconnect();",
  "      clearTimeout(bootTimeout);",
  "      status.remove();",
  "    }",
  "  });",
  '  var storageKey = "mobile-ide-view-state";',
  "  var state;",
  "  try {",
  "    var saved = window.localStorage.getItem(storageKey);",
  "    if (saved) { state = JSON.parse(saved); }",
  "  } catch (error) { state = undefined; }",
  "  var pending = Promise.resolve();",
  "  var ready = false;",
  "  var sent = {};",
  "  var attempts = {};",
  "  var order = [];",
  "  var queued = new Set();",
  "  function keyOf(message) {",
  '    if (!message || typeof message !== "object") { return undefined; }',
  "    var id = message.clientRequestId;",
  '    if (id === undefined || id === null) { id = message.requestId; }',
  '    if (id !== undefined && id !== null) { return "id:" + String(id); }',
  '    if (message.type === "getConfig" || message.type === "configLoaded") { return "settings"; }',
  '    if (message.type === "getHistory" || message.type === "history" || message.type === "historyError") { return "history"; }',
  "  }",
  "  function transmit(message) {",
  '    var key = message.type === "initializeProtocol" ? "handshake" : keyOf(message);',
  "    if (key !== undefined && queued.has(key)) { return; }",
  "    if (key !== undefined) { queued.add(key); }",
  "    pending = pending.then(async function () {",
  "      var controller = new AbortController();",
  "      var timeout = setTimeout(function () { controller.abort(); }, 12000);",
  "      try {",
  '        var response = await fetch("/ui/post", {',
  '          method: "POST",',
  '          headers: { "Content-Type": "application/json" },',
  "          body: JSON.stringify(message),",
  "          signal: controller.signal,",
  "        });",
  '        if (!response.ok) { throw new Error("HTTP " + response.status); }',
  "      } catch (error) {",
  '        console.warn("Mobile IDE request failed", message.type, error);',
  "      } finally {",
  "        clearTimeout(timeout);",
  "        if (key !== undefined) { queued.delete(key); }",
  "      }",
  "    });",
  "  }",
  "  function handshake() {",
  '    transmit({ type: "initializeProtocol", protocolVersion: protocolVersion });',
  "  }",
  "  function post(message) {",
  "    var key = keyOf(message);",
  "    if (key !== undefined) {",
  "      if (!sent[key]) { order.push(key); }",
  "      sent[key] = message;",
  "      attempts[key] = 0;",
  "      if (order.length > 100) { delete sent[order.shift()]; }",
  "    }",
  "    transmit(message);",
  "  }",
  "  function retry(data) {",
  "    var key = data ? keyOf(data) : undefined;",
  "    ready = false;",
  "    handshake();",
  "    if (key !== undefined && sent[key]) { transmit(sent[key]); }",
  "  }",
  "  handshake();",
  '  var source = new EventSource("/ui/events");',
  "  source.onopen = function () {",
  "    if (!ready) { handshake(); }",
  "    for (var key in sent) {",
  '      if (Object.prototype.hasOwnProperty.call(sent, key) && typeof sent[key].type === "string" && sent[key].type.indexOf("get") === 0) { transmit(sent[key]); }',
  "    }",
  "  };",
  "  source.onerror = function () { ready = false; };",
  "  setInterval(function () {",
  "    if (!ready) { handshake(); }",
  "    for (var key in sent) {",
  "      if (!Object.prototype.hasOwnProperty.call(sent, key)) { continue; }",
  "      var message = sent[key];",
  '      if (!message || typeof message.type !== "string" || message.type.indexOf("get") !== 0) { continue; }',
  "      attempts[key] = (attempts[key] || 0) + 1;",
  "      if (attempts[key] > 6) { delete sent[key]; delete attempts[key]; continue; }",
  "      transmit(message);",
  "    }",
  "  }, 5000);",
  '  document.addEventListener("visibilitychange", function () {',
  '    if (document.visibilityState === "visible" && !ready) { handshake(); }',
  "  });",
  '  source.addEventListener("message", function (event) {',
  "    var data;",
  "    try { data = JSON.parse(event.data); } catch (error) { return; }",
  "    var answered = data ? keyOf(data) : undefined;",
  '    if (data && data.type === "protocolReady") {',
  "      ready = true;",
  '    } else if (data && data.type === "requestRejected" && typeof data.error === "string" &&',
  '      data.error.indexOf("protocol has not been initialized") >= 0) {',
  "      retry(data);",
  "    } else if (answered !== undefined && sent[answered]) {",
  "      delete sent[answered]; delete attempts[answered];",
  "    }",
  '    window.dispatchEvent(new MessageEvent("message", { data: data }));',
  "  });",
  "  window.acquireVsCodeApi = function () {",
  "    return {",
  "      postMessage: function (message) { post(message); },",
  "      getState: function () { return state; },",
  "      setState: function (next) {",
  "        state = next;",
  "        try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch (error) { return next; }",
  "        return next;",
  "      },",
  "    };",
  "  };",
  "})();",
  "",
].join("\n");

function withShim(html: string): string {
  return html
    .replace(/<html(?=[\s>])/i, "<html data-mobile-workspace")
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/i, "")
    .replace(/<head>/i, '<head>\n    <script src="/ui/shim.js"></script>')
    .replace('<div id="root"></div>', '<p id="mobile-boot-status" role="status">Cargando la interfaz…</p><div id="root"></div>');
}

function assetType(name: string): string {
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  switch (extension) {
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".woff2":
      return "font/woff2";
    case ".woff":
      return "font/woff";
    case ".ttf":
      return "font/ttf";
    case ".png":
      return "image/png";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

async function readInput(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers["content-type"] !== "application/json") { throw new MobileError(415, "Formato no válido."); }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > maxRequestBytes) {
      request.resume();
      throw new MobileError(413, "La solicitud excede el tamaño admitido.");
    }
    chunks.push(bytes);
  }
  try {
    const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (input && typeof input === "object" && !Array.isArray(input)) { return input as Record<string, unknown>; }
  } catch {
    throw new MobileError(400, "JSON no válido.");
  }
  throw new MobileError(400, "Se esperaba un objeto JSON.");
}

function json(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}
