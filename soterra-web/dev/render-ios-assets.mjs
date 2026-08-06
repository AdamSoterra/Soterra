// Generate the iOS app icon and splash from the Soterra mark.
//
//   node dev/render-ios-assets.mjs
//
// Two things make this fiddly enough to be worth a script rather than a
// one-off:
//
//  1. App Store Connect REJECTS an icon that has an alpha channel
//     (ITMS-90717) — and "opaque" is not the same as "no alpha channel". Every
//     Soterra asset on disk is colorType 6 (RGBA), and any canvas encoder will
//     hand back RGBA too. So we flatten onto white and then encode the PNG
//     ourselves as colorType 2 (true RGB, no alpha channel at all).
//  2. The source mark carries its own padding. iOS applies its own rounded
//     mask, so the icon must be full-bleed square with the mark laid out to a
//     deliberate coverage — we measure the mark's real bounding box rather
//     than trusting the source padding.
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const SRC = "public/icon-512.png";
const ICON_OUT = "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png";
const SPLASH_DIR = "ios/App/App/Assets.xcassets/Splash.imageset";
const WHITE = [255, 255, 255];

/** Minimal PNG encoder, colorType 2 (8-bit RGB). No alpha channel exists in
 *  the output at all, which is the whole point — see note 1 above. */
function encodeRGB(rgb, w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colorType 2 = truecolour RGB
  // rows are filter-type 0 (None) followed by the raw RGB triples
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const o = y * (1 + w * 3);
    raw[o] = 0;
    rgb.copy(raw, o + 1, y * w * 3, (y + 1) * w * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let CRC_T = null;
function crc32(buf) {
  if (!CRC_T) {
    CRC_T = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_T[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/** Flatten a canvas onto white and drop the alpha channel. */
function flatten(canvas) {
  const { width: w, height: h } = canvas;
  const src = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  const out = Buffer.alloc(w * h * 3);
  for (let i = 0, j = 0; i < src.length; i += 4, j += 3) {
    const a = src[i + 3] / 255;
    for (let c = 0; c < 3; c++) out[j + c] = Math.round(src[i + c] * a + WHITE[c] * (1 - a));
  }
  return out;
}

/** The mark's real bounding box, ignoring transparent and white padding. */
function markBounds(img) {
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      const a = d[i + 3];
      if (a < 12) continue;                                  // transparent
      if (d[i] > 244 && d[i + 1] > 244 && d[i + 2] > 244) continue; // white
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Draw the mark centred on a white square at `coverage` of the canvas. */
function compose(img, b, size, coverage) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, size, size);
  const scale = (size * coverage) / Math.max(b.w, b.h);
  const dw = b.w * scale, dh = b.h * scale;
  ctx.drawImage(img, b.x, b.y, b.w, b.h, (size - dw) / 2, (size - dh) / 2, dw, dh);
  return canvas;
}

const img = await loadImage(fs.readFileSync(SRC));
const b = markBounds(img);
console.log(`mark bounds in ${SRC}: ${b.w}x${b.h} at ${b.x},${b.y}`);

// 0.72 matches how much of the frame the Android launcher icon fills, so the
// two platforms look like the same app on a home screen.
fs.writeFileSync(ICON_OUT, encodeRGB(flatten(compose(img, b, 1024, 0.72)), 1024, 1024));
console.log(`wrote ${ICON_OUT} — 1024x1024, RGB, no alpha channel`);

// Splash sits behind a brief launch; the mark is small and centred.
const splash = compose(img, b, 2732, 0.16);
const splashRGB = flatten(splash);
for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  fs.writeFileSync(path.join(SPLASH_DIR, name), encodeRGB(splashRGB, 2732, 2732));
  console.log(`wrote ${path.join(SPLASH_DIR, name)}`);
}
