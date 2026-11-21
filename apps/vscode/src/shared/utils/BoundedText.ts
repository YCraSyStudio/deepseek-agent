const OMITTED_MARKER = "\n...[older content omitted to stay within the memory budget]...\n";

export function appendBoundedUtf8(current: string, addition: string, maxBytes: number): string {
  if (!addition) {return current;}
  const markerIndex = current.indexOf(OMITTED_MARKER);
  const source = markerIndex >= 0
    ? `${current.slice(0, markerIndex)}${OMITTED_MARKER}${current.slice(markerIndex + OMITTED_MARKER.length)}${addition}`
    : `${current}${addition}`;
  if (Buffer.byteLength(source, "utf8") <= maxBytes) {return source;}
  const markerBytes = Buffer.byteLength(OMITTED_MARKER, "utf8");
  if (markerBytes > maxBytes) {return takeUtf8Head(source, maxBytes);}
  const sideBytes = Math.max(0, Math.floor((maxBytes - markerBytes) / 2));
  return `${takeUtf8Head(source, sideBytes)}${OMITTED_MARKER}${takeUtf8Tail(source, sideBytes)}`;
}

export function boundUtf8HeadTail(value: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {return { text: value, truncated: false };}
  const marker = "\n...[content omitted to stay within the context budget]...\n";
  const markerBytes = Buffer.byteLength(marker, "utf8");
  if (markerBytes > maxBytes) {return { text: takeUtf8Head(value, maxBytes), truncated: true };}
  const sideBytes = Math.max(0, Math.floor((maxBytes - markerBytes) / 2));
  return {
    text: `${takeUtf8Head(value, sideBytes)}${marker}${takeUtf8Tail(value, sideBytes)}`,
    truncated: true,
  };
}

export function takeUtf8Head(value: string, maxBytes: number): string {
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, middle), "utf8") <= maxBytes) {low = middle;} else {high = middle - 1;}
  }
  const end = splitsSurrogatePair(value, low) ? low - 1 : low;
  return value.slice(0, end);
}

export function takeUtf8Tail(value: string, maxBytes: number): string {
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(value.length - middle), "utf8") <= maxBytes) {low = middle;} else {high = middle - 1;}
  }
  const start = value.length - low;
  return value.slice(splitsSurrogatePair(value, start) ? start + 1 : start);
}

function splitsSurrogatePair(value: string, index: number): boolean {
  if (index <= 0 || index >= value.length) {return false;}
  const previous = value.charCodeAt(index - 1);
  const next = value.charCodeAt(index);
  return previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF;
}
