interface SearchResultLine {
  file: string;
  line: number;
  text: string;
}

export function parseSearchResults(content: string): SearchResultLine[] {
  const results: SearchResultLine[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const match = line.match(/^(.+?):(\d+)\s*[—–-]?\s*(.+)/);
    if (match) {
      results.push({
        file: match[1].trim(),
        line: parseInt(match[2], 10),
        text: match[3].trim(),
      });
    }
  }

  return results;
}
