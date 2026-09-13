import { readFileSync, writeFileSync } from "node:fs";
import { crc32, deflateSync, inflateSync } from "node:zlib";

const sourceUrl = new URL("../../src/assets/DeepSeekIcon.png", import.meta.url);
const targetUrl = new URL("../public/og-image.png", import.meta.url);

const WIDTH = 1200;
const HEIGHT = 630;
const BACKGROUND = [0x1b, 0x1b, 0x1f];
const GLOW = [0x2a, 0x2b, 0x33];
const ACCENT = [0x4a, 0xa8, 0xff];

function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  let transparency = null;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") {
      palette = Buffer.from(data);
    } else if (type === "tRNS") {
      transparency = Buffer.from(data);
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    }
    offset += length + 12;
  }

  if (bitDepth !== 8) {
    throw new Error(`Unsupported bit depth: ${bitDepth}`);
  }
  if (interlace !== 0) {
    throw new Error("Interlaced PNG is not supported");
  }

  const channelsByColorType = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsByColorType[colorType];
  if (!channels) {
    throw new Error(`Unsupported color type: ${colorType}`);
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let position = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[position];
    position += 1;
    const line = raw.subarray(position, position + stride);
    position += stride;
    const current = pixels.subarray(y * stride, (y + 1) * stride);
    const previous = y === 0 ? null : pixels.subarray((y - 1) * stride, y * stride);

    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? current[x - channels] : 0;
      const above = previous ? previous[x] : 0;
      const aboveLeft = previous && x >= channels ? previous[x - channels] : 0;
      let value = line[x];

      if (filter === 1) {
        value += left;
      } else if (filter === 2) {
        value += above;
      } else if (filter === 3) {
        value += (left + above) >> 1;
      } else if (filter === 4) {
        const estimate = left + above - aboveLeft;
        const distanceLeft = Math.abs(estimate - left);
        const distanceAbove = Math.abs(estimate - above);
        const distanceAboveLeft = Math.abs(estimate - aboveLeft);
        value +=
          distanceLeft <= distanceAbove && distanceLeft <= distanceAboveLeft
            ? left
            : distanceAbove <= distanceAboveLeft
              ? above
              : aboveLeft;
      }

      current[x] = value & 0xff;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    let red;
    let green;
    let blue;
    let alpha = 255;

    if (colorType === 3) {
      const paletteIndex = pixels[index];
      red = palette[paletteIndex * 3];
      green = palette[paletteIndex * 3 + 1];
      blue = palette[paletteIndex * 3 + 2];
      if (transparency && paletteIndex < transparency.length) {
        alpha = transparency[paletteIndex];
      }
    } else if (colorType === 2) {
      red = pixels[index * 3];
      green = pixels[index * 3 + 1];
      blue = pixels[index * 3 + 2];
    } else if (colorType === 6) {
      red = pixels[index * 4];
      green = pixels[index * 4 + 1];
      blue = pixels[index * 4 + 2];
      alpha = pixels[index * 4 + 3];
    } else if (colorType === 4) {
      red = green = blue = pixels[index * 2];
      alpha = pixels[index * 2 + 1];
    } else {
      red = green = blue = pixels[index];
    }

    rgba[index * 4] = red;
    rgba[index * 4 + 1] = green;
    rgba[index * 4 + 2] = blue;
    rgba[index * 4 + 3] = alpha;
  }

  return { width, height, rgba };
}

function blend(canvas, x, y, red, green, blue, alpha) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT || alpha <= 0) {
    return;
  }
  const offset = (y * WIDTH + x) * 4;
  const sourceAlpha = alpha / 255;
  const inverse = 1 - sourceAlpha;
  canvas[offset] = Math.round(red * sourceAlpha + canvas[offset] * inverse);
  canvas[offset + 1] = Math.round(green * sourceAlpha + canvas[offset + 1] * inverse);
  canvas[offset + 2] = Math.round(blue * sourceAlpha + canvas[offset + 2] * inverse);
  canvas[offset + 3] = 255;
}

function sampleLogo(logo, x, y) {
  const clampedX = Math.min(Math.max(x, 0), logo.width - 1);
  const clampedY = Math.min(Math.max(y, 0), logo.height - 1);
  const offset = (clampedY * logo.width + clampedX) * 4;
  const alpha = logo.rgba[offset + 3] / 255;
  return {
    red: logo.rgba[offset] * alpha,
    green: logo.rgba[offset + 1] * alpha,
    blue: logo.rgba[offset + 2] * alpha,
    alpha,
  };
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const chunk = (type, data) => {
    const output = Buffer.alloc(data.length + 12);
    output.writeUInt32BE(data.length, 0);
    output.write(type, 4, "latin1");
    data.copy(output, 8);
    output.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])) >>> 0, 8 + data.length);
    return output;
  };

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const logo = decodePng(readFileSync(sourceUrl));
const canvas = new Uint8Array(WIDTH * HEIGHT * 4);
const centerX = WIDTH / 2;
const centerY = HEIGHT / 2;
const glowRadius = 520;

for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    const distance = Math.hypot(x - centerX, y - centerY);
    const intensity = Math.max(0, 1 - distance / glowRadius) ** 2;
    const offset = (y * WIDTH + x) * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      canvas[offset + channel] = Math.round(
        BACKGROUND[channel] + (GLOW[channel] - BACKGROUND[channel]) * intensity,
      );
    }
    canvas[offset + 3] = 255;
  }
}

const scale = 2;
const logoWidth = logo.width * scale;
const logoHeight = logo.height * scale;
const logoLeft = Math.round((WIDTH - logoWidth) / 2);
const logoTop = Math.round((HEIGHT - logoHeight) / 2) - 16;

for (let y = 0; y < logoHeight; y += 1) {
  for (let x = 0; x < logoWidth; x += 1) {
    const sourceX = (x + 0.5) / scale - 0.5;
    const sourceY = (y + 0.5) / scale - 0.5;
    const x0 = Math.floor(sourceX);
    const y0 = Math.floor(sourceY);
    const xWeight = sourceX - x0;
    const yWeight = sourceY - y0;
    const topLeft = sampleLogo(logo, x0, y0);
    const topRight = sampleLogo(logo, x0 + 1, y0);
    const bottomLeft = sampleLogo(logo, x0, y0 + 1);
    const bottomRight = sampleLogo(logo, x0 + 1, y0 + 1);

    const mix = (channel) =>
      topLeft[channel] * (1 - xWeight) * (1 - yWeight) +
      topRight[channel] * xWeight * (1 - yWeight) +
      bottomLeft[channel] * (1 - xWeight) * yWeight +
      bottomRight[channel] * xWeight * yWeight;

    const alpha =
      topLeft.alpha * (1 - xWeight) * (1 - yWeight) +
      topRight.alpha * xWeight * (1 - yWeight) +
      bottomLeft.alpha * (1 - xWeight) * yWeight +
      bottomRight.alpha * xWeight * yWeight;

    if (alpha <= 0) {
      continue;
    }

    blend(
      canvas,
      logoLeft + x,
      logoTop + y,
      mix("red") / alpha,
      mix("green") / alpha,
      mix("blue") / alpha,
      Math.round(alpha * 255),
    );
  }
}

const barWidth = 220;
const barHeight = 6;
const barLeft = Math.round((WIDTH - barWidth) / 2);
const barTop = HEIGHT - 72;

for (let y = 0; y < barHeight; y += 1) {
  for (let x = 0; x < barWidth; x += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const offset = ((barTop + y) * WIDTH + barLeft + x) * 4;
      canvas[offset + channel] = ACCENT[channel];
    }
  }
}

const png = encodePng(WIDTH, HEIGHT, canvas);
writeFileSync(targetUrl, png);

const check = decodePng(png);
const cornerOffset = 0;
const centerOffset = (Math.round(HEIGHT / 2) * WIDTH + Math.round(WIDTH / 2)) * 4;
console.log(
  JSON.stringify({
    path: targetUrl.pathname,
    bytes: png.length,
    width: check.width,
    height: check.height,
    corner: [check.rgba[cornerOffset], check.rgba[cornerOffset + 1], check.rgba[cornerOffset + 2]],
    center: [check.rgba[centerOffset], check.rgba[centerOffset + 1], check.rgba[centerOffset + 2]],
    logoScale: scale,
  }),
);
