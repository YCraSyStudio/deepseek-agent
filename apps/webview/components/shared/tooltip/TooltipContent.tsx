/** Small, text-only formatter shared by all tooltips: paragraphs and **bold**. */
export default function TooltipContent({ text }: { text: string }) {
  return text.split(/\r?\n\s*\r?\n/).map((paragraph, paragraphIndex) => (
    <p key={paragraphIndex}>
      {paragraph.split(/(\*\*[^*\r\n]+\*\*)/).map((part, partIndex) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4
          ? <strong key={partIndex}>{part.slice(2, -2)}</strong>
          : part,
      )}
    </p>
  ));
}
