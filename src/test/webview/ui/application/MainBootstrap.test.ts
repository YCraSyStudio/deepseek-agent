import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

suite("webview entrypoint bootstrap", () => {
  test("mounts the actual application in StrictMode and sets the document language", async function () {
    this.timeout(15000);
    // A separate static entry preserves production source mappings and prevents
    // ReactDOM from initializing in the main test process before its DOM exists.
    const entry = resolve(".tmp/unit-tests/bootstrap/Main.mjs");
    await build({ entryPoints: [resolve("src/ui/Main.tsx")], outfile: entry, bundle: true,
      platform: "node", target: "node24", format: "esm", packages: "external", sourcemap: true,
      resolveExtensions: [".ts", ".tsx", ".mjs", ".js", ".json"],
      loader: { ".css": "empty", ".svg": "dataurl", ".ttf": "dataurl" },
      alias: { "@vscode/codicons/dist/codicon.css": resolve("node_modules/@vscode/codicons/dist/codicon.css") } });
    const bootstrap = `
      import assert from 'node:assert/strict';
      import { JSDOM } from 'jsdom';
      import { act } from 'react';
      const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {url:'https://webview.test',pretendToBeVisual:true});
      const posts = [];
      dom.window.acquireVsCodeApi = () => ({postMessage: message => posts.push(message),getState:()=>undefined,setState:state=>state});
      class ResizeObserver {observe(){}disconnect(){}unobserve(){}}
      const globals = {window:dom.window,document:dom.window.document,navigator:dom.window.navigator,
        HTMLElement:dom.window.HTMLElement,Element:dom.window.Element,Node:dom.window.Node,
        HTMLInputElement:dom.window.HTMLInputElement,HTMLTextAreaElement:dom.window.HTMLTextAreaElement,
        HTMLImageElement:dom.window.HTMLImageElement,MutationObserver:dom.window.MutationObserver,
        Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,File:dom.window.File,FileReader:dom.window.FileReader,
        ResizeObserver,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window),
        getComputedStyle:dom.window.getComputedStyle.bind(dom.window),IS_REACT_ACT_ENVIRONMENT:true};
      for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{configurable:true,value});
      Object.assign(dom.window.HTMLElement.prototype,{scrollIntoView(){},scrollTo(){}});
      await act(async()=>{await import(${JSON.stringify(pathToFileURL(entry).href)});});
      assert.equal(document.documentElement.lang,'en');
      assert.equal(Boolean(document.querySelector('#root textarea')),true);
      assert.equal(Boolean(document.querySelector('.settingsBtn')),true);
      assert.equal(posts.some(post=>post.type==='getConfig'),true);
      dom.window.close();
      process.exit(0);
    `;
    const child = spawnSync(process.execPath, ["--max-old-space-size=256", "--input-type=module", "-e", bootstrap], {
      env: process.env, encoding: "utf8", timeout: 12000, maxBuffer: 64 * 1024,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr || String(child.error || child.signal));
  });
});
