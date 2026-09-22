// make-test-images.js  —  Phase A fixtures
//
// Writes a few small PNGs used to sanity-check the local VLM, with no
// dependencies at all: Node's zlib plus a hand-rolled PNG encoder (~40 lines).
// Doing it this way means the Phase A check is reproducible from a clean
// checkout — no browser, no CDN, no image library.
//
//   node make-test-images.js
//   -> test-images/candles.png   green/red candlestick chart  (colour IS meaningful)
//   -> test-images/photo.png     people wearing red and green (colour is NOT meaningful)
//   -> test-images/pills.png     coloured status pills        (meaning comes from page text)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------- minimal PNG encoder ----------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(img) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour RGB
  // bytes 10-12 stay 0: deflate / adaptive filtering / no interlace

  // Each scanline must be prefixed with its filter byte (0 = none).
  const stride = img.width * 3;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = 0;
    img.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------- tiny drawing helpers ----------

function createImage(width, height, bg) {
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    data[i * 3] = bg[0];
    data[i * 3 + 1] = bg[1];
    data[i * 3 + 2] = bg[2];
  }
  return { width, height, data };
}

function fillRect(img, x, y, w, h, color) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(img.width, Math.round(x + w));
  const y1 = Math.min(img.height, Math.round(y + h));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (py * img.width + px) * 3;
      img.data[i] = color[0];
      img.data[i + 1] = color[1];
      img.data[i + 2] = color[2];
    }
  }
}

function fillCircle(img, cx, cy, r, color) {
  for (let py = Math.max(0, cy - r); py < Math.min(img.height, cy + r); py++) {
    for (let px = Math.max(0, cx - r); px < Math.min(img.width, cx + r); px++) {
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= r * r) {
        const i = (py * img.width + px) * 3;
        img.data[i] = color[0];
        img.data[i + 1] = color[1];
        img.data[i + 2] = color[2];
      }
    }
  }
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const WHITE = hex('#ffffff');
const GREEN = hex('#1a8a1a');
const RED = hex('#c62828');
const AMBER = hex('#d4a017');
const AXIS = hex('#888888');

// ---------- the three fixtures ----------

function candlestickChart() {
  const img = createImage(840, 400, WHITE);
  fillRect(img, 60, 340, 740, 2, AXIS); // x axis
  fillRect(img, 60, 40, 2, 302, AXIS); // y axis

  const candles = [
    { up: true, bodyTop: 150, bodyH: 90, wickTop: 110, wickH: 180 },
    { up: false, bodyTop: 120, bodyH: 70, wickTop: 95, wickH: 130 },
    { up: true, bodyTop: 190, bodyH: 110, wickTop: 150, wickH: 185 },
    { up: false, bodyTop: 100, bodyH: 85, wickTop: 75, wickH: 145 },
    { up: true, bodyTop: 165, bodyH: 100, wickTop: 130, wickH: 170 },
    { up: false, bodyTop: 140, bodyH: 60, wickTop: 115, wickH: 120 }
  ];

  candles.forEach((c, i) => {
    const x = 110 + i * 115;
    const color = c.up ? GREEN : RED;
    fillRect(img, x + 26, c.wickTop, 4, c.wickH, color); // wick
    fillRect(img, x, c.bodyTop, 56, c.bodyH, color); // body
  });

  return img;
}

function photo() {
  const img = createImage(720, 400, hex('#8fd3f4')); // sky
  fillRect(img, 0, 250, 720, 150, hex('#7cb342')); // grass
  fillRect(img, 0, 235, 720, 20, hex('#5d8f35')); // hedge line

  const people = [
    { x: 120, shirt: RED },
    { x: 270, shirt: hex('#2e7d32') },
    { x: 420, shirt: hex('#b71c1c') },
    { x: 570, shirt: hex('#66bb6a') }
  ];
  for (const p of people) {
    fillCircle(img, p.x + 35, 170, 30, hex('#e0b088')); // head
    fillRect(img, p.x, 205, 70, 110, p.shirt); // shirt
    fillRect(img, p.x + 8, 315, 22, 60, hex('#3e4a59')); // legs
    fillRect(img, p.x + 40, 315, 22, 60, hex('#3e4a59'));
  }
  return img;
}

function statusPills() {
  const img = createImage(640, 300, WHITE);
  const rows = [GREEN, AMBER, RED, GREEN];
  rows.forEach((color, i) => {
    const y = 40 + i * 62;
    fillRect(img, 40, y, 260, 18, hex('#e6e6e6')); // stand-in for a task label
    fillRect(img, 380, y - 6, 150, 34, color); // the status pill
  });
  return img;
}

function writeFixtures() {
  const outDir = path.join(__dirname, 'test-images');
  fs.mkdirSync(outDir, { recursive: true });

  const fixtures = {
    'candles.png': candlestickChart(),
    'photo.png': photo(),
    'pills.png': statusPills()
  };

  for (const [name, img] of Object.entries(fixtures)) {
    const file = path.join(outDir, name);
    fs.writeFileSync(file, encodePng(img));
    console.log(`wrote ${file}  (${img.width}x${img.height})`);
  }
}

if (require.main === module) writeFixtures();

module.exports = { createImage, fillRect, fillCircle, encodePng, hex, candlestickChart, photo, statusPills };
