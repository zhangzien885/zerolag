const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const rootDir = path.join(__dirname, "..");
const outputPath = path.join(rootDir, "build", "icon.ico");
const sizes = [16, 24, 32, 48, 64, 128, 256];

function clamp(value, min = 0, max = 255) {
  return Math.max(min, Math.min(max, value));
}

function mix(left, right, amount) {
  return left + (right - left) * amount;
}

function rgba(width, height) {
  return Buffer.alloc(width * height * 4);
}

function blendPixel(buffer, width, x, y, color) {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= width || py >= width) return;

  const index = (py * width + px) * 4;
  const sourceAlpha = clamp(color[3]) / 255;
  const targetAlpha = buffer[index + 3] / 255;
  const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
  if (outAlpha <= 0) return;

  buffer[index] = Math.round((color[0] * sourceAlpha + buffer[index] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  buffer[index + 1] = Math.round((color[1] * sourceAlpha + buffer[index + 1] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  buffer[index + 2] = Math.round((color[2] * sourceAlpha + buffer[index + 2] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  buffer[index + 3] = Math.round(outAlpha * 255);
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersects = ((yi > point[1]) !== (yj > point[1]))
      && (point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point[0] - start[0], point[1] - start[1]);

  const t = clamp(((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared, 0, 1);
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

function distanceToPolygon(point, polygon) {
  let distance = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    distance = Math.min(distance, distanceToSegment(point, polygon[i], polygon[(i + 1) % polygon.length]));
  }
  return distance;
}

function iconMask(x, y, size) {
  const margin = size * 0.075;
  const cut = size * 0.125;
  const left = margin;
  const top = margin;
  const right = size - margin;
  const bottom = size - margin;
  if (x < left || x > right || y < top || y > bottom) return false;
  if (x < left + cut && y < top + cut && (x - left) + (y - top) < cut) return false;
  if (x > right - cut && y < top + cut && (right - x) + (y - top) < cut) return false;
  if (x < left + cut && y > bottom - cut && (x - left) + (bottom - y) < cut) return false;
  if (x > right - cut && y > bottom - cut && (right - x) + (bottom - y) < cut) return false;
  return true;
}

function drawLine(buffer, size, start, end, color, thickness) {
  const minX = Math.max(0, Math.floor(Math.min(start[0], end[0]) - thickness - 1));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(start[0], end[0]) + thickness + 1));
  const minY = Math.max(0, Math.floor(Math.min(start[1], end[1]) - thickness - 1));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(start[1], end[1]) + thickness + 1));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = distanceToSegment([x + 0.5, y + 0.5], start, end);
      const alpha = clamp((thickness + 0.8 - distance) * color[3], 0, color[3]);
      if (alpha > 0) blendPixel(buffer, size, x, y, [color[0], color[1], color[2], alpha]);
    }
  }
}

function scaled(points, size) {
  return points.map(([x, y]) => [x * size / 96, y * size / 96]);
}

function renderIcon(size) {
  const buffer = rgba(size, size);
  const logo = scaled([[64, 24], [30, 24], [25, 36], [52, 36], [30, 72], [45, 72], [70, 36], [57, 36]], size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const point = [x + 0.5, y + 0.5];
      if (!iconMask(point[0], point[1], size)) continue;

      const gradient = (x + y) / (size * 2);
      const grid = size >= 48 && (x % Math.round(size / 6) === 0 || y % Math.round(size / 6) === 0) ? 12 : 0;
      blendPixel(buffer, size, x, y, [
        mix(7, 26, gradient) + grid,
        mix(19, 58, gradient) + grid,
        mix(12, 34, gradient) + grid,
        255
      ]);

      const logoDistance = distanceToPolygon(point, logo);
      if (logoDistance < size * 0.12) {
        const glow = clamp((1 - logoDistance / (size * 0.12)) * 105, 0, 105);
        blendPixel(buffer, size, x, y, [142, 255, 80, glow]);
      }
    }
  }

  const border = scaled([[18, 12], [78, 12], [86, 20], [86, 78], [78, 86], [18, 86], [10, 78], [10, 20]], size);
  for (let i = 0; i < border.length; i += 1) {
    drawLine(buffer, size, border[i], border[(i + 1) % border.length], [210, 255, 215, 98], Math.max(0.65, size / 96));
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const point = [x + 0.5, y + 0.5];
      const inside = pointInPolygon(point, logo);
      const distance = distanceToPolygon(point, logo);
      if (inside) {
        const gradient = (x + y) / (size * 2);
        blendPixel(buffer, size, x, y, [
          mix(202, 52, gradient),
          mix(255, 232, gradient),
          mix(92, 138, gradient),
          255
        ]);
      } else if (distance < Math.max(1.2, size / 48)) {
        const alpha = clamp((Math.max(1.2, size / 48) - distance) * 150, 0, 190);
        blendPixel(buffer, size, x, y, [242, 255, 230, alpha]);
      }
    }
  }

  drawLine(buffer, size, [16 * size / 96, 15 * size / 96], [36 * size / 96, 15 * size / 96], [218, 255, 154, 135], Math.max(0.6, size / 80));
  drawLine(buffer, size, [72 * size / 96, 28 * size / 96], [82 * size / 96, 18 * size / 96], [167, 255, 90, 145], Math.max(0.6, size / 84));

  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(size, data) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * (size * 4 + 1);
    raw[rowOffset] = 0;
    data.copy(raw, rowOffset + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry[0] = image.size === 256 ? 0 : image.size;
    entry[1] = image.size === 256 ? 0 : image.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += image.data.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

function main() {
  const images = sizes.map((size) => ({
    size,
    data: encodePng(size, renderIcon(size))
  }));

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, encodeIco(images));
  console.log(`Generated ${path.relative(rootDir, outputPath)} with ${images.length} sizes.`);
}

main();
