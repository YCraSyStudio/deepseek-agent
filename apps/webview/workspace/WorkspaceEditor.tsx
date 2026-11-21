import { useEffect, useRef } from "react";
import { basicSetup, EditorView } from "codemirror";
import { languages } from "@codemirror/language-data";
import { t } from "@webview/i18n";

const editorTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--bg-primary)", color: "var(--text-primary)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)" },
  ".cm-gutters": { backgroundColor: "var(--bg-primary)", color: "var(--text-secondary)" },
}, { dark: true });

interface Props {
  path: string;
  initialText: string;
  onChange: (text: string) => void;
}

export function WorkspaceEditor({ path, initialText, onChange }: Props) {
  const parent = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const extension = languages.find(mode => mode.alias.some(alias => path.toLowerCase().endsWith("." + alias)) ||
      mode.extensions.some(suffix => path.toLowerCase().endsWith("." + suffix)));
    let disposed = false;
    let editor: EditorView | undefined;
    void (extension?.load().catch(() => undefined) ?? Promise.resolve(undefined)).then(language => {
      if (disposed || !parent.current) {return;}
      editor = new EditorView({
        doc: initialText,
        parent: parent.current,
        extensions: [
          basicSetup,
          editorTheme,
          EditorView.contentAttributes.of({ "aria-label": t("workspace.editor") }),
          EditorView.updateListener.of(update => {
            if (update.docChanged) {onChange(update.state.doc.toString());}
          }),
          ...(language ? [language] : []),
        ],
      });
    });
    return () => {
      disposed = true;
      editor?.destroy();
    };
  }, [initialText, onChange, path]);

  return <div className="workspaceEditor" ref={parent} />;
}
