// Writes assets/icon.ico (rising bars on blue, as the tray icon), for the desktop shortcut.
// Run with: node scripts/make-icon.js
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZE = 256;

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** RGBA pixels: a rounded blue square with three white bars. */
function pixels() {
  const rows = [];
  const radius = SIZE * 0.18;
  const bars = [
    { x: 0.2, top: 0.6 },
    { x: 0.43, top: 0.42 },
    { x: 0.66, top: 0.24 },
  ];
  for (let y = 0; y < SIZE; y++) {
    const row = [0]; // filter type: none
    for (let x = 0; x < SIZE; x++) {
      const dx = Math.max(radius - x, 0, x - (SIZE - 1 - radius));
      const dy = Math.max(radius - y, 0, y - (SIZE - 1 - radius));
      const inside = dx * dx + dy * dy <= radius * radius;
      const fx = x / SIZE;
      const fy = y / SIZE;
      const bar = bars.some((b) => fx >= b.x && fx < b.x + 0.14 && fy >= b.top && fy < 0.8);
      if (!inside) row.push(0, 0, 0, 0);
      else if (bar) row.push(255, 255, 255, 255);
      else row.push(47, 111, 222, 255);
    }
    rows.push(Buffer.from(row));
  }
  return Buffer.concat(rows);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(pixels())),
  chunk('IEND', Buffer.alloc(0)),
]);

// ICO with one PNG image (256x256 is written as 0 in the directory entry).
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico.writeUInt8(0, 6);
ico.writeUInt8(0, 7);
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);

mkdirSync('assets', { recursive: true });
writeFileSync('assets/icon.ico', Buffer.concat([ico, png]));
console.log('assets/icon.ico written');
