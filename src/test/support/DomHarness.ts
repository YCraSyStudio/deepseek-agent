import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, type ReactElement } from "react";
import type { Root } from "react-dom/client";

let active: { posts: Array<Record<string, unknown>>; state?: unknown; dom: JSDOM } | undefined;
const bridge = {
  postMessage(message: unknown) {
    const host = active; assert.ok(host);
    const post = message as Record<string, unknown>; host.posts.push(post);
    if (post.type === "chatDraft") {
      queueMicrotask(() => host.dom.window.dispatchEvent(new host.dom.window.MessageEvent("message", {
        data: { type: "chatDraftResult", requestId: post.requestId, operation: post.operation },
      })));
    }
  },
  getState<T>() { return active?.state as T | undefined; },
  setState<T>(state: T) { assert.ok(active); active.state = state; return state; },
};

/** Actual React tree and DOM events; only host transport and layout APIs are substituted. */
export async function createDomHarness() {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://webview.test", pretendToBeVisual: true });
  const posts: Array<Record<string, unknown>> = [];
  const original = new Map<string, PropertyDescriptor | undefined>();
  const host = { dom, posts, state: undefined as unknown }; active = host;
  Object.assign(dom.window, { acquireVsCodeApi: () => bridge });
  class ResizeObserver {
    observe() {} unobserve() {} disconnect() {}
  }
  Object.assign(dom.window.HTMLElement.prototype, { scrollIntoView() {}, scrollTo(this: HTMLElement, options: ScrollToOptions) { this.scrollTop = options.top ?? this.scrollTop; } });
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
    HTMLImageElement: dom.window.HTMLImageElement, MutationObserver: dom.window.MutationObserver,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
    File: dom.window.File, FileReader: dom.window.FileReader,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    ResizeObserver, IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [name, value] of Object.entries(globals)) {
    original.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  const container = dom.window.document.getElementById("root")!;
  const { createRoot } = await import("react-dom/client");
  const root: Root = createRoot(container);
  const query = <T extends Element = HTMLElement>(selector: string): T => {
    const element = container.querySelector<T>(selector); assert.ok(element, `Missing ${selector}\n${container.innerHTML.slice(0,1500)}`); return element;
  };
  return {
    dom, posts, host, root, container, query,
    async render(element: ReactElement) { await act(async () => { root.render(element); }); },
    async message(data: unknown) { await act(async () => { dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data })); }); },
    async click(selector: string | HTMLElement) { await act(async () => { (typeof selector === "string" ? query<HTMLElement>(selector) : selector).click(); }); },
    async input(selector: string, value: string) {
      const element = query<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector);
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set; assert.ok(setter); setter.call(element, value);
        element.dispatchEvent(new dom.window.Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
      });
    },
    async key(selector: string, key: string, options: KeyboardEventInit = {}) {
      await act(async () => { query(selector).dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true, ...options })); });
    },
    async flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1)); }); },
    last(type: string) { const message = [...posts].reverse().find((post) => post.type === type); assert.ok(message, `Missing ${type}: ${JSON.stringify(posts)}`); return message; },
    async dispose() {
      await act(async () => { root.unmount(); });
      // Finish queued draft writes while their original window and transport exist.
      await act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)); });
      dom.window.close(); active = undefined;
      for (const [name, descriptor] of original) {
        if (descriptor) { Object.defineProperty(globalThis, name, descriptor); } else { Reflect.deleteProperty(globalThis, name); }
      }
    },
  };
}
