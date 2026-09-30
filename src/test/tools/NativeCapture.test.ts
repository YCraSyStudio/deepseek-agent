import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { access, writeFile } from "node:fs/promises";
import { parseX11Windows, parseNativeWindows, resolveNativeWindow } from "@/infrastructure/capture/NativeWindowCatalog";
import { isUniformNativeCapture } from "@/infrastructure/capture/NativePixelValidation";
import { NativeCaptureBackend, windowsCaptureScript } from "@/infrastructure/capture/NativeCaptureBackend";
const window = { id: "0x0123", pid: 123, title: "Exact app", x: 0, y: 0, width: 2, height: 1, visible: true };
function png(pixels: number[], filter = 0): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
    for (const byte of body) {crc ^= byte; for (let bit = 0; bit < 8; bit++) {crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);}}
    const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); body.copy(out, 4); out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4); return out;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([filter, ...pixels]))), chunk("IEND", Buffer.alloc(0))]);
}
suite("Native capture", () => {
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
      process.env.WAYLAND_DISPLAY = "wayland-test";
      await assert.rejects(backend.capture({ target: "screen" }, new AbortController().signal), /portal/);
    } finally {
      if (display === undefined) {delete process.env.DISPLAY;} else {process.env.DISPLAY = display;}
      if (wayland === undefined) {delete process.env.WAYLAND_DISPLAY;} else {process.env.WAYLAND_DISPLAY = wayland;}
      if (session === undefined) {delete process.env.XDG_SESSION_TYPE;} else {process.env.XDG_SESSION_TYPE = session;}
    }
  });
});
