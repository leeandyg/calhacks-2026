// The Watcher in the Frame: an eldritch portrait in an old ivory frame, 130x160.
pal({ k: "#18161c", K: "#0c0a10" })
shades("abcde", "#28968c", { spread: 0.9, sat: 1.15 })  // teal hide, head and tentacles alike: near-black sea-green -> pale aqua
shades("pqrs", "#3b2048", { spread: 0.34 })           // plum dusk behind him
shades("FGHI", "#d8cdb0", { spread: 0.42, shift: 10 })           // weathered ivory
shades("wxyzW", "#86603e", { spread: 0.8 })           // bark: dark underside to sunlit top
shades("lmn", "#8fc9a4", { spread: 0.4 })             // pale mint leaves
shades("56789", "#163a4e", { spread: 0.62, shift: 14 })  // the night sea: black-blue troughs -> pale cold crests
shades("gh", "#b8944c", { spread: 0.3, shift: 6 })              // faded gold leaf
shades("1234", "#7e1f2c", { spread: 0.62 })           // the red cloak: near-black wine -> worn crimson
pal({ v: "#9a1c26", V: "#ff4a3a", O: "#ffd08a", Y: "#d4ee6a" })   // eyes (hot core), bioluminescence

// Frame: outer 20..110 x 24..138, 9 px thick, the portrait opening 29..101 x 33..129.
const FX = 14, FY = 12, FW = 102, FH = 136, T = 6
const IX = FX + T, IY = FY + T, IW = FW - 2 * T, IH = FH - 2 * T

const rnd = (seed) => () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296)

// The watcher: a small 3D model rendered into pixels. The head and shoulders are a union of
// ellipsoids turned toward the viewer's right; each pixel is shaded from its surface normal by a
// fixed upper-left light plus a plum rim light from behind, quantized to the teal ramp with
// dithering only at the terminators. The tentacles are tubes, shaded across their width.
const BW = 92, BH = 128, HX = 44, HY = 40, TURN = (42 * Math.PI) / 180
const cT = Math.cos(TURN), sT = Math.sin(TURN)
const norm = ([x, y, z]) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l] }
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
// light from where his face points (he is turned ~42 degrees to the viewer's right), a little above;
// a cold rim from behind on the left keeps the back of the skull from vanishing into the dark
const LIGHT = norm([Math.sin(TURN) * 0.95, -0.38, Math.cos(TURN) * 0.95]), RIM = norm([-0.85, -0.2, -0.5])
const HALF = norm([LIGHT[0], LIGHT[1], LIGHT[2] + 1])
const toWorld = ([x, y, z]) => [x * cT + z * sT, y, -x * sT + z * cT]          // local -> world (turned right)
const fromWorld = ([x, y, z]) => [x * cT - z * sT, y, x * sT + z * cT]
const BAYER = [[0.1, 0.6], [0.85, 0.35]]
// [name, center, radii] in head space: x right, y down, z toward his face
const PARTS = [
  ["skull", [0, -19, -4], [26, 28, 27]], ["back", [-2, -16, -20], [23, 24, 22]],
  // the face: a longer snout, sharp cheekbones, and a heavy brow that dips into a V over the nose
  ["face", [0, 11, 9], [17, 16, 14]], ["snout", [0, 17, 17], [10, 10, 9]],
  ["cheek", [-13, 9, 13], [6, 5, 6]], ["cheek", [13, 9, 13], [6, 5, 6]],
  ...[-1, 1].flatMap((sx) => [
    ["brow", [sx * 3.5, 3, 17], [6.5, 4.2, 6]], ["brow", [sx * 9.5, 0.5, 17], [7, 4.4, 6]], ["brow", [sx * 15, -2.5, 13.5], [6.5, 4.4, 6]],
    ["knob", [sx * 13, -5.5, 14], [2.2, 2.2, 2.2]],
  ]),
  // the body: a thick neck, hunched shoulders, a heavy chest, and folded wings rising behind
  ["neck", [0, 30, -4], [17, 15, 17]],
  ["chest", [0, 64, 0], [30, 24, 22]], ["shoulder", [-25, 50, -6], [19, 14, 18]], ["shoulder", [27, 47, -10], [19, 14, 18]],
  // a high collar rises behind the neck (placed in world space, carried into head space)
  ["collar", fromWorld([-10, 30, -16]), [28, 13, 14]],
]
const EYES = [[-8, 6.5, 20.5, -1], [8, 6.5, 20.5, 1]]      // center, side (for the slant)
const shadeLevel = (n, X, Y, boost = 0, dither = 0.95) => {
  // soft falloff: the light wraps around the forms, a low fill keeps the shadows in the dark teals
  // (pure black is left for sockets and outlines), and wide dithering blends each step into the next
  const wrap = Math.max(0, (dot(n, LIGHT) + 0.45) / 1.45) ** 1.15, rim = Math.max(0, dot(n, RIM)) * (1 - Math.max(0, n[2])) ** 1.5
  const I = 0.2 + 0.72 * wrap + 0.4 * rim + boost
  return Math.max(1, Math.min(5, Math.floor(I * 5.4 + (BAYER[Y & 1][X & 1] - 0.5) * dither)))
}

sprite("_beast", { w: BW, h: BH, selout: "K" },
  (c) => {
    // --- head and shoulders
    const o0 = (px, py) => [px * cT, py, px * sT], d = [sT, 0, -cT]
    for (let Y = 0; Y < BH; Y++)
      for (let X = 0; X < BW; X++) {
        const o = o0(X - HX, Y - HY)
        let best = Infinity, hit
        for (const [name, ce, r] of PARTS) {
          const q = [(o[0] - ce[0]) / r[0], (o[1] - ce[1]) / r[1], (o[2] - ce[2]) / r[2]], e = [d[0] / r[0], d[1] / r[1], d[2] / r[2]]
          const A = dot(e, e), B = 2 * dot(q, e), C = dot(q, q) - 1, disc = B * B - 4 * A * C
          if (disc < 0) continue
          const t = (-B - Math.sqrt(disc)) / (2 * A)
          if (t < best) { best = t; hit = { name, ce, r, p: [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]] } }
        }
        if (!hit) continue
        const { name, ce, r, p } = hit
        let n = norm([(p[0] - ce[0]) / r[0] ** 2, (p[1] - ce[1]) / r[1] ** 2, (p[2] - ce[2]) / r[2] ** 2])
        if (name === "face" || name === "snout") {           // fleshy folds running down into the tentacles, a few warts
          const f = Math.sin(p[0] * 0.9 + Math.sin(p[1] * 0.25) * 2) * 0.22 * Math.max(0, Math.min(1, (p[1] - 8) / 8))
          const wart = [[-6, 14, 21], [5, 18, 23], [-10, 17, 17], [9, 12, 20]].some((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1.4) ? 0.35 : 0
          n = norm([n[0] + f, n[1] - wart, n[2] + wart])
        }
        const BODY = name === "neck" || name === "chest" || name === "shoulder"
        // the cloak: over both shoulders and down the sides, open over the scaly chest
        const cloak = name === "collar" || ((name === "chest" || name === "shoulder") && p[1] > 40 && Math.abs(p[0]) > 8 + (p[1] - 40) * 0.22)
        if (BODY && !cloak) {                                 // scales: each a tiny dome, rows offset like shingles
          const row = Math.floor(p[1] / 3.2), off = (row & 1) * 0.5
          const cx = (Math.floor(p[0] / 4 + off) + 0.5 - off) * 4, cy = (row + 0.5) * 3.2
          n = norm([n[0] + (p[0] - cx) * 0.11, n[1] + (p[1] - cy) * 0.16, n[2]])
        }
        if (cloak) n = norm([n[0] + Math.sin(p[0] * 0.55 + Math.sin(p[1] * 0.12) * 2) * 0.35, n[1], n[2]])   // heavy vertical folds
        if (name === "skull" || name === "back") {           // ridged, lumpy cranium
          const w = Math.sin(p[1] * 0.42 + 2.4 * Math.sin(p[0] * 0.11 + p[2] * 0.07)) * 0.26 + Math.sin(p[0] * 0.3 + p[1] * 0.17) * 0.08
          n = norm([n[0], n[1] + w, n[2]])
        }
        const nw = norm(toWorld(n))
        let k = shadeLevel(nw, X, Y, BODY ? -0.12 : 0)
        let col = "Kabcde"[k]
        if (cloak) {
          col = ["K", "1", "2", "2", "3", "4"][k]
          if (p[1] > 40 && Math.abs(Math.abs(p[0]) - (8 + (p[1] - 40) * 0.22)) < 1.1) col = "Kabcde"[Math.max(1, k - 1)]   // the cloak's edge, inside: shadow on the chest
          if (Math.hypot(p[0] + 9, p[1] - 44) < 2.4) col = k >= 3 ? "h" : "g"     // a faded gold clasp
        }
        if (BODY || name === "collar") {
        } else {
          if (dot(nw, HALF) > 0.95 && k >= 4) col = "e"                        // wet highlight
          // sunken hollows under the cheekbones, gill slits along the sides of the face
          if ((name === "face" || name === "snout") && p[1] > 12 && p[1] < 20 && Math.abs(p[0]) > 7 && Math.abs(p[0]) < 13) col = "Kabcde"[Math.max(0, k - 1)]
          if (name === "face" && Math.abs(p[0]) > 12 && p[1] > 12 && p[1] < 24 && Math.sin(p[1] * 1.3) > 0.75) col = "Kabcde"[Math.max(0, k - 2)]
          // eyes: angry almonds. A flat, heavy upper lid slants down toward the nose; the bottom curves.
          // The glow is hottest just under the lid; the pupil is a thin slit.
          for (const [ex, ey, ez, side] of EYES) {
            if (Math.abs(p[2] - ez) > 5) continue                              // only on the face, not the back of the skull
            const dx = p[0] - ex, dy = p[1] - ey, inward = -dx * side          // > 0 toward the nose
            const top = -0.9 + 0.6 * inward, bot = top + 3.3 * Math.max(0, 1 - (dx / 4.6) ** 2)
            if ((dx / 6.8) ** 2 + ((dy - top - 0.8) / 3.6) ** 2 < 1) col = "Kabcde"[Math.max(0, k - 2)]   // sunken socket
            if (Math.abs(dx) < 5.2 && dy > top - 1.7 && dy <= top) col = "K"                                // the lid pressing down
            if (Math.abs(dx) < 4.6 && dy > top && dy < bot) {
              col = Math.abs(dx) > 3.6 ? "v" : Math.abs(dx) < 2.6 && dy - top < 1.1 ? "O" : "V"
              if (Math.abs(dx - 0.4 * side) < 0.45) col = "K"                                               // slit pupil
            }
          }
        }
        c.px(X, Y, col)
      }

    // --- tentacles: tubes hanging from under the face, sweeping down to his right, curling at the tips
    // grav: weight. The pull toward hanging grows along the tentacle, so it leaves the face pointing
    // out and then droops more and more toward the tip, like a heavy soft limb would.
    const tentacle = (root, len, r0, sway, ph, curl, far, fan = 0, grav = 0) => {
      const w = toWorld(root), pts = []
      let x = HX + w[0], y = HY + w[1], hd = Math.PI / 2 - 0.22 + fan
      for (let t = 0; t < len; t += 0.5) {
        const k = t / len
        // hang heavy: a gentle S-sway, a pull back toward vertical, and a curl only at the tip
        hd += Math.sin(t * 0.07 + ph) * sway * 0.5 + (Math.PI / 2 - 0.1 - hd) * (0.008 + grav * k) + curl * Math.max(0, (k - 0.62) / 0.38) ** 2 * 0.1
        x += Math.cos(hd) * 0.5; y += Math.sin(hd) * 0.5
        // taper, but never under ~1.3 px, or the curled tips crumble into loose pixels
        pts.push([x, y, Math.max(1.3, r0 * (1 - 0.8 * k)), Math.cos(hd), Math.sin(hd), k])
      }
      const bestR = new Map()
      for (const [cx, cy, r, dx, dy, k] of pts)
        for (let Y = Math.floor(cy - r - 1); Y <= cy + r + 1; Y++)
          for (let X = Math.floor(cx - r - 1); X <= cx + r + 1; X++) {
            const ox = X + 0.5 - cx, oy = Y + 0.5 - cy, dd = Math.hypot(ox, oy)
            if (dd > r + (r < 2 ? 0.6 : 0.35)) continue
            if (X < 0 || X >= BW || Y < 0 || Y >= BH) continue        // off the sprite: skip before keying, or X wraps into the next row
            const key = Y * BW + X, prev = bestR.get(key)
            if (!prev || dd / r < prev[0]) bestR.set(key, [dd / r, Math.max(-1, Math.min(1, (ox * -dy + oy * dx) / r)), -dy, dx, k, r])
          }
      for (const [key, [, s, px, py, k, r]] of bestR) {
        const X = key % BW, Y = Math.floor(key / BW)
        if (X < 0 || X >= BW || Y < 0 || Y >= BH) continue
        const n = norm([s * px, s * py, Math.sqrt(Math.max(0, 1 - s * s))])
        // thin sections get a light dither only; heavy dither turns a 3 px tube into checkerboard
        let lv = shadeLevel(n, X, Y, far ? -0.25 : 0, r < 3 ? 0.35 : 0.7)
        // dark edge where tubes overlap, only where the tube is thick enough to keep a lit core
        if (r >= 2.4 && Math.abs(s) > 0.86) lv = Math.max(0, Math.min(lv, 1))
        let col = "Kabcde"[lv]
        if (!far && dot(n, HALF) > 0.97 && lv >= 3) col = "e"
        // suckers: single pale dots on the underside of the thick middle, not bands across the tube
        if (r >= 2.6 && k > 0.35 && s > 0.42 && s < 0.66 && Math.round(k * len * 2) % 9 === 0) col = far ? "l" : lv >= 3 ? "n" : "m"
        if (!far && k > 0.978 && Math.abs(s) < 0.6) col = "Y"                                       // a glowing tip, on the tube's core
        c.px(X, Y, col)
      }
    }
    // far side first (darker), then the near ones
    // [root in head space], length, radius, sway, phase, curl, far side?, fan (radians from hanging)
    // far side and behind first (in shade), then the near ones front to last
    tentacle([20, 15, 3], 52, 4.0, 0.03, 0.4, -2.2, true, -0.85)
    tentacle([15, 20, 8], 60, 4.6, 0.03, 1.0, 1.6, true, -0.5)
    tentacle([9, 23, 14], 70, 5.0, 0.03, 2.4, -1.4, true, -0.2)
    tentacle([2, 25, 16], 78, 5.4, 0.026, 0.2, 1.7, true, 0.05)
    // from the feedback: fill the far cheek, under the far eye, sweeping down and out to the right
    tentacle([18, 20, 6], 62, 4.6, 0.02, 0.7, 1.8, false, -0.7, 0.03)
    tentacle([17, 15, 9], 54, 4.8, 0.02, 2.9, -2.2, false, -1.05, 0.034)
    tentacle([15, 19, 11], 60, 5.2, 0.02, 1.3, 2.0, false, -0.85, 0.028)
    tentacle([19, 23, 4], 44, 5.0, 0.02, 2.1, -2.0, false, -1.0, 0)     // feedback 2: the gap at the far right
    tentacle([-15, 19, 9], 58, 5.6, 0.03, 2.0, -2.0, false, 0.62)
    tentacle([-17, 22, 12], 72, 5.4, 0.028, 0.8, 2.3, false, 0.42)
    tentacle([-9, 23, 14], 72, 6.2, 0.028, 3.1, -1.7, false, 0.3)
    tentacle([16, 21, 12], 60, 5.0, 0.03, 2.2, -2.5, false, -0.62)
    tentacle([-3, 25, 17], 84, 6.8, 0.024, 1.4, 1.9, false, 0.08)
    tentacle([4, 26, 17], 80, 6.6, 0.026, 0.6, -1.8, false, -0.12)
    tentacle([11, 24, 15], 68, 6.0, 0.03, 2.6, 2.1, false, -0.36)
    tentacle([8, 27, 18], 80, 6.4, 0.022, 3.4, 2.4, false, -0.04)
    tentacle([-8, 27, 18], 66, 5.4, 0.03, 0.9, -2.4, false, 0.2)
    tentacle([0, 28, 18], 50, 4.4, 0.034, 1.9, -2.4, false, 0.15)

    // --- bioluminescent specks on the lit side of the skull
    for (const lp of [[-20, -26, 12], [-14, -34, 6], [-24, -16, 14], [-8, -38, 2], [-26, -6, 10], [-18, -10, 20]]) {
      const w = toWorld(lp)
      if (toWorld(norm([lp[0], lp[1] + 16, lp[2] + 4]))[2] > 0.1) c.px(Math.round(HX + w[0]), Math.round(HY + w[1]), "Y")
    }
  })

// Boughs: smooth tapering strokes through points (a light wobble only), lit from the upper left:
// dark rim, body, a broad sunlit top and a bright edge on the thick parts.
const branch = (c, pts, w0, w1, seed = 1) => {
  // sample the whole stroke first, then paint it in passes (rims, bodies, light), so later
  // samples never paint a dark rim across the lit body of earlier ones
  const segs = pts.length - 1, sm = []
  for (let i = 0; i < segs; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], len = Math.max(0.01, Math.hypot(bx - ax, by - ay))
    for (let t = 0; t <= len; t += 0.4) {
      const k = (i + t / len) / segs, r = w0 + (w1 - w0) * k, wob = Math.sin((i * 7 + t) * 0.3 + seed) * 0.35
      sm.push([ax + ((bx - ax) * t) / len + wob * ((by - ay) / len), ay + ((by - ay) * t) / len - wob * ((bx - ax) / len), r])
    }
  }
  for (const [x, y, r] of sm) c.circ(Math.round(x + 0.4), Math.round(y + 0.6), r + 0.3, "w")
  for (const [x, y, r] of sm) c.circ(Math.round(x + 0.2), Math.round(y + 0.3), Math.max(0.5, r - 0.2), "x")
  for (const [x, y, r] of sm) c.circ(Math.round(x - r * 0.15), Math.round(y - r * 0.2), Math.max(0.5, r * 0.7), "y")
  for (const [x, y, r] of sm) if (r > 1.2) c.circ(Math.round(x - r * 0.35), Math.round(y - r * 0.4), Math.max(0.5, r * 0.35), "z")
  for (const [x, y, r] of sm) if (r > 2.4) c.px(Math.round(x - r * 0.5), Math.round(y - r * 0.6), "W")
}
// a curl that winds inward: center, start radius, turns, start angle (radians), direction
const spiral = (cx, cy, r0, turns, a0, dir = 1) =>
  Array.from({ length: Math.round(turns * 14) + 1 }, (_, i) => {
    const t = i / (turns * 14), a = a0 + dir * t * turns * Math.PI * 2, r = r0 * (1 - t * 0.85)
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
  })

sprite("_leaf_a", `
  ...nn.
  .nnmm.
  lmmmll
  .ll...`)
sprite("_leaf_b", `
  .nn...
  .mnnm.
  llmmml
  ...ll.`)
sprite("_leaf_c", `
  .n..
  nnm.
  mmml
  .mll
  ..l.`)
group("_leaf", ["_leaf_a", "_leaf_b", "_leaf_c"])

scene("eldritch", { w: 130, h: 160, bg: "k" },
  layer("portrait",
    // a dark sea at night: storm sky, a cold glow low on the right where he looks, and waves that
    // grow and spread toward us, their crests catching that glow (clipped to the opening)
    clip([IX, IY, IW, IH], (c) => {
      const HZ = IY + 50                                           // the horizon, at his eyes
      for (let y = IY; y < HZ; y++) for (let x = IX; x < IX + IW; x++) {
        const t = (y - IY) / (HZ - IY), glow = Math.max(0, 1 - Math.hypot((x - (IX + IW - 12)) / 40, (y - HZ) / 20))
        const v = t * 1.0 + glow * 2.0 + (BAYER[y & 1][x & 1] - 0.5) * 0.55
        c.px(x, y, v < 0.45 ? "K" : v < 0.95 ? "p" : v < 1.5 ? "q" : v < 1.95 ? "r" : "s")
      }
      // low storm clouds: dark masses with a lit underside toward the glow
      for (const [cx, cy, rx, ry] of [[IX + 14, IY + 22, 22, 6], [IX + 52, IY + 14, 26, 5], [IX + 30, IY + 40, 30, 5], [IX + 78, IY + 34, 20, 4], [IX + 10, IY + 56, 18, 3]]) {
        c.ellipse(cx, cy, rx, ry, "p"); c.ellipse(cx, cy - 1, rx - 2, ry - 1, "K")
        if (cx > IX + 40) c.hline(cx - rx + 5, cy + ry - 1, rx * 2 - 10, "q")
      }
      for (let y = HZ; y < IY + IH; y++) for (let x = IX; x < IX + IW; x++) {
        const d = (y - HZ) / (IY + IH - HZ)
        const g = Math.max(0, 1 - Math.abs(x - (IX + IW - 12)) / 30) * (1 - d)       // the glow, reflected
        c.px(x, y, g > 0.55 ? "7" : g > 0.3 || d < 0.2 ? "6" : d < 0.55 ? ((x + y) % 2 ? "6" : "5") : "5")
      }
      c.hline(IX, HZ, IW, "7")                                     // the horizon line
      // wave rows: farther apart and taller toward us; crests brighter on the glittering path
      for (const [dy, amp, len] of [[2, 0.5, 7], [4, 0.6, 8], [7, 0.8, 10], [11, 1, 12], [16, 1.3, 14], [22, 1.6, 17], [30, 2, 20], [40, 2.4, 24], [52, 2.8, 28], [64, 3, 32]]) {
        const y0 = HZ + dy
        if (y0 >= IY + IH) break
        for (let x = IX; x < IX + IW; x++) {
          const ph = Math.sin(dy * 1.7) * 3, w = Math.sin((x + ph * 4) * (Math.PI * 2 / len))
          if (w < 0.25) continue                                 // only the crest part of each wave
          const y = Math.round(y0 - amp * w), path = Math.max(0, 1 - Math.abs(x - (IX + IW - 12) + dy * 0.25) / 22)
          c.px(x, y, path > 0.5 ? "9" : path > 0.2 || w > 0.85 ? "8" : "7")
          if (amp > 1.2) c.px(x, y + 1, "6")
        }
      }
    }),
    shade([IX, IY + IH - 16, IW, 16], 1, 0.5),
    clip([IX, IY, IW, IH], stamp("_beast", IX - 4, IY - 2))),
  layer("frame", (c) => {
    // a plain, narrow ivory moulding, lit from the upper left, with a thin dark inner line
    c.rect(FX, FY, FW, FH, "H"); c.rect(IX, IY, IW, IH, "_")
    c.hline(FX, FY, FW, "I"); c.vline(FX, FY, FH, "I"); c.hline(FX + 1, FY + 1, FW - 2, "I")
    c.hline(FX, FY + FH - 1, FW, "F"); c.vline(FX + FW - 1, FY, FH, "F")
    c.hline(FX + 2, FY + FH - 2, FW - 3, "G"); c.vline(FX + FW - 2, FY + 2, FH - 3, "G")
    c.box(FX + 3, FY + 3, FW - 6, FH - 6, "G")                          // one shallow groove
    c.box(IX - 1, IY - 1, IW + 2, IH + 2, "F"); c.box(IX, IY, IW, IH, "K")
  },
    // weathering: chips, a crack, grime
    rect(FX + FW - 4, FY, 4, 2, "_"), px(FX + FW - 1, FY + 2, "_"),
    line(FX + 5, FY + FH - 1, FX + 7, FY + FH - 5, "F"), line(FX + FW - 2, FY + 52, FX + FW - 4, FY + 57, "F"),
    px(FX + 1, FY + 70, "G"), px(FX + 2, FY + 71, "G"), shade([FX + 1, FY + FH - 40, 3, 36], 1, 0.35)),
  glow("Y", { r: 3, strength: 0.6 }), glow("VO", { r: 3, strength: 0.45 }))
