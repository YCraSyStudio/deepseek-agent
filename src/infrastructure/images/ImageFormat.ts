import { inflateSync } from "node:zlib";

export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
export function detectImageMediaType(bytes: Uint8Array): ImageMediaType | undefined {
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {return "image/jpeg";}
  if (bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])) {return "image/png";}
  const prefix = Buffer.from(bytes.slice(0, 6)).toString("ascii");
  if (prefix === "GIF87a" || prefix === "GIF89a") {return "image/gif";}
  if (bytes.length >= 12 && Buffer.from(bytes.slice(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.slice(8, 12)).toString("ascii") === "WEBP") {return "image/webp";}
  return undefined;
}

export interface ImageDimensions { width: number; height: number; mediaType: "image/png" | "image/jpeg" }

/** Validate structure and dimensions, including PNG checksums and compressed payload. */
export function inspectCapture(bytes: Buffer): ImageDimensions {
  const mediaType = detectImageMediaType(bytes);
  if (mediaType === "image/png") {
    let offset = 8;
    let width = 0; let height = 0; let bitDepth = 0; let colorType = 0;
    let ended = false;
    const data: Buffer[] = [];
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      if (length > bytes.length - offset - 12) {throw new Error("Truncated PNG capture");}
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      const chunk = bytes.subarray(offset + 4, offset + 8 + length);
      if (crc32(chunk) !== bytes.readUInt32BE(offset + 8 + length)) {throw new Error("Corrupt PNG capture");}
      if (offset === 8 && (type !== "IHDR" || length !== 13)) {throw new Error("Missing PNG header");}
      if (type === "IHDR") {
        width = bytes.readUInt32BE(offset + 8); height = bytes.readUInt32BE(offset + 12);
        bitDepth = bytes[offset + 16]; colorType = bytes[offset + 17];
        if (bytes[offset + 20] !== 0) {throw new Error("Interlaced captures are not supported");}
        assertDimensions(width, height);
      }
      if (type === "IDAT") {data.push(bytes.subarray(offset + 8, offset + 8 + length));}
      offset += length + 12;
      if (type === "IEND") {ended = length === 0 && offset === bytes.length; break;}
    }
    if (!ended || !data.length) {throw new Error("Truncated PNG capture");}
    const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
    if (!channels || ![1, 2, 4, 8, 16].includes(bitDepth)) {throw new Error("Unsupported PNG capture format");}
    const expected = (Math.ceil(width * channels * bitDepth / 8) + 1) * height;
    const decoded = inflateSync(Buffer.concat(data), { maxOutputLength: Math.min(expected, 80 * 1024 * 1024) });
    if (decoded.length !== expected) {throw new Error("Invalid PNG pixel payload");}
    return { width, height, mediaType };
  }
  if (mediaType === "image/jpeg" && bytes.at(-2) === 255 && bytes.at(-1) === 217) {
    let offset = 2;
    let width = 0; let height = 0;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 255) {break;}
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + length + 2 > bytes.length) {break;}
      if ([192, 193, 194].includes(marker) && length >= 8) {
        height = bytes.readUInt16BE(offset + 5); width = bytes.readUInt16BE(offset + 7);
        assertDimensions(width, height);
      }
      if (marker === 218 && width > 0 && height > 0 && length >= 6 && offset + 2 + length < bytes.length - 2) {
        return { width, height, mediaType };
      }
      offset += 2 + length;
    }
  }
  throw new Error("Capture must be a complete PNG or JPEG image");
}

function assertDimensions(width: number, height: number): void {
  if (!width || !height || width > 16384 || height > 16384 || width * height > 20_000_000) {
    throw new Error("Capture dimensions exceed the pixel limit");
  }
}
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);}
  }
  return (crc ^ 0xffffffff) >>> 0;
}
