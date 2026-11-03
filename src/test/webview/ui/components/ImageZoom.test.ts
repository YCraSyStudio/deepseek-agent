import * as assert from "node:assert";
import {
  canZoomIn,
  canZoomOut,
  clampZoomPercent,
  fitZoomPercent,
  resolveZoomPercent,
  scaledSize,
  zoomInPercent,
  zoomOutPercent,
} from "@/ui/components/shared/imageLightbox/ImageZoom";

suite("image lightbox zoom", () => {
  test("fits a large image to the viewport and never upscales a small one", () => {
    assert.strictEqual(fitZoomPercent({ width: 2000, height: 1000 }, { width: 1000, height: 1000 }), 50);
    assert.strictEqual(fitZoomPercent({ width: 1000, height: 2000 }, { width: 1000, height: 1000 }), 50);
    assert.strictEqual(fitZoomPercent({ width: 320, height: 240 }, { width: 1000, height: 1000 }), 100);
  });

  test("keeps a usable fit percentage when the viewport is not measured yet", () => {
    assert.strictEqual(fitZoomPercent({ width: 0, height: 0 }, { width: 1000, height: 1000 }), 100);
    assert.strictEqual(fitZoomPercent({ width: 2000, height: 1000 }, { width: 0, height: 0 }), 100);
  });

  test("resolves the rendered percentage from the selection or the fitted size", () => {
    const image = { width: 2000, height: 1000 };
    const viewport = { width: 1000, height: 1000 };

    assert.strictEqual(resolveZoomPercent(null, image, viewport), 50);
    assert.strictEqual(resolveZoomPercent(null, null, null), 100);
    assert.strictEqual(resolveZoomPercent(250, image, viewport), 250);
  });

  test("steps the zoom in quarter increments and stops at the supported range", () => {
    assert.strictEqual(zoomInPercent(100), 125);
    assert.strictEqual(zoomInPercent(400), 500);
    assert.strictEqual(zoomOutPercent(100), 80);
    assert.strictEqual(zoomOutPercent(16), 13);

    let zoomedOut = 100;
    for (let step = 0; step < 40; step += 1) {zoomedOut = zoomOutPercent(zoomedOut);}
    assert.strictEqual(zoomedOut, 10);
    assert.strictEqual(canZoomOut(zoomedOut), false);

    let zoomedIn = 100;
    for (let step = 0; step < 40; step += 1) {zoomedIn = zoomInPercent(zoomedIn);}
    assert.strictEqual(zoomedIn, 800);
    assert.strictEqual(canZoomIn(zoomedIn), false);
  });

  test("scales the natural size without changing the aspect ratio", () => {
    assert.deepStrictEqual(scaledSize({ width: 1200, height: 800 }, 50), { width: 600, height: 400 });
    assert.deepStrictEqual(scaledSize({ width: 1200, height: 800 }, 133), { width: 1596, height: 1064 });
  });

  test("clamps selected zoom percentages and ignores unusable values", () => {
    assert.strictEqual(clampZoomPercent(4), 10);
    assert.strictEqual(clampZoomPercent(5000), 800);
    assert.strictEqual(clampZoomPercent(333), 333);
    assert.strictEqual(clampZoomPercent(Number.NaN), 100);
    assert.strictEqual(clampZoomPercent(Number.POSITIVE_INFINITY), 100);
  });
});
