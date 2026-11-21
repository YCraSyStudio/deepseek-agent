import type React from "react";
import "./CollapsiblePanel.css";

interface CollapsiblePanelProps {
  title: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  bodyClassName?: string;
}

function CollapsiblePanel({ title, meta, children, defaultOpen, className = "", bodyClassName = "" }: CollapsiblePanelProps) {
  return (
    <details className={`collapsiblePanel ${className}`.trim()} open={defaultOpen}>
      <summary className="collapsiblePanelSummary">
        <span className="collapsiblePanelTitle">{title}</span>
        {meta ? <span className="collapsiblePanelMeta">{meta}</span> : null}
        <span className="collapsiblePanelChevron" aria-hidden="true" />
      </summary>
      <div className={`collapsiblePanelBody ${bodyClassName}`.trim()}>{children}</div>
    </details>
  );
}

export default CollapsiblePanel;
