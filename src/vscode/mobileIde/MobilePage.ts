const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DeepSeek Agent · IDE móvil</title>
  <link rel="stylesheet" href="/mobile.css">
  <script src="/mobile.js" defer></script>
</head>
<body>
  <main>
    <header><h1>IDE móvil</h1><p id="workspace">DeepSeek Agent</p></header>
    <form id="pair">
      <label for="token">Código de VS Code</label>
      <input id="token" type="password" autocomplete="off" required>
      <button>Conectar</button>
    </form>
    <p id="status" role="status" aria-live="polite"></p>
    <div id="ide" hidden>
      <nav aria-label="Vistas">
        <button id="show-files" type="button" aria-pressed="true">Archivos</button>
        <button id="show-chat" type="button" aria-pressed="false">Chat</button>
        <button id="disconnect" type="button">Desconectar</button>
      </nav>
      <section id="files">
        <label for="filter">Buscar por nombre o ruta</label>
        <input id="filter" type="search" spellcheck="false">
        <label for="paths">Archivos versionados</label>
        <select id="paths"></select>
        <button id="open" type="button">Abrir</button>
        <div id="document" hidden>
          <label id="filename" for="editor"></label>
          <textarea id="editor" rows="17" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off"></textarea>
          <button id="save" type="button" disabled>Guardar en el PC</button>
        </div>
      </section>
      <section id="chat" hidden>
        <div id="messages" role="log" aria-label="Mensajes"></div>
        <form id="compose">
          <label for="prompt">Pregunta para DeepSeek</label>
          <textarea id="prompt" rows="4" maxlength="8000" required></textarea>
          <button>Enviar</button>
        </form>
      </section>
    </div>
  </main>
</body>
</html>`;

const css = `
:root { color-scheme: dark; font-family: system-ui, sans-serif; background: #101623; color: #ecf1fa; }
* { box-sizing: border-box; }
body { margin: 0; }
main { width: min(100%, 55rem); margin: auto; padding: 1rem; }
header { display: flex; gap: 1rem; align-items: baseline; flex-wrap: wrap; }
h1 { font-size: 1.6rem; margin: 0; }
header p { color: #a9bbd7; overflow-wrap: anywhere; }
form, section, #document { display: grid; gap: .6rem; margin-block: 1rem; }
[hidden] { display: none !important; }
nav { display: flex; flex-wrap: wrap; gap: .4rem; }
input, select, textarea, button { padding: .6rem .75rem; border: 1px solid #687c9e; border-radius: .4rem; font: inherit; min-height: 44px; }
input, select, textarea { background: #172235; color: inherit; width: 100%; }
button { background: #263650; color: inherit; width: fit-content; }
button[aria-pressed="true"], form button, #save { background: #b3d0ff; color: #14213a; }
button:disabled { opacity: .55; }
:focus-visible { outline: 2px solid #a7e3ff; outline-offset: 2px; }
#filename { overflow-wrap: anywhere; }
#editor { font-family: ui-monospace, monospace; tab-size: 2; white-space: pre; }
#status { min-height: 1.3em; color: #ffdc9b; overflow-wrap: anywhere; }
#messages p { white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid #526684; border-radius: .4rem; padding: .75rem; }
`;

const script = String.raw`
"use strict";

const byId = id => document.getElementById(id);
const status = byId("status");
const tokenInput = byId("token");
const editor = byId("editor");
const paths = byId("paths");
const save = byId("save");
const open = byId("open");
let token = "";
let files = [];
let file;
let pending = 0;
let documentBusy = false;
let chatPending = false;

async function api(path, method = "GET", body) {
  const headers = { Authorization: "Bearer " + token };
  if (body !== undefined) { headers["Content-Type"] = "application/json"; }
  const response = await fetch("/api/" + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store", redirect: "error",
  });
  const data = await response.json();
  if (!response.ok) { throw new Error(data.error); }
  return data;
}

function refreshButtons() {
  save.disabled = documentBusy || !hasChanges();
  open.disabled = documentBusy || !paths.value;
  byId("disconnect").disabled = pending > 0;
}

function hasChanges() {
  return Boolean(file && editor.value !== file.initial);
}

async function run(action) {
  pending++;
  status.textContent = "";
  refreshButtons();
  try {
    await action();
  } catch (error) {
    status.textContent = error.message || "Comprueba la conexión con el PC.";
  } finally {
    pending--;
    refreshButtons();
  }
}

function renderFiles() {
  const query = byId("filter").value.trim().toLocaleLowerCase();
  const matches = files.filter(path => path.toLocaleLowerCase().includes(query));
  const options = matches.slice(0, 250).map(path => new Option(path, path));
  if (!options.length) { options.push(new Option("Sin resultados", "")); }
  paths.replaceChildren(...options);
  if (matches.length > 250) { status.textContent = "Mostrando 250 archivos. Acota la búsqueda."; }
  else { status.textContent = ""; }
  refreshButtons();
}

function setDocument(path, data) {
  editor.value = data.text;
  file = { path, revision: data.revision, initial: editor.value };
  byId("filename").textContent = path;
  byId("document").hidden = false;
}

function showView(showFiles) {
  byId("files").hidden = !showFiles;
  byId("chat").hidden = showFiles;
  byId("show-files").setAttribute("aria-pressed", String(showFiles));
  byId("show-chat").setAttribute("aria-pressed", String(!showFiles));
}

byId("pair").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  if (button.disabled) { return; }
  button.disabled = true;
  token = tokenInput.value.trim();
  await run(async () => {
    const data = await api("files");
    files = data.files;
    byId("messages").replaceChildren();
    for (const message of data.messages) {
      addMessage(message.role === "user" ? "Tú" : "DeepSeek", message.content);
    }
    byId("workspace").textContent = data.workspace;
    byId("pair").hidden = true;
    byId("ide").hidden = false;
    tokenInput.value = "";
    showView(true);
    renderFiles();
    byId("filter").focus();
  });
  if (byId("ide").hidden) { token = ""; }
  button.disabled = false;
});

byId("filter").addEventListener("input", renderFiles);
paths.addEventListener("change", refreshButtons);
editor.addEventListener("input", refreshButtons);
byId("show-files").addEventListener("click", () => showView(true));
byId("show-chat").addEventListener("click", () => showView(false));

async function withDocument(action) {
  documentBusy = true;
  editor.readOnly = true;
  try {
    await run(action);
  } finally {
    documentBusy = false;
    editor.readOnly = false;
    refreshButtons();
  }
}

open.addEventListener("click", async () => {
  if (documentBusy || !paths.value || (hasChanges() && !confirm("¿Descartar el borrador actual?"))) { return; }
  const path = paths.value;
  await withDocument(async () => setDocument(path, await api("file?path=" + encodeURIComponent(path))));
});

save.addEventListener("click", async () => {
  if (documentBusy || !hasChanges()) { return; }
  const { path, revision } = file;
  const text = editor.value;
  await withDocument(async () => {
    const data = await api("file?path=" + encodeURIComponent(path), "PUT", { text, revision });
    setDocument(path, data);
    status.textContent = "Guardado en el PC.";
  });
});

function addMessage(author, content) {
  const message = document.createElement("p");
  message.textContent = author + " · " + content;
  byId("messages").append(message);
}

byId("compose").addEventListener("submit", async event => {
  event.preventDefault();
  const prompt = byId("prompt");
  const value = prompt.value.trim();
  const button = event.currentTarget.querySelector("button");
  if (!value || chatPending) { return; }
  chatPending = true;
  button.disabled = true;
  prompt.readOnly = true;
  await run(async () => {
    const data = await api("chat", "POST", { prompt: value });
    addMessage("Tú", value);
    addMessage("DeepSeek", data.answer);
    prompt.value = "";
  });
  chatPending = false;
  button.disabled = false;
  prompt.readOnly = false;
});

window.addEventListener("beforeunload", event => {
  if (hasChanges()) { event.preventDefault(); event.returnValue = ""; }
});
byId("disconnect").addEventListener("click", () => {
  if (pending || (hasChanges() && !confirm("¿Descartar el borrador y desconectar?"))) { return; }
  token = "";
  files = [];
  file = undefined;
  paths.replaceChildren();
  byId("filter").value = "";
  editor.value = "";
  byId("filename").textContent = "";
  byId("document").hidden = true;
  byId("messages").replaceChildren();
  byId("prompt").value = "";
  byId("workspace").textContent = "DeepSeek Agent";
  byId("ide").hidden = true;
  byId("pair").hidden = false;
  status.textContent = "Desconectado.";
  tokenInput.focus();
});
`;

export const mobileAssets = new Map([
  ["/", { type: "text/html; charset=utf-8", body: html }],
  ["/mobile.css", { type: "text/css; charset=utf-8", body: css }],
  ["/mobile.js", { type: "text/javascript; charset=utf-8", body: script }],
]);
