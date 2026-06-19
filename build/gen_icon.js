#!/usr/bin/env node
// 生成 RSS 风格的应用图标 PNG（多尺寸）
// 用最小依赖：直接构造 PNG 太复杂，改用 sips 从 SVG 转。
// 但 sips 不支持 SVG。所以这里直接写一个 1024x1024 的 32bpp BMP→PNG。
// 简化方案：手画一个 indigo 圆角方块 + 橙色 RSS 辐射 + 白色信号点。

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 1024;

// 画布：RGBA
const buf = Buffer.alloc(SIZE * SIZE * 4);

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
}

function fillRect(x0, y0, x1, y1, r, g, b, a = 255) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) setPixel(x, y, r, g, b, a);
}

function blend(dst, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  const af = a / 255;
  dst[i] = Math.round(r * af + dst[i] * (1 - af));
  dst[i + 1] = Math.round(g * af + dst[i + 1] * (1 - af));
  dst[i + 2] = Math.round(b * af + dst[i + 2] * (1 - af));
  dst[i + 3] = Math.min(255, dst[i + 3] + a);
}

// 圆角方块背景
const radius = 200;
const indigo = [99, 102, 241];
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // 圆角判定
    let inside = true;
    const corners = [
      [radius, radius], [SIZE - radius, radius],
      [radius, SIZE - radius], [SIZE - radius, SIZE - radius],
    ];
    for (const [cx, cy] of corners) {
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      if ((x < radius || x >= SIZE - radius) && (y < radius || y >= SIZE - radius)) {
        if (Math.hypot(dx, dy) > radius) { inside = false; break; }
      }
    }
    if (inside) setPixel(x, y, indigo[0], indigo[1], indigo[2]);
  }
}

// RSS 辐射扇形（橙色）+ 中心点（白色）
const cx = SIZE * 0.32, cy = SIZE * 0.68;
const orange = [245, 158, 11];
const white = [255, 255, 255];
const lineWidth = 28;

// 画三段弧（半径递增）
function drawArc(cxv, cyv, radius, lw, color) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cxv, dy = y - cyv;
      const dist = Math.hypot(dx, dy);
      if (Math.abs(dist - radius) < lw / 2) {
        // 只画右上方 1/4 圆（angle in -90..0）
        const ang = Math.atan2(dy, dx);
        if (ang >= -Math.PI / 2 && ang <= 0) {
          blend(buf, x, y, color[0], color[1], color[2], 255);
        }
      }
    }
  }
}

drawArc(cx, cy, 180, 30, orange);
drawArc(cx, cy, 330, 30, orange);
drawArc(cx, cy, 480, 30, orange);

// 中心圆点（白色实心）
function fillCircle(cxv, cyv, r, color) {
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (Math.hypot(x - cxv, y - cyv) <= r) blend(buf, x, y, color[0], color[1], color[2], 255);
  }
}
fillCircle(cx, cy, 45, white);

// 编码为 PNG
function crc32(b) {
  let c = ~0;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // color type RGBA
ihdr[10] = 0;  // compression
ihdr[11] = 0;  // filter
ihdr[12] = 0;  // interlace

// 加 filter byte (0) 到每行
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter none
  buf.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

const outDir = process.argv[2] || '.';
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon_1024.png'), png);
console.log('Wrote', path.join(outDir, 'icon_1024.png'), '(' + png.length + ' bytes)');
