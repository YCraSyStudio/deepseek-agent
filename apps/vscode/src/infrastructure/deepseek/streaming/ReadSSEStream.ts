interface ReadSSEStreamOptions {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  onChunk: (data: unknown) => void;
  onDone: () => void;
  signal?: AbortSignal;
  inactivityTimeoutMs?: number;
  maxBufferBytes?: number;
  maxEventBytes?: number;
}

const DEFAULT_INACTIVITY_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_EVENT_BYTES = 1024 * 1024;

export async function readSSEStream({
  reader,
  onChunk,
  onDone,
  signal,
  inactivityTimeoutMs = DEFAULT_INACTIVITY_TIMEOUT_MS,
  maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES,
  maxEventBytes = DEFAULT_MAX_EVENT_BYTES,
}: ReadSSEStreamOptions): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  const finish = () => {
    if (!completed) {
      completed = true;
      onDone();
    }
  };
  const onAbort = () => { void reader.cancel(); };

  if (signal?.aborted) {throw createAbortError();}
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (!completed) {
      const { done, value } = await readWithInactivityTimeout(reader, inactivityTimeoutMs, signal);
      if (signal?.aborted) {throw createAbortError();}
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      if (Buffer.byteLength(buffer, "utf8") > maxBufferBytes) {
        throw new Error(`SSE buffer exceeded ${maxBufferBytes} bytes`);
      }

      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (Buffer.byteLength(event, "utf8") > maxEventBytes) {
          throw new Error(`SSE event exceeded ${maxEventBytes} bytes`);
        }
        if (processEvent(event, onChunk)) {
          finish();
          await reader.cancel();
          return;
        }
      }

      if (done) {
        if (buffer && Buffer.byteLength(buffer, "utf8") > maxEventBytes) {
          throw new Error(`SSE event exceeded ${maxEventBytes} bytes`);
        }
        if (buffer && processEvent(buffer, onChunk)) {finish();}
        if (!completed) {throw new Error("DeepSeek stream ended before the [DONE] marker");}
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (!completed) {await reader.cancel().catch(() => undefined);}
  }
}

async function readWithInactivityTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(`DeepSeek stream was inactive for ${timeoutMs} ms`);
      error.name = "TimeoutError";
      reject(error);
      void reader.cancel();
    }, timeoutMs);
  });
  try {
    if (signal?.aborted) {throw createAbortError();}
    return await Promise.race([reader.read(), stalled]);
  } finally {
    if (timeout) {clearTimeout(timeout);}
  }
}

function processEvent(event: string, onChunk: (data: unknown) => void): boolean {
  const dataLines: string[] = [];
  for (const line of event.split("\n")) {
    if (!line || line.startsWith(":")) {continue;}
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) {value = value.slice(1);}
    if (field === "data") {dataLines.push(value);}
  }
  if (dataLines.length === 0) {return false;}
  const data = dataLines.join("\n");
  if (data.trim() === "[DONE]") {return true;}
  try {
    onChunk(JSON.parse(data));
  } catch (error) {
    const preview = data.replace(/[\r\n\t]+/g, " ").slice(0, 160);
    throw new Error(`Malformed SSE JSON (${preview.length} chars shown): ${preview}`, { cause: error });
  }
  return false;
}

function createAbortError(): Error {
  const error = new Error("Stream cancelled");
  error.name = "AbortError";
  return error;
}
