import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { pack, TRANSPARENT } from "../src/core/color.ts";
import { Img } from "../src/core/image.ts";
import { extractPalette, quantize, resample } from "../src/core/quant.ts";
import { decodePng, encodePng } from "../src/node/png.ts";
import { loadProject, loadSource } from "../src/node/load.ts";
import { traceFile, traceRgba } from "./../src/node/trace.ts";
import { art, keys, PAL } from "./helpers.ts";

/** A raw RGBA / gray PNG with every scanline filter type, to exercise the decoder's unfiltering. */
function rawPng(w: number, h: number, type: 0 | 2 | 6, px: Uint8Array, filters: number[]): Buffer {
  const chans = type === 0 ? 1 : type === 2 ? 3 : 4, row = w * chans;
  const raw = Buffer.alloc(h * (row + 1));
  const at = (x: number, y: number, k: number) => px[(y * w + x) * chans + k];
  for (let y = 0; y < h; y++) {
    const f = filters[y % filters.length];
    raw[y * (row + 1)] = f;
    for (let i = 0; i < row; i++) {
      const x = Math.floor(i / chans), k = i % chans, cur = at(x, y, k);
      const a = x > 0 ? at(x - 1, y, k) : 0, b = y > 0 ? at(x, y - 1, k) : 0, c = x > 0 && y > 0 ? at(x - 1, y - 1, k) : 0;
      let pred = 0;
      if (f === 1) pred = a; else if (f === 2) pred = b; else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      raw[y * (row + 1) + 1 + i] = (cur - pred) & 255;
    }
  }
  const chunk = (t: string, d: Buffer) => { const head = Buffer.alloc(8); head.writeUInt32BE(d.length, 0); head.write(t, 4, "ascii"); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), d])) >>> 0, 0); return Buffer.concat([head, d, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = type;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("png decode: round-trips pxl's own indexed and RGBA output, and unfilters every filter type", () => {
  const img = new Img(5, 3);
  for (let i = 0; i < 15; i++) img.data[i] = i % 4 === 0 ? TRANSPARENT : pack(i * 17, 255 - i * 9, (i * 51) & 255);
  const back = decodePng(encodePng(img));
  assert.deepEqual([back.w, back.h], [5, 3]);
  for (let i = 0; i < 15; i++) {
    const c = img.data[i], o = i * 4;
    if (c === TRANSPARENT) assert.equal(back.rgba[o + 3], 0);
    else assert.deepEqual([...back.rgba.subarray(o, o + 4)], [c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, 255]);
  }
  const big = new Img(20, 20);
  for (let i = 0; i < 400; i++) big.data[i] = pack(i % 256, Math.floor(i / 2), 7);
  const rgba = decodePng(encodePng(big));
  assert.equal(rgba.rgba[(3 * 20 + 7) * 4], 67);
  const px = new Uint8Array(6 * 5 * 3).map((_, i) => (i * 37) & 255);
  const d = decodePng(rawPng(6, 5, 2, px, [0, 1, 2, 3, 4]));
  for (let i = 0; i < 30; i++) assert.deepEqual([...d.rgba.subarray(i * 4, i * 4 + 3)], [px[i * 3], px[i * 3 + 1], px[i * 3 + 2]]);
  const gray = new Uint8Array(4 * 4).map((_, i) => i * 16);
  const g = decodePng(rawPng(4, 4, 0, gray, [4, 3]));
  assert.deepEqual([...g.rgba.subarray(5 * 4, 5 * 4 + 4)], [80, 80, 80, 255]);
  assert.throws(() => decodePng(Buffer.from("not a png")), /not a PNG/);
});

test("resample averages when shrinking (alpha-weighted) and quantize picks the nearest palette color", () => {
  const src = { w: 4, h: 2, rgba: new Uint8Array(32) };
  // left half red, right half blue; one transparent pixel in the red half
  for (let i = 0; i < 8; i++) src.rgba.set(i % 4 < 2 ? [200, 0, 0, 255] : [0, 0, 200, 255], i * 4);
  src.rgba[3] = 0;
  const s = resample(src, 2, 1);
  assert.deepEqual([...s.rgba], [200, 0, 0, 191, 0, 0, 200, 255]);
  const q = quantize(s, [pack(255, 0, 0), pack(0, 0, 255), pack(0, 255, 0)]);
  assert.deepEqual([...q], [pack(255, 0, 0), pack(0, 0, 255)]);
  assert.equal(quantize(s, [pack(255, 0, 0)], { alpha: 200 })[0], TRANSPARENT);
  const up = resample(src, 8, 2);
  assert.deepEqual([...up.rgba.subarray(0, 4)], [200, 0, 0, 0]);
});

test("extractPalette finds the dominant colors, dark to light", () => {
  const w = 30, h = 10, rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set(i % w < 10 ? [20, 20, 20, 255] : i % w < 20 ? [200, 40, 40, 255] : [250, 250, 250, 255], i * 4);
  const cols = extractPalette({ w, h, rgba }, 3);
  assert.deepEqual(cols.map((c) => [c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255]), [[20, 20, 20], [200, 40, 40], [250, 250, 250]]);
  assert.equal(extractPalette({ w, h, rgba }, 8).length, 3, "no more colors than the image has");
});

test("image(): a PNG lands in the palette at the asked size; palette: false keeps true colors", () => {
  const dir = mkdtempSync(join(tmpdir(), "pxl-img-"));
  const src = new Img(8, 4), dark = new Img(8, 4);
  for (let i = 0; i < 32; i++) {
    src.data[i] = i % 8 < 4 ? pack(250, 10, 70) : pack(10, 220, 60);
    dark.data[i] = i % 8 < 4 ? pack(60, 5, 5) : pack(240, 240, 240);
  }
  writeFileSync(join(dir, "ref.png"), encodePng(src));
  writeFileSync(join(dir, "dark.png"), encodePng(dark));
  writeFileSync(join(dir, "a.px.js"), PAL + `
sprite("a", { w: 4, h: 2 }, image("ref.png", 0, 0, { w: 4 }))
sprite("b", { w: 8, h: 4 }, image("ref.png", 0, 0, { palette: false }))
sprite("c", { w: 4, h: 2 }, image("dark.png", 0, 0, { scale: 0.5, palette: "kw" }))
sprite("d", { w: 2, h: 1 }, image("ref.png", 0, 0, { h: 1 }))`);
  const p = loadProject(join(dir, "a.px.js"));
  assert.equal(keys(p, "a"), "rrgg\nrrgg");
  assert.equal(p.image("b").data[0], pack(250, 10, 70));
  assert.equal(keys(p, "c"), "kkww\nkkww", "dark red reads as dark, near-white as light");
  assert.equal(keys(p, "d"), "rg");
  assert.throws(() => loadSource(`sprite("x", { w: 2, h: 2 }, image("nope.png", 0, 0))`).image("x"), /cannot read image/);
  assert.throws(() => loadSource(`sprite("x", { w: 2, h: 2 }, image("ref.png", 0, 0, { palett: "r" }))`), /did you mean 'palette'/);
});

test("trace writes source that rebuilds the same pixels and reports fidelity", () => {
  const dir = mkdtempSync(join(tmpdir(), "pxl-trace-"));
  const src = new Img(16, 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) src.data[y * 16 + x] = y < 4 ? pack(30, 60, 200) : x < 8 ? pack(230, 200, 60) : TRANSPARENT;
  writeFileSync(join(dir, "ref.png"), encodePng(src));
  const t = traceFile(join(dir, "ref.png"), { colors: 4, name: "ref" });
  assert.equal(t.colors, 2);
  assert.equal(t.fit.meanError, 0);
  assert.match(t.source, /^\/\/ Traced from ref\.png/);
  const back = loadSource(t.source, "ref.px.js").image("ref");
  assert.deepEqual([...back.data], [...src.data]);
  // a built-in palette and a smaller size
  const q = traceRgba(decodePng(encodePng(src)), { palette: "pico8", w: 8 });
  assert.deepEqual([q.w, q.h], [8, 4]);
  assert.match(q.source, /use\("pico8"\)/);
  const rows = keys(loadSource(q.source, "q.px.js"), "traced").split("\n");
  assert.equal(rows.length, 4);
  assert.doesNotMatch(rows[0], /\./, "the blue top row is fully opaque");
  assert.match(rows[3], /^[0-9a-f]{4}\.\.\.\.$/, "the bottom-right quarter is transparent");
});

test("rot: any angle rotates about the center and grows the canvas; multiples of 90 stay exact", () => {
  const p = loadSource(PAL + `
sprite("bar", "rrrr")
sprite("q", { base: "bar", rot: 90 })
sprite("d", { base: "bar", rot: 45 })
sprite("s", { w: 8, h: 8 }, stamp("bar", 2, 3, { rot: 30 }))`);
  assert.equal(keys(p, "q"), "r\nr\nr\nr");
  const d = p.image("d");
  assert.deepEqual([d.w, d.h], [4, 4]);
  const lit = [...d.data].filter((c) => c !== TRANSPARENT).length;
  assert.ok(lit >= 4 && lit <= 8, `diagonal bar keeps about its pixels, got ${lit}`);
  assert.equal(d.get(0, 0), pack(255, 0, 77), "a bar rotated 45 clockwise runs from the top-left");
  assert.equal(d.get(3, 3), pack(255, 0, 77), "to the bottom-right");
  assert.equal(d.get(3, 0), TRANSPARENT);
  assert.ok([...p.image("s").data].some((c) => c !== TRANSPARENT));
  assert.throws(() => loadSource(PAL + `sprite("x", { base: "bar", rot: "x" })\nsprite("bar", "r")`).image("x"), /rot must be a number/);
});

test("isobox draws top, left and right faces with ramp shades; iso() projects the same way", () => {
  const p = loadSource(`use("pico8"); pal({ k: 0, r: 8, w: 7 }); ramps("krw")
sprite("b", { w: 16, h: 16 }, isobox(0, 0, 0, 1, 1, 1, "w", { size: 8, at: [8, 4] }))
sprite("t", { w: 16, h: 16 }, isobox(0, 0, 0, 1, 1, 1, "w", { size: 8, at: [8, 4], left: "r", right: "r", top: "r" }))`);
  const b = p.image("b"), t = p.image("t");
  const W = pack(255, 241, 232), R = pack(255, 0, 77);
  assert.equal(b.get(8, 1), W, "top face");
  assert.equal(b.get(5, 4), R, "left face: one step darker");
  assert.equal(b.get(10, 4), pack(0, 0, 0), "right face: two steps darker");
  assert.equal(b.get(8, 9), TRANSPARENT, "nothing below the block");
  assert.equal(t.get(5, 4), R);
  assert.equal(t.get(8, 1), R);
  const iso = loadSource(`const p = iso(1, 0, 0, 8, [8, 4]); sprite("a", { w: 1, h: 1 }, px(0, 0, p[0] === 12 && p[1] === 6 ? "7" : "8"))`);
  assert.equal(iso.image("a").data[0], pack(255, 241, 232));
});
