import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { access, writeFile } from "node:fs/promises";
import { parseX11Windows, parseNativeWindows, resolveNativeWindow } from "@/infrastructure/capture/NativeWindowCatalog";
import { isUniformNativeCapture } from "@/infrastructure/capture/NativePixelValidation";
import { NativeCaptureBackend, windowsCaptureScript } from "@/infrastructure/capture/NativeCaptureBackend";
const window = { id: "0x0123", pid: 123, title: "Exact app", x: 0, y: 0, width: 2, height: 1, visible: true };
function png(pixels: number[], filter = 0): Buffer {
  return nativePng([filter, ...pixels]);
}
function nativePng(rows: number[], width = 2, height = 1, depth = 8, color = 2): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
    for (const byte of body) {crc ^= byte; for (let bit = 0; bit < 8; bit++) {crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);}}
    const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); body.copy(out, 4); out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4); return out;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = depth; header[9] = color;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]);
}
suite("Native capture", () => {
  test("requires an explicit selector when no debug process resolver was provided", async () => {
    let helpers = 0;
    const backend = new NativeCaptureBackend(undefined, async () => [], async () => { helpers++; throw new Error("Unexpected helper"); });
    await assert.rejects(backend.capture({ target: "debug" }, new AbortController().signal), /No process is anchored/);
    assert.equal(helpers, 0);
  });
  test("decodes Up, Average and Paeth rows using previous pixels rather than encoded bytes", () => {
    for (const rows of [
      [0, 10, 10, 10, 2, 0, 0, 0],
      [0, 10, 10, 10, 3, 5, 0, 0],
      [0, 10, 10, 10, 4, 0, 0, 0],
    ]) { assert.equal(isUniformNativeCapture(nativePng(rows, 3, 2, 8, 0)), true); }
    // The second Paeth pixel chooses the upper-left value (50), yielding [10, 50].
    assert.equal(isUniformNativeCapture(nativePng([0, 50, 100, 4, 216, 0], 2, 2, 8, 0)), false);
  });
  test("rejects JPEG, indexed and sixteen-bit PNGs for native pixel validation", () => {
    const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8qqKKKAP/2Q==", "base64");
    assert.throws(() => isUniformNativeCapture(jpeg), /Native capture must be PNG/);
    assert.throws(() => isUniformNativeCapture(nativePng([0, 0, 0], 2, 1, 8, 3)), /8-bit non-indexed/);
    assert.throws(() => isUniformNativeCapture(nativePng([0, 0, 0, 0, 0], 2, 1, 16, 0)), /8-bit non-indexed/);
  });
  test("rejects oversized catalogs and filters malformed native window records", () => {
    assert.deepEqual(parseNativeWindows("null"), []);
    assert.throws(() => parseNativeWindows(JSON.stringify(Array(10001).fill(window))), /catalog exceeds/);
    for (const invalid of [null, {}, { ...window, pid: 0 }, { ...window, pid: 1.5 },
      { ...window, title: 1 }, { ...window, title: "x".repeat(4097) },
      { ...window, x: null }, { ...window, width: 0 }, { ...window, height: 0 }, { ...window, visible: "true" }]) {
      assert.deepEqual(parseNativeWindows(JSON.stringify([invalid])), []);
    }
    assert.deepEqual(parseNativeWindows(JSON.stringify([window])), [window]);
  });
  test("parses X11 and Windows/macOS catalogs including negative monitor positions", () => {
    const parsed = parseX11Windows("0x0123  0 123 -10 0 800 600 host Exact app\nmalformed");
    assert.equal(parsed[0].x, -10); assert.equal(parsed[0].title, "Exact app");
    assert.equal(parseNativeWindows(JSON.stringify({ ...window, id: "123" }))[0].pid, 123);
    assert.deepEqual(parseNativeWindows(JSON.stringify([{ ...window, id: "injection" }])), []);
  });
  test("uses exact selectors, rejects ambiguity and never guesses the active window", () => {
    assert.equal(resolveNativeWindow([window], { process: "123" }).id, window.id);
    assert.equal(resolveNativeWindow([window], {}, 123).id, window.id);
    assert.throws(() => resolveNativeWindow([window], {}), /anchored/);
    assert.throws(() => resolveNativeWindow([window], { window: "Exact" }), /does not exist/);
    assert.throws(() => resolveNativeWindow([window, { ...window, id: "0x456" }], { process: "123" }), /ambiguous/);
    assert.throws(() => resolveNativeWindow([{ ...window, visible: false }], { process: "123" }), /visible/);
    assert.throws(() => resolveNativeWindow([window], { process: "app;command" }), /numeric PID/);
  });
  test("decodes PNG row filters and distinguishes uniform from visible content", () => {
    assert.equal(isUniformNativeCapture(png([0,0,0,0,0,0])), true);
    assert.equal(isUniformNativeCapture(png([12,24,36,0,0,0], 1)), true);
    assert.equal(isUniformNativeCapture(png([12,24,36,1,0,0], 1)), false);
    assert.throws(() => isUniformNativeCapture(png([0,0,0,0,0,0], 5)), /row filter/);
  });
  test("Windows runner uses scoped PrintWindow and refuses occluded screen-copy fallback", () => {
    assert.throws(() => windowsCaptureScript(window, "file"), /handle/);
    const script = windowsCaptureScript({ ...window, id: "123" }, "a'b.png");
    assert.match(script, /PrintWindow\(h,dc,2\)/); assert.match(script, /Occluded\(h,r\)/); assert.match(script, /a''b.png/);
  });
  test("X11 runner stores only selected window output, removes temporary files, and fails on black captures", async function () {
    if (process.platform !== "linux") {this.skip();}
    const display = process.env.DISPLAY; const wayland = process.env.WAYLAND_DISPLAY; const session = process.env.XDG_SESSION_TYPE;
    process.env.DISPLAY = ":test"; delete process.env.WAYLAND_DISPLAY; process.env.XDG_SESSION_TYPE = "x11";
    let destination = "";
    try {
      const backend = new NativeCaptureBackend(() => 123, async () => [window], async (command, args) => {
        assert.equal(command, "import"); assert.deepEqual(args.slice(0, 2), ["-window", "0x0123"]);
        destination = args[2].slice(6); await writeFile(destination, png([1,0,0,2,0,0])); return { stdout: "", stderr: "" };
      });
      assert.equal((await backend.capture({ target: "debug" }, new AbortController().signal)).pid, 123);
      await assert.rejects(access(destination));
      const black = new NativeCaptureBackend(() => 123, async () => [window], async (_command, args) => {await writeFile(args[2].slice(6), png([0,0,0,0,0,0])); return { stdout: "", stderr: "" };});
      await assert.rejects(black.capture({ target: "debug" }, new AbortController().signal), /uniform\/black/);
    } finally {
      if (display === undefined) {delete process.env.DISPLAY;} else {process.env.DISPLAY = display;}
      if (wayland === undefined) {delete process.env.WAYLAND_DISPLAY;} else {process.env.WAYLAND_DISPLAY = wayland;}
      if (session === undefined) {delete process.env.XDG_SESSION_TYPE;} else {process.env.XDG_SESSION_TYPE = session;}
    }
  });
  test("Wayland uses the user's portal selection without a catalog, fabricated identity or screen fallback", async function () {
    if (process.platform !== "linux") {this.skip();}
    const wayland = process.env.WAYLAND_DISPLAY;
    process.env.WAYLAND_DISPLAY = "wayland-test";
    let destination = ""; const scopes: boolean[] = [];
    try {
      const backend = new NativeCaptureBackend(() => 123,
        async () => assert.fail("Wayland must not enumerate X11 windows"),
        async () => assert.fail("Wayland must not use X11 capture"),
        async (file, screen) => {destination = file; scopes.push(screen); await writeFile(file, png([1,0,0,2,0,0]));});
      const frame = await backend.capture({ target: "debug" }, new AbortController().signal);
      assert.match(frame.target, /user-selected-window.*not verified/);
      assert.equal(frame.pid, undefined); assert.equal(frame.windowTitle, undefined);
      await assert.rejects(access(destination));
      await backend.capture({ target: "screen" }, new AbortController().signal);
      assert.deepEqual(scopes, [false, true]);
      await assert.rejects(backend.capture({ target: "window", process: "app;command" }, new AbortController().signal), /numeric PID/);
      const rejected = new NativeCaptureBackend(() => 123, undefined, undefined,
        async (file, screen) => {destination = file; assert.equal(screen, false); throw new Error("Selector cancelled");});
      await assert.rejects(rejected.capture({ target: "debug" }, new AbortController().signal), /Selector cancelled/);
      await assert.rejects(access(destination));
    } finally {
      if (wayland === undefined) {delete process.env.WAYLAND_DISPLAY;} else {process.env.WAYLAND_DISPLAY = wayland;}
    }
  });
});
