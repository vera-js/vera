/**
 * Generates the demo's image sequence — 48 synthetic PNG frames in `img/seq/`.
 *
 * The originals were AI-generated raster frames with no recorded provenance, and the demo's
 * photographs are fetched from picsum.photos at load time — so the one thing that must live in
 * the repository is a sequence that scrubs coherently, and a generated one documents itself.
 * Zero dependencies: the PNG encoder below is the format's minimum — one IHDR, one IDAT holding
 * zlib-deflated raw scanlines, one IEND — which Node's own `zlib` covers.
 *
 * Deterministic on purpose (no Math.random): re-running produces byte-identical frames, so the
 * committed output can be checked against this script the way every other generated artifact
 * here is. Flat fills and Sub-filtered
 * scanlines keep each frame under 10 KB.
 *
 *   node scripts/generate-seq-frames.mjs        # writes img/seq/0001.png … 0048.png
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 480;
const H = 320;
const FRAMES = 48;
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../img/seq');

/* ── minimal PNG writer ───────────────────────────────────────────────────── */

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (bytes) => {
  let c = -1;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};
const png = (pixels) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  /**
   * Scanlines under filter 1 (Sub): each byte stores the delta from the pixel to its left.
   * The art is gradients, and a gradient's horizontal deltas are near-constant — filter 0 left
   * deflate staring at 896 KB of slowly changing bytes; Sub turns the same frames into ~450 KB.
   */
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    const row = y * (1 + W * 3);
    raw[row] = 1;
    for (let i = 0; i < W * 3; i++) {
      const at = y * W * 3 + i;
      raw[row + 1 + i] = (pixels[at] - (i < 3 ? 0 : pixels[at - 3])) & 0xff;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

/* ── the animation: an orbiting glow over a banded horizon ────────────────── */

const draw = (frame) => {
  const t = frame / FRAMES;
  const angle = t * Math.PI * 2;
  const cx = W / 2 + Math.cos(angle) * 130;
  const cy = H * 0.42 + Math.sin(angle) * 70;
  const pixels = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      /** Night-sky vertical gradient. */
      let r = 16 + (y / H) * 14;
      let g = 18 + (y / H) * 20;
      let b = 34 + (y / H) * 34;
      /** The orbiting body: a hard disc inside a soft glow. */
      const d = Math.hypot(x - cx, y - cy);
      if (d < 26) {
        r = 240; g = 200; b = 120;
      } else if (d < 70) {
        const glow = 1 - (d - 26) / 44;
        r += 200 * glow * glow;
        g += 150 * glow * glow;
        b += 60 * glow * glow;
      }
      /** Banded hills, flat fills so the deflate stays small. */
      const horizon = H * 0.72 + Math.sin(x / 70 + 1.2) * 14;
      const ridge = H * 0.84 + Math.sin(x / 45 - 0.6) * 10;
      if (y > ridge) { r = 24; g = 40; b = 46; }
      else if (y > horizon) { r = 32; g = 52; b = 64; }
      const i = (y * W + x) * 3;
      pixels[i] = Math.min(255, r | 0);
      pixels[i + 1] = Math.min(255, g | 0);
      pixels[i + 2] = Math.min(255, b | 0);
    }
  }
  return png(pixels);
};

mkdirSync(out, { recursive: true });
let bytes = 0;
for (let frame = 0; frame < FRAMES; frame++) {
  const name = `${String(frame + 1).padStart(4, '0')}.png`;
  const file = draw(frame);
  bytes += file.length;
  writeFileSync(resolve(out, name), file);
}
console.log(`wrote ${FRAMES} frames to img/seq/ (${(bytes / 1024).toFixed(0)} KB total)`);
