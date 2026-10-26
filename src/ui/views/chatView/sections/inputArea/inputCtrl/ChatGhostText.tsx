import { useLayoutEffect, useState, type RefObject } from "react";

export default function ChatGhostText({ prefix, suggestion, textarea }: {
  prefix: string; suggestion: string; textarea: RefObject<HTMLTextAreaElement | null>;
}) {
  const [layout, setLayout] = useState({ width: 0, scroll: 0 });
  useLayoutEffect(() => {
    const node = textarea.current;
    if (!node || !suggestion) {return;}
    const measure = () => setLayout({ width: node.clientWidth, scroll: node.scrollTop });
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    node.addEventListener("scroll", measure);
    measure();
    return () => {observer.disconnect(); node.removeEventListener("scroll", measure);};
  }, [textarea, suggestion]);
  return suggestion ? (
    <div className="chatGhost" aria-hidden="true">
      <div className="chatGhostContent" style={{ width: layout.width, transform: `translateY(${-layout.scroll}px)` }}>
        <span className="chatGhostPrefix">{prefix}</span><span className="chatGhostSuggestion">{suggestion}</span>
      </div>
    </div>
  ) : null;
}
