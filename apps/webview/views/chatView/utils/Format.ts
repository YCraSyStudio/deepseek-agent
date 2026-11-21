export function detectDiff(content: string): boolean {
  if (!content) {return false;}

  const lines = content.split("\n");
  let hasMinusHeader = false;
  let hasPlusHeader = false;
  let hasHunk = false;

  for (const line of lines) {
    if (line.startsWith("--- ")) {hasMinusHeader = true;}
    if (line.startsWith("+++ ")) {hasPlusHeader = true;}
    if (/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(line)) {hasHunk = true;}
    if (hasMinusHeader && hasPlusHeader && hasHunk) {return true;}
  }

  return false;
}

export function formatSize(contentLength: number): string {
  if (contentLength < 1024) {return `${contentLength} B`;}
  const kb = (contentLength / 1024).toFixed(1);
  if (contentLength < 1024 * 1024) {return `${kb} KB`;}
  const mb = (contentLength / (1024 * 1024)).toFixed(1);
  return `${mb} MB`;
}
