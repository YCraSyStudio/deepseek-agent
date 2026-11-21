export const MAX_CHAT_RESPONSE_BYTES = 16 * 1024 * 1024;
export const MAX_METADATA_RESPONSE_BYTES = 2 * 1024 * 1024;

export async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`API response exceeded ${maxBytes} bytes`);
  }
  if (!response.body) {return null;}
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {break;}
      total += value.byteLength;
      if (total > maxBytes) {throw new Error(`API response exceeded ${maxBytes} bytes`);}
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(combined)) as unknown;
}
