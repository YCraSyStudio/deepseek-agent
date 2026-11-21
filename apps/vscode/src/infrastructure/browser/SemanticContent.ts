import { validatePublicWebUrl } from "./NetworkPolicy";
import type { WebContentSection } from "./Types";

const MAX_DOCUMENT_CHARS = 64 * 1024;
export const MAX_WEB_RESPONSE_CHARS = 8 * 1024;
const MAX_SECTION_BYTES = 4 * 1024;

export interface NormalizedWebDocument {
  title: string;
  url: string;
  sections: WebContentSection[];
  sourceCharacters: number;
}

export interface SelectedDocumentSections {
  sections: WebContentSection[];
  cursor: number;
  nextCursor?: number;
}

export function createNormalizedDocument(
  title: string,
  url: string,
  rawSections: readonly string[],
): NormalizedWebDocument {
  const safeTitle = cleanText(title) || "Web page";
  const safeUrl = validatePublicWebUrl(url).toString();
  const sourceSections: string[] = [];
  let remainingCharacters = MAX_DOCUMENT_CHARS;
  for (const rawSection of rawSections) {
    const section = cleanText(rawSection);
    if (!section || remainingCharacters <= 0) {continue;}
    sourceSections.push(section.slice(0, remainingCharacters));
    remainingCharacters -= section.length;
  }
  const boundedSource = sourceSections.join("\n\n");
  const fragments = sourceSections.flatMap((section) => splitSection(section, safeTitle));
  const sections = fragments.map((content, index) => ({ id: index + 1, content }));
  return {
    title: safeTitle.slice(0, 300),
    url: safeUrl,
    sections: sections.length > 0 ? sections : [{ id: 1, content: safeTitle }],
    sourceCharacters: boundedSource.length,
  };
}

export function extractSemanticDocument(snapshot: string, fallbackUrl: string): NormalizedWebDocument {
  const title = cleanText(/(?:^|\n)Page Title:\s*([^\n]+)/i.exec(snapshot)?.[1] ?? "Web page");
  const reportedUrl = /(?:^|\n)(?:Page )?URL:\s*(https:\/\/[^\s\n]+)/i.exec(snapshot)?.[1];
  const lines = snapshot.split(/\r?\n/);
  const sections: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    if (current.length > 0) {sections.push(current.join("\n\n")); current = [];}
  };
  for (const line of lines) {
    const heading = /-\s*heading(?:\s+"((?:\\"|[^"])*)"|:\s*(.*?))(?:\s+\[level=(\d+)\])?\s*$/i.exec(line);
    if (heading) {
      const value = cleanText((heading[1] ?? heading[2] ?? "").replace(/\\"/g, "\""));
      const level = Number(heading[3] ?? 2);
      if (level === 1) {flush();}
      if (value) {current.push(value);}
      continue;
    }
    const paragraph = /-\s*paragraph(?:\s+"((?:\\"|[^"])*)"|:\s*(.*))$/i.exec(line);
    if (paragraph) {
      if (current.length === 0) {current.push(title);}
      const value = cleanText((paragraph[1] ?? paragraph[2] ?? "").replace(/\\"/g, "\""));
      if (value) {current.push(value);}
    }
  }
  flush();
  return createNormalizedDocument(title, reportedUrl ?? fallbackUrl, sections);
}

export function selectDocumentContent(
  document: NormalizedWebDocument,
  cursor = 0,
  query?: string,
  maxChars = 6_000,
): SelectedDocumentSections {
  if (query) {
    const terms = query.toLocaleLowerCase().split(/\s+/).filter((term) => term.length >= 2);
    const ranked = document.sections.map((section, index) => ({
      section,
      index,
      normalized: section.content.toLocaleLowerCase(),
    })).map((entry) => ({
      ...entry,
      score: terms.reduce((score, term) => score + countOccurrences(entry.normalized, term), 0),
      matchesAll: terms.every((term) => entry.normalized.includes(term)),
    })).filter((entry) => entry.matchesAll).sort((a, b) => b.score - a.score || a.index - b.index);
    return { sections: fitSections(ranked.map((entry) => entry.section), maxChars), cursor: 0 };
  }
  const start = Math.min(Math.max(0, cursor), document.sections.length);
  const sections = fitSections(document.sections.slice(start), maxChars);
  const next = start + sections.length;
  return { sections, cursor: start, nextCursor: next < document.sections.length ? next : undefined };
}

function fitSections(sections: readonly WebContentSection[], maxChars: number): WebContentSection[] {
  const selected: WebContentSection[] = [];
  let length = 0;
  for (const section of sections) {
    if (selected.length > 0 && length + section.content.length > maxChars) {break;}
    selected.push(section);
    length += section.content.length;
    if (length >= maxChars) {break;}
  }
  return selected;
}

function splitSection(section: string, fallbackTitle: string): string[] {
  if (Buffer.byteLength(section, "utf8") <= MAX_SECTION_BYTES) {return [section];}
  const blocks = section.split(/\n\n+/).map(cleanText).filter(Boolean);
  if (blocks.length === 1) {
    const contentBytes = Math.max(512, MAX_SECTION_BYTES - Buffer.byteLength(`${fallbackTitle}\n\n`, "utf8"));
    return splitUtf8(blocks[0] ?? section, contentBytes).map((piece) => `${fallbackTitle}\n\n${piece}`);
  }
  const title = blocks[0] ?? fallbackTitle;
  const result: string[] = [];
  let current = title;
  for (const block of blocks.slice(1)) {
    const candidate = `${current}\n\n${block}`;
    if (Buffer.byteLength(candidate, "utf8") <= MAX_SECTION_BYTES) {current = candidate; continue;}
    if (current !== title || result.length === 0) {result.push(current);}
    current = `${title}\n\n${block}`;
    if (Buffer.byteLength(current, "utf8") > MAX_SECTION_BYTES) {
      const pieces = splitUtf8(block, Math.max(512, MAX_SECTION_BYTES - Buffer.byteLength(`${title}\n\n`, "utf8")));
      result.push(...pieces.slice(0, -1).map((piece) => `${title}\n\n${piece}`));
      current = `${title}\n\n${pieces.at(-1) ?? ""}`.trim();
    }
  }
  if (current) {result.push(current);}
  return result;
}

function splitUtf8(value: string, maxBytes: number): string[] {
  const result: string[] = [];
  let remaining = value;
  while (Buffer.byteLength(remaining, "utf8") > maxBytes) {
    let end = Math.min(remaining.length, maxBytes);
    while (end > 1 && Buffer.byteLength(remaining.slice(0, end), "utf8") > maxBytes) {end -= 1;}
    const soft = Math.max(remaining.lastIndexOf(" ", end), remaining.lastIndexOf(". ", end) + 1);
    if (soft > end / 2) {end = soft;}
    result.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) {result.push(remaining);}
  return result;
}

function cleanText(value: string): string {return value.replace(/[\t ]+/g, " ").replace(/ *\n */g, "\n").trim();}

function countOccurrences(value: string, term: string): number {
  let count = 0;
  let cursor = 0;
  while ((cursor = value.indexOf(term, cursor)) >= 0) {count += 1; cursor += term.length;}
  return count;
}
