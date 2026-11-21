import assert from "node:assert/strict";
import { act, createElement } from "react";
import ImageLightbox from "@webview/components/shared/imageLightbox/ImageLightbox";
import { setInterfaceLanguage } from "@webview/i18n";
import { createDomHarness } from "../../../support/DomHarness";

suite("image lightbox interactions", () => {
  let h: Awaited<ReturnType<typeof createDomHarness>>;
  let closed: number;
  setup(async () => {
    h = await createDomHarness(); closed = 0; setInterfaceLanguage("en");
    const style = h.dom.window.document.createElement("style"); style.textContent = ".imageLightboxViewport { padding: 0px; }"; h.dom.window.document.head.append(style);
    Object.defineProperties(h.dom.window.HTMLElement.prototype, {
      clientWidth: { configurable: true, get() { return 800; } }, clientHeight: { configurable: true, get() { return 600; } },
      scrollWidth: { configurable: true, get() { return Number.parseFloat(this.querySelector("img")?.style.width ?? "0") || 800; } },
      scrollHeight: { configurable: true, get() { return Number.parseFloat(this.querySelector("img")?.style.height ?? "0") || 600; } },
    });
  });
  teardown(async () => { await h.dispose(); });
  const open = async (id = "image-1") => h.render(createElement(ImageLightbox, { image: { id, name: "Screenshot", src: "data:image/png;base64,AA==" }, onClose: () => closed++ }));
  async function load() {
    const img = h.query<HTMLImageElement>("img"); Object.defineProperties(img, { naturalWidth: { value: 1600, configurable: true }, naturalHeight: { value: 1200, configurable: true } });
    await act(async () => { img.dispatchEvent(new h.dom.window.Event("load")); });
  }
  const percent = () => h.query(".imageLightboxZoomValue").textContent;

  test("closed previews render nothing and loaded images fit the viewport", async () => {
    await h.render(createElement(ImageLightbox, { image: null, onClose: () => closed++ })); assert.equal(h.container.textContent, "");
    await open(); assert.equal(percent(), "100%"); await load(); assert.equal(percent(), "50%");
    assert.equal(h.query<HTMLImageElement>("img").style.width, "800px");
    assert.equal(h.query(".imageLightboxDialog").getAttribute("aria-modal"), "true");
  });

  test("zoom buttons and keyboard aliases update the image and fit resets it", async () => {
    await open(); await load();
    await h.click(".imageLightboxClose"); assert.equal(closed, 1);
    await h.key(".imageLightboxDialog", "+"); assert.equal(percent(), "63%");
    await h.key(".imageLightboxDialog", "-"); assert.equal(percent(), "50%");
    await h.key(".imageLightboxDialog", "="); await h.key(".imageLightboxDialog", "_"); assert.equal(percent(), "50%");
    await h.click(h.container.querySelectorAll<HTMLButtonElement>(".imageLightboxZoom .imageLightboxButton")[1]!); assert.equal(percent(), "63%");
    await h.click(h.container.querySelectorAll<HTMLButtonElement>(".imageLightboxZoom .imageLightboxButton")[0]!); assert.equal(percent(), "50%");
    await h.key(".imageLightboxDialog", "+"); await h.key(".imageLightboxDialog", "0"); assert.equal(percent(), "50%");
    await h.key(".imageLightboxDialog", "+"); await h.click(".imageLightboxZoomValue"); assert.equal(percent(), "50%");
    await h.key(".imageLightboxDialog", "ArrowRight"); assert.equal(percent(), "50%");
  });

  test("zoom is bounded and switching images resets the previous zoom state", async () => {
    await open(); await load();
    for (let i = 0; i < 20; i++) { await h.key(".imageLightboxDialog", "+"); }
    assert.equal(percent(), "800%"); assert.equal(h.container.querySelectorAll<HTMLButtonElement>(".imageLightboxZoom .imageLightboxButton")[1]!.disabled, true);
    for (let i = 0; i < 30; i++) { await h.key(".imageLightboxDialog", "-"); }
    assert.equal(percent(), "10%"); assert.equal(h.container.querySelectorAll<HTMLButtonElement>(".imageLightboxZoom .imageLightboxButton")[0]!.disabled, true);
    await open("image-2"); assert.equal(percent(), "100%"); await load(); assert.equal(percent(), "50%");
  });

  test("image clicks do not dismiss, background clicks and Escape do", async () => {
    await open(); await load(); await h.click("img"); assert.equal(closed, 0);
    await h.click(".imageLightboxCanvas"); assert.equal(closed, 1);
    await h.key(".imageLightboxDialog", "Escape"); assert.equal(closed, 2);
  });

  test("mouse dragging scrolls only the captured pointer and suppresses dismissal", async () => {
    await open(); await load(); await h.key(".imageLightboxDialog", "+");
    const viewport = h.query<HTMLDivElement>(".imageLightboxViewport"); const captured = new Set<number>();
    viewport.setPointerCapture = (id) => { captured.add(id); }; viewport.hasPointerCapture = (id) => captured.has(id); viewport.releasePointerCapture = (id) => { captured.delete(id); };
    async function pointer(type: string, props: { pointerId?: number; pointerType?: string; button?: number; clientX?: number; clientY?: number } = {}) {
      await act(async () => { const event = new h.dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: props.button ?? 0, clientX: props.clientX ?? 100, clientY: props.clientY ?? 100 });
        Object.defineProperties(event, { pointerId: { value: props.pointerId ?? 1 }, pointerType: { value: props.pointerType ?? "mouse" } }); viewport.dispatchEvent(event); });
    }
    await pointer("pointermove"); await pointer("pointerup");
    await pointer("pointerdown", { button: 1 }); assert.equal(captured.size, 0);
    await pointer("pointerdown", { pointerType: "touch" }); assert.equal(captured.size, 0);
    await pointer("pointerdown"); assert.equal(captured.size, 1); assert.ok(viewport.classList.contains("isPanning"));
    const left = viewport.scrollLeft; await pointer("pointermove", { clientX: 99 }); assert.equal(viewport.scrollLeft, left);
    await pointer("pointermove", { pointerId: 2, clientX: 70 }); assert.equal(viewport.scrollLeft, left);
    await pointer("pointermove", { clientX: 70, clientY: 80 }); assert.equal(viewport.scrollLeft, left + 30);
    await pointer("pointerup", { pointerId: 2 }); assert.equal(captured.size, 1);
    await pointer("pointercancel"); assert.equal(captured.size, 0); assert.ok(!viewport.classList.contains("isPanning"));
    await h.click(viewport); assert.equal(closed, 0);
    await h.key(".imageLightboxDialog", "0"); await pointer("pointerdown"); assert.equal(captured.size, 0);
    await h.click(".imageLightboxCanvas"); assert.equal(closed, 1);
  });

  test("resize observations preserve stable dimensions and recompute fitting for width and height changes", async () => {
    const previous = globalThis.ResizeObserver;
    let notify: (() => void) | undefined;
    let width = 800; let height = 600;
    Object.defineProperties(h.dom.window.HTMLElement.prototype, {
      clientWidth: { configurable: true, get: () => width }, clientHeight: { configurable: true, get: () => height },
    });
    class ObservedResize {
      constructor(callback: ResizeObserverCallback) { notify = () => callback([], this as unknown as ResizeObserver); }
      observe() {} unobserve() {} disconnect() {}
    }
    Object.assign(globalThis, { ResizeObserver: ObservedResize });
    try {
      await open(); await load();
      await act(async () => { notify?.(); }); assert.equal(percent(), "50%");
      width = 700; await act(async () => { notify?.(); }); assert.equal(percent(), "44%");
      height = 500; await act(async () => { notify?.(); }); assert.equal(percent(), "42%");
      await act(async () => { notify?.(); }); assert.equal(percent(), "42%");
    } finally { Object.assign(globalThis, { ResizeObserver: previous }); }
  });

  test("missing ResizeObserver support still allows an initial fit", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
    try { Reflect.deleteProperty(globalThis, "ResizeObserver"); await open(); await load(); assert.equal(percent(), "50%"); }
    finally { if (descriptor) { Object.defineProperty(globalThis, "ResizeObserver", descriptor); } }
  });
});
