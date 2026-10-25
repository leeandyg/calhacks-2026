import { test } from "node:test";
import assert from "node:assert/strict";
import { art, failure, PAL } from "./helpers.ts";
import { channels, pack, parseHex, rgbToHsl, shadeRamp } from "../src/core/color.ts";
import { Img } from "../src/core/image.ts";
import { lint } from "../src/core/lint.ts";

const lum = (c: number) => { const [r, g, b] = channels(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

test("selout: the outline takes each neighbor's color two ramp steps darker, else the fallback", () => {
  // ramp k < g < r < w: w is outlined in g, r in k; the fallback covers colors off the ramps
  eq(art(PAL + 'ramps("kgrw"); sprite("a", { selout: "k" }, "wr")', "a"), ".gk.\ngwrk\n.gk.");
});

test("shades: a hue-shifted ramp, dark to light, that shade/light step along", () => {
  const cols = shadeRamp(parseHex("#58a845")!, 5);
  for (let i = 1; i < cols.length; i++) assert.ok(lum(cols[i]) > lum(cols[i - 1]), "lighter left to right");
  const [h0] = rgbToHsl(...channels(cols[0]).slice(0, 3) as [number, number, number]);
  const [hb] = rgbToHsl(0x58, 0xa8, 0x45);
  assert.ok(h0 > hb, `darkest shade turns cool (hue ${h0.toFixed(0)} vs base ${hb.toFixed(0)})`);
  eq(art(PAL + 'shades("abcde", "#58a845"); sprite("a", { w: 2, h: 1 }, rect(0, 0, 2, 1, "c"), shade([0, 0, 1, 1], 1))', "a"), "bc");
  assert.match(failure(PAL + 'shades("a", "#fff")', "x").message, /2\+ new keys/);
});

test("lint: orphans, jaggies in 1-px lines, pillow shading", () => {
  const W = pack(255, 255, 255), A = pack(120, 120, 120), B = pack(124, 120, 120);
  // a gray field with one almost-gray speck: orphan (and a near-duplicate pair)
  const field = new Img(5, 5); for (let i = 0; i < 25; i++) field.data[i] = A; field.data[12] = B;
  const f = lint(field);
  assert.deepEqual(f.find((x) => x.rule === "orphan")?.at, [[2, 2]]);
  assert.ok(f.some((x) => x.rule === "near-duplicate"));
  // a diagonal 1-px line with a doubled corner at (2,1)
  const line = new Img(8, 8); for (const [x, y] of [[0, 0], [1, 1], [2, 1], [2, 2], [3, 3], [4, 4], [5, 5]]) line.data[y * 8 + x] = W;
  assert.deepEqual(lint(line).find((x) => x.rule === "jaggy")?.at, [[2, 1]]);
  // a filled blob lit from the middle on every side
  const s = 12, pil = new Img(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const d = Math.min(x, y, s - 1 - x, s - 1 - y); pil.data[y * s + x] = pack(80 + d * 30, 30 + d * 12, 40 + d * 12); }
  assert.ok(lint(pil).some((x) => x.rule === "pillow"));
  // the same blob lit from the top-left is fine
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const v = 200 - (x + y) * 6; pil.data[y * s + x] = pack(v, v * 0.4, v * 0.45); }
  assert.ok(!lint(pil).some((x) => x.rule === "pillow"));
});

function eq(a: string, b: string) { assert.equal(a, b); }
