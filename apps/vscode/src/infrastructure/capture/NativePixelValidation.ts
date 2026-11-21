import { inflateSync } from "node:zlib";
import { inspectCapture } from "@/infrastructure/images/ImageFormat";

export function isUniformNativeCapture(bytes: Buffer): boolean {
  const { width, height, mediaType } = inspectCapture(bytes);
  if (mediaType !== "image/png") {throw new Error("Native capture must be PNG for pixel validation");}
  const depth = bytes[24]; const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[bytes[25]];
  if (depth !== 8 || !channels) {throw new Error("Native pixel validation requires an 8-bit non-indexed PNG");}
  const chunks: Buffer[] = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    if (bytes.toString("ascii", offset + 4, offset + 8) === "IDAT") {chunks.push(bytes.subarray(offset + 8, offset + 8 + size));}
    offset += size + 12;
  }
  const stride = width * channels;
  const decoded = inflateSync(Buffer.concat(chunks), { maxOutputLength: 80 * 1024 * 1024 });
  let previous = Buffer.alloc(stride); let first: Buffer | undefined; let uniform = true;
  for (let y = 0; y < height; y++) {
    const filter = decoded[y * (stride + 1)];
    if (filter > 4) {throw new Error("Invalid PNG row filter");}
    const row = Buffer.from(decoded.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0; const up = previous[x]; const corner = x >= channels ? previous[x - channels] : 0;
      const predictor = filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, corner) : 0;
      row[x] = (row[x] + predictor) & 255;
    }
    first ??= Buffer.from(row.subarray(0, channels));
    for (let x = 0; x < stride; x++) {if (row[x] !== first[x % channels]) {uniform = false;}}
    previous = row;
  }
  return uniform;
}
function paeth(a: number, b: number, c: number): number {const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;}
