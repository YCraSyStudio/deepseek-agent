import * as assert from "assert";
import {
  TOOLTIP_MARGIN,
  TOOLTIP_OFFSET,
  parseTooltipAlign,
  parseTooltipSide,
  resolveTooltipPlacement,
  type TooltipAnchorRect,
  type TooltipPlacementRequest,
} from "../../ui/components/shared/tooltip/TooltipPlacement";

const VIEWPORT = { width: 400, height: 600 };

function request(overrides: Partial<TooltipPlacementRequest> = {}): TooltipPlacementRequest {
  return {
    anchor: { top: 200, left: 180, width: 40, height: 28 } as TooltipAnchorRect,
    tooltip: { width: 120, height: 24 },
    viewport: VIEWPORT,
    side: "top",
    align: "center",
    ...overrides,
  };
}

suite("TooltipPlacement", () => {
  test("declared side and alignment are parsed, unknown values fall back", () => {
    assert.strictEqual(parseTooltipSide("bottom"), "bottom");
    assert.strictEqual(parseTooltipSide("left"), "left");
    assert.strictEqual(parseTooltipSide(undefined), "top");
    assert.strictEqual(parseTooltipSide("diagonal"), "top");

    assert.strictEqual(parseTooltipAlign("start"), "start");
    assert.strictEqual(parseTooltipAlign("end"), "end");
    assert.strictEqual(parseTooltipAlign(undefined), "center");
    assert.strictEqual(parseTooltipAlign("middle"), "center");
  });

  test("a tooltip with room above is centred over its anchor", () => {
    const placement = resolveTooltipPlacement(request());
    assert.strictEqual(placement.side, "top");
    assert.strictEqual(placement.top, 200 - 24 - TOOLTIP_OFFSET);
    assert.strictEqual(placement.left, 180 + 20 - 60);
  });

  test("the tooltip flips below an anchor that sits against the top edge", () => {
    const placement = resolveTooltipPlacement(request({ anchor: { top: 4, left: 180, width: 40, height: 28 } }));
    assert.strictEqual(placement.side, "bottom");
    assert.strictEqual(placement.top, 4 + 28 + TOOLTIP_OFFSET);
  });

  test("flipping is refused when neither side has room, keeping the asked one", () => {
    const placement = resolveTooltipPlacement(request({
      anchor: { top: 290, left: 180, width: 40, height: 20 },
      tooltip: { width: 120, height: 400 },
    }));
    assert.strictEqual(placement.side, "top");
    assert.strictEqual(placement.top, TOOLTIP_MARGIN);
  });

  test("a control at the right edge keeps its tooltip inside the viewport", () => {
    const placement = resolveTooltipPlacement(request({
      anchor: { top: 200, left: 372, width: 24, height: 28 },
      align: "end",
    }));
    assert.strictEqual(placement.side, "top");
    assert.strictEqual(placement.left, VIEWPORT.width - 120 - TOOLTIP_MARGIN);
  });

  test("start alignment never pushes the tooltip off the leading edge", () => {
    const placement = resolveTooltipPlacement(request({
      anchor: { top: 200, left: 0, width: 28, height: 28 },
      align: "start",
    }));
    assert.strictEqual(placement.left, TOOLTIP_MARGIN);
  });

  test("a tooltip wider than the viewport stays at the leading margin", () => {
    const placement = resolveTooltipPlacement(request({
      tooltip: { width: VIEWPORT.width + 80, height: 24 },
    }));
    assert.strictEqual(placement.left, TOOLTIP_MARGIN);
  });

  test("left and right sides align on the vertical axis", () => {
    const right = resolveTooltipPlacement(request({
      anchor: { top: 300, left: 100, width: 30, height: 30 },
      side: "right",
      align: "start",
    }));
    assert.strictEqual(right.side, "right");
    assert.strictEqual(right.left, 100 + 30 + TOOLTIP_OFFSET);
    assert.strictEqual(right.top, 300);

    const left = resolveTooltipPlacement(request({
      anchor: { top: 300, left: 200, width: 30, height: 30 },
      side: "left",
      align: "end",
    }));
    assert.strictEqual(left.side, "left");
    assert.strictEqual(left.left, 200 - 120 - TOOLTIP_OFFSET);
    assert.strictEqual(left.top, 300 + 30 - 24);
  });
});
