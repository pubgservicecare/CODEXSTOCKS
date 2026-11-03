// CODE X STOCKS — website artwork preparation.
//
// 1. Brand: cuts the red X mark and the "CODE X" wordmark out of brand-reference/codex-stocks-logo.jpeg
//    (the PUBG / Tencent marks printed under the logo are NOT included) → apps/web/assets/brand/.
// 2. Imagery: the owner's chosen PUBG Mobile pictures in brand-reference/pubg-visual-references/ are cropped,
//    rotated where needed, resized (never enlarged) and saved as optimised WebP → apps/web/assets/pubg/.
//    The originals stay out of git (they are third-party PUBG Mobile artwork); only these web copies are shipped.
//
//   node scripts/art/prepare-website-art.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LOGO = resolve(ROOT, "brand-reference/codex-stocks-logo.jpeg");
const REFS = resolve(ROOT, "brand-reference/pubg-visual-references");
const OUT_BRAND = resolve(ROOT, "apps/web/assets/brand");
const OUT_PUBG = resolve(ROOT, "apps/web/assets/pubg");
mkdirSync(OUT_BRAND, { recursive: true });
mkdirSync(OUT_PUBG, { recursive: true });

/* ------------------------------------------------------------------------------------------ */
/* brand                                                                                      */
/* ------------------------------------------------------------------------------------------ */

const BRAND_RED = [226, 16, 10];

/** Red-on-black → transparent: alpha from the red channel, colour fixed to the brand red. */
async function cutout(box, margin = 14) {
  const { data, info } = await sharp(LOGO).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const x0 = Math.max(0, box.x0 - margin), y0 = Math.max(0, box.y0 - margin);
  const x1 = Math.min(info.width - 1, box.x1 + margin), y1 = Math.min(info.height - 1, box.y1 + margin);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((y + y0) * info.width + (x + x0)) * 3;
      const redness = data[i] - Math.max(data[i + 1], data[i + 2]);
      const a = Math.max(0, Math.min(1, (redness - 26) / 150));
      const o = (y * w + x) * 4;
      out[o] = BRAND_RED[0];
      out[o + 1] = BRAND_RED[1];
      out[o + 2] = BRAND_RED[2];
      out[o + 3] = Math.round(Math.pow(a, 0.85) * 255);
    }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

async function brand() {
  const xMark = await cutout({ x0: 204, y0: 15, x1: 575, y1: 421 });
  const word = await cutout({ x0: 117, y0: 468, x1: 597, y1: 588 });
  const full = await cutout({ x0: 117, y0: 15, x1: 597, y1: 600 });
  for (const [name, png] of [["codex-x.webp", xMark], ["codex-wordmark.webp", word], ["codex-logo.webp", full]]) {
    const buf = await sharp(png).webp({ quality: 92, alphaQuality: 100, effort: 6 }).toBuffer();
    writeFileSync(resolve(OUT_BRAND, name), buf);
    console.log(`brand/${name}  ${(buf.length / 1024).toFixed(0)} KB`);
  }
  const meta = await sharp(xMark).metadata();
  const side = Math.round(Math.max(meta.width, meta.height) * 1.16);
  const square = await sharp({ create: { width: side, height: side, channels: 4, background: { r: 8, g: 8, b: 10, alpha: 1 } } })
    .composite([{ input: xMark, gravity: "center" }])
    .png()
    .toBuffer();
  writeFileSync(resolve(OUT_BRAND, "icon-256.png"), await sharp(square).resize(256, 256).png().toBuffer());
}

/* ------------------------------------------------------------------------------------------ */
/* PUBG imagery                                                                               */
/* ------------------------------------------------------------------------------------------ */

const SRC = {
  redGothic: "1009721178977735523.jfif", // red X-suit before a gothic street (fiery frame trimmed)
  goldRush: "1066579124270904389.jfif", // gold/blue suit, motion blur
  throne: "943785665680572261.jfif", // player on a throne in blue smoke
  blueGoldSea: "Bgmi X Suit Wallpaper.jfif", // blue & gold suit over the sea
  ice: "PUBG Mummy Suit Wallpaper.jfif", // ice suit in a frozen storm
  whiteRed: "PUBG X-Suit wallpaper (1).jfif", // white & red suit with hat
  blueHex: "PUBG X-Suit wallpaper.jfif", // blue & silver suit, hexagon light
  crimsonMoon: "PUBG X-Suit.jfif", // crimson suit under a red moon
  mummy: "Pubg Mobile Photo.jfif", // mummy suit on a throne
  lineup: "Pubg _ Bgmi X - Suit.jfif", // five suits (stored sideways)
};

/** One output: crop (extract) / rotate, resize to `width` (never enlarging), WebP. */
async function out(name, file, { extract, rotate, width, height, quality = 80, position = "attention" } = {}) {
  let img = sharp(resolve(REFS, file));
  if (rotate) img = img.rotate(rotate);
  if (extract) img = img.extract(extract);
  if (width || height) img = img.resize({ width, height, fit: "cover", position, withoutEnlargement: true });
  const buf = await img.webp({ quality, effort: 6, smartSubsample: true }).toBuffer();
  writeFileSync(resolve(OUT_PUBG, `${name}.webp`), buf);
  const m = await sharp(buf).metadata();
  console.log(`pubg/${name}.webp  ${m.width}x${m.height}  ${(buf.length / 1024).toFixed(0)} KB`);
}

await brand();

// Hero: phone = one full-screen portrait; desktop = three angled panels.
await out("hero-crimson", SRC.crimsonMoon, { width: 736 });
await out("hero-blue", SRC.blueHex, { width: 736 });
await out("hero-white", SRC.whiteRed, { width: 736 });

// Scroll story chapters.
await out("story-red", SRC.redGothic, { extract: { left: 36, top: 40, width: 664, height: 1228 } });
await out("story-ice", SRC.ice, { width: 736 });
await out("story-throne", SRC.throne, { extract: { left: 34, top: 164, width: 701, height: 945 } });

// "Iconic looks" gallery (portrait cards, 3:4.6).
const LOOK = { width: 480, height: 736 };
await out("look-red", SRC.redGothic, { extract: { left: 36, top: 40, width: 664, height: 1228 }, ...LOOK, position: "north" });
await out("look-blue", SRC.blueHex, { ...LOOK, position: "north" });
await out("look-sea", SRC.blueGoldSea, { ...LOOK, position: "north" });
await out("look-mummy", SRC.mummy, { extract: { left: 40, top: 0, width: 330, height: 474 }, quality: 82 });
await out("look-white", SRC.whiteRed, { ...LOOK, position: "north" });
await out("look-ice", SRC.ice, { ...LOOK, position: "centre" });
await out("look-crimson", SRC.crimsonMoon, { ...LOOK, position: "centre" });
await out("look-throne", SRC.throne, { extract: { left: 34, top: 164, width: 701, height: 945 }, width: 480, height: 640 });

// Backdrops.
await out("lineup", SRC.lineup, { rotate: 270, quality: 78 });
await out("lineup-800", SRC.lineup, { rotate: 270, width: 800, quality: 76 });
await out("gold-rush", SRC.goldRush, { quality: 70 });

// Artwork for accounts without a photo (4:3, upper body in frame).
const CARD = { width: 640, height: 480, quality: 78 };
await out("card-blue", SRC.blueHex, { extract: { left: 0, top: 70, width: 736, height: 552 }, ...CARD });
await out("card-white", SRC.whiteRed, { extract: { left: 0, top: 40, width: 736, height: 552 }, ...CARD });
await out("card-red", SRC.redGothic, { extract: { left: 36, top: 150, width: 664, height: 498 }, ...CARD });
await out("card-ice", SRC.ice, { extract: { left: 0, top: 260, width: 736, height: 552 }, ...CARD });
await out("card-sea", SRC.blueGoldSea, { extract: { left: 0, top: 40, width: 474, height: 356 }, ...CARD });
