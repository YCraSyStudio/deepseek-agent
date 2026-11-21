export interface PathToken {
  query: string;
  start: number;
  end: number;
}

export function getPathToken(value: string, cursor: number): PathToken | null {
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/(?:^|\s)(\.\/[^\s]*)$/);
  if (!match?.[1]) {
    return null;
  }

  const query = match[1];
  return {
    query,
    start: beforeCursor.length - query.length,
    end: cursor,
  };
}
