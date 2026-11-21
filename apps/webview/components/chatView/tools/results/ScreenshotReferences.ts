export function screenshotReferences(toolName: string, result?: string): string[] {
  if (!result) {return [];}
  if (toolName === "capture_screenshot") {
    try {const value = JSON.parse(result); return /^screenshot-\d+$/.test(value.id) ? [value.id] : [];} catch {return [];}
  }
  if (toolName === "analyze_images") {
    const match = /^Images sent: (\[[^\n]*\])\n/.exec(result);
    if (!match) {return [];}
    try {
      const sources: unknown = JSON.parse(match[1]);
      return Array.isArray(sources) ? [...new Set(sources.filter((source): source is string => typeof source === "string" && /^screenshot:screenshot-\d+$/.test(source)).map((source) => source.slice(11)))].slice(0, 8) : [];
    } catch {return [];}
  }
  return [];
}
