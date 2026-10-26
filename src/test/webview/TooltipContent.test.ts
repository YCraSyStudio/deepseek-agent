import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TooltipContent from "../../ui/components/shared/tooltip/TooltipContent";

suite("tooltip text formatting", () => {
  const render = (text: string) => renderToStaticMarkup(createElement(TooltipContent, { text }));

  test("separates modes into paragraphs with bold labels", () => {
    assert.equal(render("**Default:** Ask.\n\n**Auto approve:** Routine.\n\n**Full access:** Elevated."),
      "<p><strong>Default:</strong> Ask.</p><p><strong>Auto approve:</strong> Routine.</p><p><strong>Full access:</strong> Elevated.</p>");
  });

  test("preserves single line breaks and plain or unmatched text", () => {
    assert.equal(render("First line\nSecond line **unfinished"), "<p>First line\nSecond line **unfinished</p>");
    assert.equal(render("First\r\n\r\nSecond"), "<p>First</p><p>Second</p>");
  });

  test("renders HTML as escaped text even inside bold spans", () => {
    assert.equal(render('**<script>alert(1)</script>** <img src=x>'),
      "<p><strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong> &lt;img src=x&gt;</p>");
  });
});
