import React from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { refractor } from "refractor";
import remarkGfm from "remark-gfm";
import { normalizeAssistantMarkdown } from "@/shared/utils";
import type { ChatMessage } from "@webview/views/chatView/ChatViewTypes";
import { t } from "@webview/i18n";

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: string[] | string };
  children?: HastNode[];
};

export function PlainText({ content }: { content: string }) {
  return (
    <>
      {content.split("\n").map((line, index) => (
        <React.Fragment key={index}>
          {index > 0 ? <br /> : null}
          {line}
        </React.Fragment>
      ))}
    </>
  );
}

export function MarkdownMessage({
  content,
  role,
}: {
  content: string;
  role: ChatMessage["role"];
}) {
  return (
    <div className="markdownMessage">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          code({ className, children, ...props }) {
            const languageId = getLanguageId(className);
            const rawCode = extractText(children);
            const code = rawCode.replace(/\n$/, "");
            if (!className && !rawCode.includes("\n")) {
              return (
                <code className="inline-code" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <div className="code-block" data-code-text={code}>
                <div className="code-block-header">
                  <span className="lang-label">{getLanguageLabel(languageId)}</span>
                  <span className="code-actions">
                    <button type="button" className="code-action-btn" data-code-action="copy">
                      {t("tools.copy")}
                    </button>
                    {role === "assistant" ? (
                      <button type="button" className="code-action-btn" data-code-action="insert">
                        {t("tools.insert")}
                      </button>
                    ) : null}
                  </span>
                </div>
                <RefractorCode
                  code={code}
                  className={className}
                  language={languageId}
                  codeProps={props}
                />
              </div>
            );
          },
          pre({ children }) {
            return <>{children}</>;
          },
        }}
      >
        {normalizeAssistantMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}

function RefractorCode({
  code,
  className,
  language,
  codeProps,
}: {
  code: string;
  className?: string;
  language: string;
  codeProps: React.ComponentProps<"code">;
}) {
  let children: React.ReactNode;
  try {
    const tree = refractor.highlight(code, normalizeRefractorLanguage(language)) as HastNode;
    children = tree.children?.map((node, index) => renderHastNode(node, index)) ?? code;
  } catch {
    children = code;
  }
  return <code className={className} {...codeProps}>{children}</code>;
}

function renderHastNode(node: HastNode, key: React.Key): React.ReactNode {
  if (node.type === "text") {
    return node.value ?? "";
  }
  if (node.type !== "element") {
    return null;
  }
  const className = Array.isArray(node.properties?.className)
    ? node.properties.className.join(" ")
    : node.properties?.className;
  return (
    <span key={key} className={className}>
      {node.children?.map((child, index) => renderHastNode(child, index))}
    </span>
  );
}

function extractText(value: React.ReactNode): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(extractText).join("");
  }
  if (React.isValidElement<{ children?: React.ReactNode }>(value)) {
    return extractText(value.props.children);
  }
  return "";
}

function getLanguageId(className?: string): string {
  return className?.match(/language-([^\s]+)/)?.[1] || "text";
}

function getLanguageLabel(language: string): string {
  const labels: Record<string, string> = {
    "c#": "C#",
    cs: "C#",
    csharp: "C#",
    js: "JavaScript",
    javascript: "JavaScript",
    ts: "TypeScript",
    typescript: "TypeScript",
    html: "HTML",
    css: "CSS",
    json: "JSON",
    bash: "Bash",
    shell: "Shell",
    sh: "Shell",
    python: "Python",
    py: "Python",
  };
  return labels[language.toLowerCase()] || language;
}

function normalizeRefractorLanguage(language: string): string {
  const aliases: Record<string, string> = {
    "c#": "csharp",
    cs: "csharp",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    sh: "bash",
    shell: "bash",
    ts: "typescript",
    tsx: "tsx",
    yml: "yaml",
  };
  return aliases[language.toLowerCase()] || language.toLowerCase();
}
