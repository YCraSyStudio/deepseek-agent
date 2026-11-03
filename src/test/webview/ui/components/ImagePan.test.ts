import * as assert from "node:assert";
import {
  centeredScrollOffset,
  maxScrollOffset,
  rescaledScrollOffset,
} from "@/ui/components/shared/imageLightbox/ImagePan";

suite("image lightbox pan", () => {
  const viewport = { width: 1000, height: 800 };

  test("reports no travel while the content fits the viewport", () => {
    assert.deepStrictEqual(maxScrollOffset({ width: 400, height: 300 }, viewport), { left: 0, top: 0 });
    assert.deepStrictEqual(centeredScrollOffset({ width: 1000, height: 800 }, viewport), { left: 0, top: 0 });
  });

  test("centres content that overflows on a single axis", () => {
    assert.deepStrictEqual(maxScrollOffset({ width: 2000, height: 500 }, viewport), { left: 1000, top: 0 });
    assert.deepStrictEqual(centeredScrollOffset({ width: 2000, height: 500 }, viewport), { left: 500, top: 0 });
  });

  test("keeps the relative position when the content grows", () => {
    const previous = { width: 2000, height: 1600 };
    const next = { width: 4000, height: 3200 };

    assert.deepStrictEqual(rescaledScrollOffset({ left: 0, top: 0 }, previous, next, viewport), {
      left: 0,
      top: 0,
    });
    assert.deepStrictEqual(rescaledScrollOffset({ left: 500, top: 400 }, previous, next, viewport), {
      left: 1500,
      top: 1200,
    });
    assert.deepStrictEqual(rescaledScrollOffset({ left: 1000, top: 800 }, previous, next, viewport), {
      left: 3000,
      top: 2400,
    });
  });

  test("centres a zoomed image that was not scrollable before", () => {
    const fitted = { width: 900, height: 700 };
    const zoomed = { width: 1800, height: 1400 };

    assert.deepStrictEqual(rescaledScrollOffset({ left: 0, top: 0 }, fitted, zoomed, viewport), {
      left: 400,
      top: 300,
    });
  });

  test("returns to the origin when the content fits again after zooming out", () => {
    assert.deepStrictEqual(
      rescaledScrollOffset({ left: 900, top: 600 }, { width: 4000, height: 3200 }, { width: 500, height: 400 }, viewport),
      { left: 0, top: 0 },
    );
  });

  test("clamps offsets left over from a larger content size", () => {
    assert.deepStrictEqual(
      rescaledScrollOffset({ left: 5000, top: 5000 }, { width: 4000, height: 3200 }, { width: 2000, height: 1600 }, viewport),
      { left: 1000, top: 800 },
    );
  });
});
