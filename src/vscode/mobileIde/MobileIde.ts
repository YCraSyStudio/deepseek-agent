import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import * as vscode from "vscode";
import type { AppConfig, ChatMessage } from "@/contracts";
import { getTextContent } from "@/contracts/deepseek/Chat";
import type { ModelProviderFactory, SecretStore, SettingsRepository } from "@/application/ports";
import { MobileError, MobileWorkspace } from "./MobileWorkspace";
import { mobileAssets } from "./MobilePage";

const port = 43189;
const maxRequestBytes = 800 * 1024;

export function registerMobileIde(
  context: vscode.ExtensionContext,
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
          const session = createSession(workspace, settings, secrets, models);
          await session.listen();
          if (startup.signal.aborted) { session.dispose(); return; }
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
        `IDE móvil activo para ${session.folder.name} en 127.0.0.1:${port}.`, "Copiar código", "Abrir en este PC",
      );
      if (active !== session) { return; }
      if (action === "Copiar código") { await vscode.env.clipboard.writeText(session.token); }
      if (action === "Abrir en este PC") { await vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${port}/`)); }
    }),
    vscode.commands.registerCommand("deepseek-agent.mobileIde.stop", () => {
      stop();
      void vscode.window.showInformationMessage("IDE móvil detenido.");
    }),
  );
}

function createSession(workspace: MobileWorkspace, settings: SettingsRepository, secrets: SecretStore, models: ModelProviderFactory) {
  const token = randomBytes(24).toString("base64url");
  const lifetime = new AbortController();
  const messages: ChatMessage[] = [];
  let chatting = false;
  const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, (request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (response.destroyed || response.writableEnded) { return; }
      if (response.headersSent) { response.destroy(); return; }
      const failure = error instanceof MobileError ? error : new MobileError(500, "La operación ha fallado en el PC.");
      json(response, failure.status, { error: failure.message });
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const asset = mobileAssets.get(url.pathname);
    if (request.method === "GET" && asset) {
      response.writeHead(200, { "Content-Type": asset.type });
      response.end(asset.body);
      return;
    }
    if (!url.pathname.startsWith("/api/")) { throw new MobileError(404, "Ruta no disponible."); }
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
      json(response, 200, { workspace: workspace.root.name, files: await workspace.files(), messages });
      return;
    }
    const file = url.searchParams.get("path") ?? "";
    if (request.method === "GET" && url.pathname === "/api/file") {
      json(response, 200, await workspace.read(file));
      return;
    }
    if (request.method === "PUT" && url.pathname === "/api/file") {
      const input = await readInput(request);
      if (typeof input.text !== "string" || typeof input.revision !== "string") {
        throw new MobileError(400, "Guardado no válido.");
      }
      if (lifetime.signal.aborted) { throw new MobileError(403, "La sesión se ha cerrado."); }
      await workspace.save(file, input.text, input.revision, lifetime.signal);
      json(response, 200, await workspace.read(file));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/chat") {
      const input = await readInput(request);
      if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 8000) {
        throw new MobileError(400, "Escribe un mensaje de hasta 8.000 caracteres.");
      }
      if (chatting) { throw new MobileError(409, "Hay una consulta en curso."); }
      chatting = true;
      try {
        const config: AppConfig = settings.load();
        const apiKey = await secrets.getApiKey(config.baseUrl);
        if (!apiKey) { throw new MobileError(422, "Configura la clave API de DeepSeek en la extensión."); }
        const user: ChatMessage = { role: "user", content: input.prompt.trim() };
        const closed = new AbortController();
        response.once("close", () => closed.abort());
        if (response.destroyed) { return; }
        const signal = AbortSignal.any([lifetime.signal, closed.signal, AbortSignal.timeout(90_000)]);
        const completion = await models.create({ ...config, apiKey }).chatCompletion({
          model: config.model,
          messages: [...messages, user],
          max_tokens: Math.min(config.maxTokens, 2048),
        }, signal).catch(() => { throw new MobileError(502, "DeepSeek no respondió. Comprueba la configuración del proveedor o vuelve a intentarlo."); });
        const answer = getTextContent(completion.choices[0]?.message.content);
        if (!answer) { throw new MobileError(502, "DeepSeek no devolvió texto."); }
        messages.push(user, { role: "assistant", content: answer });
        if (messages.length > 12) { messages.splice(0, 2); }
        json(response, 200, { answer });
      } finally {
        chatting = false;
      }
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
      server.close();
      server.closeAllConnections();
    },
  };
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
