import { createElement, type ReactNode } from "react";

export interface HighlightNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: { className?: string | string[] };
  children?: HighlightNode[];
}
export const markdownFixture = {
  children: undefined as ReactNode,
  className: undefined as string | undefined,
  tree: undefined as HighlightNode | undefined,
  fail: false,
};
export const refractor = {
  highlight(code: string) {
    if (markdownFixture.fail) { throw new Error("Upstream highlighter unavailable"); }
    return markdownFixture.tree ?? { type: "root", children: [{ type: "text", value: code }] };
  },
};

export default function MarkdownBoundary({ components }: {
  components: { code: (props: { children: ReactNode; className?: string }) => ReactNode; pre: (props: { children: ReactNode }) => ReactNode };
}) {
  return createElement("div", null, components.pre({ children: components.code({ children: markdownFixture.children, className: markdownFixture.className }) }));
}
