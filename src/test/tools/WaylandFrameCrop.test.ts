import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { WAYLAND_PORTAL_SCRIPT } from "@/infrastructure/capture/WaylandPortalScript";

const execute = promisify(execFile);
const available = process.platform === "linux" && spawnSync("/usr/bin/python3", ["-I", "-c", "import gi; gi.require_version('Gst','1.0'); from gi.repository import Gst; Gst.init(None); assert all(Gst.ElementFactory.find(n) for n in ('videocrop','pngenc','pngdec','appsrc','appsink'))"], { stdio: "ignore" }).status === 0;

suite("Wayland window frame cropping", () => {
  for (const [label, region, sourceType] of [
    ["offset window and its intentional black borders", [14, 12, 20, 16], 2],
    ["odd pixel dimensions without scaling", [7, 5, 11, 9], 2],
    ["already-sized window", [0, 0, 64, 48], 2],
    ["frame without crop metadata", undefined, 2],
    ["explicit monitor capture without window trimming", [14, 12, 20, 16], 1],
  ] as const) {
    test(`preserves exact pixels for ${label}`, async function () {
      if (!available) {this.skip();}
      this.timeout(10_000);
      const width = 64; const height = 48;
      const pixels = Buffer.alloc(width * height * 3);
      for (let y = 0; y < height; y++) {for (let x = 0; x < width; x++) {
        const black = region && (x === region[0] || y === region[1] || x === region[0] + region[2] - 1 || y === region[1] + region[3] - 1);
        if (!black) {pixels.set([(x * 17) % 256, (y * 13) % 256, ((x + y) * 11) % 256], (y * width + x) * 3);}
      }}
      const actual = await capture({ width, height, pixels: [...pixels], crop: region, sourceType });
      const [x, y, w, h] = sourceType === 2 && region ? region : [0, 0, width, height];
      assert.equal(actual.width, w); assert.equal(actual.height, h);
      const expected = Buffer.concat(Array.from({ length: h }, (_, row) => pixels.subarray(((y + row) * width + x) * 3, ((y + row) * width + x + w) * 3)));
      assert.deepEqual(Buffer.from(actual.pixels!, "base64"), expected);
    });
  }
  for (const crop of [[60, 0, 20, 16], [0, 45, 20, 16], [0, 0, 0, 16]]) {
    test(`discards invalid crop metadata ${crop.join(",")}`, async function () {
      if (!available) {this.skip();}
      this.timeout(10_000);
      const actual = await capture({ width: 64, height: 48, pixels: Array(64 * 48 * 3).fill(80), crop });
      assert.match(actual.error ?? "", /invalid window crop rectangle/);
      assert.equal(actual.bytes, 0);
    });
  }
});

async function capture(options: Record<string, unknown>): Promise<{ width?: number; height?: number; pixels?: string; error?: string; bytes?: number }> {
  const directory = await mkdtemp(path.join(tmpdir(), "ycrasy-frame-crop-"));
  try {
    const helper = path.join(directory, "helper.py");
    await writeFile(helper, WAYLAND_PORTAL_SCRIPT);
    const { stdout, stderr } = await execute("/usr/bin/python3", ["-I", path.resolve("src/test/fixtures/WaylandFrameCrop.py"), helper, path.join(directory, "capture.png"), JSON.stringify(options)], { timeout: 7500, maxBuffer: 128 * 1024 });
    assert.ok(!/CRITICAL|Traceback/.test(stderr), stderr);
    return JSON.parse(stdout);
  } finally {await rm(directory, { recursive: true, force: true });}
}
