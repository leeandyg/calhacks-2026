// LAST CUP (isometric): a broken robot alone in an underground cafe, rain on the glass.
pal({
  k: "#07060b",
  1: "#2c2b34", 2: "#3e3d4a", 3: "#52505f", 4: "#686678", 5: "#837f94", 6: "#a8a3b6",   // concrete
  u: "#4a2a1e", U: "#6c3e26", v: "#925a34", V: "#b87c48",                                // rust
  R: "#3e0a15", r: "#9a1830", q: "#f03a54", Q: "#ffb0ba",                                // neon red
  T: "#082a32", t: "#178c9c", j: "#55dcee", J: "#ccfaff",                                // neon cyan
  S: "#06080f", s: "#0c1220", x: "#141c30", X: "#1f2a44",                                // night / glass
  a: "#5e4220", A: "#b08646",                                                            // far windows
  m: "#3a4048", M: "#58606c", n: "#7c8694", N: "#aab4c0",                                // robot steel
  c: "#2e2620", C: "#463a2e", d: "#62503e",                                              // old coat
  w: "#a8a090", W: "#ddd4c0", o: "#1c0e06",                                              // cups, coffee
  e: "#12361e", E: "#3fae5e",                                                            // terminal phosphor
  l: "#7a3a12", L: "#e0903a",                                                            // bulb
})
ramps("k123456", "uUvV", "RrqQ", "TtjJ", "SsxX", "aA", "kmMnN", "kcCd", "wW", "eE", "lL")

// Isometric grid: u runs down-right, v down-left, h up. 1 unit = 2px across, 1px down.
const O = [120, 64], H = 56, N = 52
const P = (u, v, h = 0) => [O[0] + 2 * u - 2 * v, O[1] + u + v - h]
const Q = (...pts) => pts.flat()

const rnd = (seed) => () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296)

// The city through the glass: brutalist slabs, a few lit windows, dead neon, haze at the bottom.
sprite("_city", { w: 76, h: 76 },
  grad(0, 0, 76, 76, "SsxX", "v", 0.6),
  (c) => {
    const r = rnd(7)
    for (const [x, w, h, col] of [[0, 14, 58, "s"], [10, 10, 70, "S"], [19, 16, 50, "s"], [33, 9, 64, "S"],
      [41, 14, 44, "s"], [53, 8, 72, "S"], [60, 16, 54, "s"]]) {
      c.rect(x, 76 - h, w, h, col)
      for (let y = 76 - h + 3; y < 74; y += 3)
        for (let xx = x + 2; xx < x + w - 1; xx += 2)
          if (r() < 0.07) c.px(xx, y, r() < 0.7 ? "a" : "A")
    }
    c.vline(37, 4, 8, "s"); c.px(37, 3, "r")                          // antenna, red warning light
    c.vline(56, 0, 6, "S"); c.px(56, 0, "R")
    c.rect(22, 30, 8, 3, "R"); c.rect(23, 31, 6, 1, "r")               // dead billboard
    c.rect(62, 40, 3, 9, "T"); c.vline(63, 41, 7, "t")
  })

// ---------------------------------------------------------------- motion (16 frames, loops)
const F = { frames: 16, fps: 10 }
anim("_rain_out", { w: 76, h: 76, ...F }, (c) => {
  const r = rnd(11)
  for (let i = 0; i < 46; i++) {
    const x0 = r() * 90, y0 = r() * 76, y = (y0 + c.phase * 76 * 3) % 76, x = Math.round(x0 - y * 0.25)
    c.line(x, Math.round(y), x - 1, Math.round(y) + 3, r() < 0.3 ? "X" : "x")
  }
})
anim("_rain_glass", { w: 76, h: 76, ...F }, (c) => {
  const r = rnd(5)
  for (let i = 0; i < 16; i++) {
    const x = Math.floor(r() * 76), y0 = r() * 76, y = Math.round((y0 + c.phase * 76) % 76), len = 2 + Math.floor(r() * 5)
    c.vline(x, y - len, len, "x"); c.px(x, y, "6")
  }
})
anim("_smoke", { w: 12, h: 26, ...F }, (c) => {
  for (let j = 0; j < 7; j++) {
    const t = (c.phase + j / 7) % 1, y = Math.round(25 - t * 25), x = Math.round(5 + Math.sin(t * 7 + j * 0.6) * 3 * t)
    if (t > 0.85) continue
    c.px(x, y, t < 0.4 ? "5" : "4")
    if (t > 0.3 && j % 2) c.px(x + 1, y - 1, "3")
  }
})
anim("_cafe", { w: 9, h: 27, ...F }, (c) => {
  c.rect(0, 0, 9, 27, "1"); c.box(0, 0, 9, 27, "R")
  const dead = [5, 6, 11].includes(c.frame)                           // the F is dying
  ;["C", "A", "F", "E"].forEach((ch, i) => c.text(3, 2 + i * 6, ch, ch === "F" && dead ? "R" : "q"))
})

// An iso box: top, the face toward the viewer's left (v = v1), the face toward the right (u = u1).
const box = (c, u0, v0, u1, v1, h, top, left, right, z = 0) => {
  c.poly(Q(P(u0, v1, z), P(u1, v1, z), P(u1, v1, z + h), P(u0, v1, z + h)), left)
  c.poly(Q(P(u1, v0, z), P(u1, v1, z), P(u1, v1, z + h), P(u1, v0, z + h)), right)
  c.poly(Q(P(u0, v0, z + h), P(u1, v0, z + h), P(u1, v1, z + h), P(u0, v1, z + h)), top)
}

sprite("_cup", `
  .WWW.
  WoooW.
  wWWwww
  wwwwW.
  .www.`)
sprite("_cup_tipped", `
  .wwW..
  Wwwwwo
  .wWw.o`)
sprite("_stool", { selout: "k" }, `
  ..vVVv..
  .vvvvvv.
  UUUUUUUU
  ...M1...
  ...M1...
  ...M1...
  ...M1...
  ...M1...
  ...M1...
  ..MMM1..
  .M1..M1.`)
sprite("_ashtray", `
  .1kqk1.
  5444445
  .33333.`)
// A hooded drinker asleep on the counter, a cigarette burning down between two fingers.
sprite("_sleeper", { w: 16, h: 22, selout: "k" },
  poly([2, 6, 12, 4, 15, 20, 1, 20], "c"), poly([2, 6, 6, 5, 4, 20, 1, 20], "C"),
  ellipse(5, 5, 4, 3, "c"), ellipse(4, 4, 2, 2, "C"),                  // hood, face down on the arms
  rect(0, 7, 9, 3, "C"), hline(0, 7, 8, "d"),
  px(0, 8, "W"), px(-1, 8, "q"))
// What's left of another robot, on the floor under the window.
sprite("_dead_head", { selout: "k" }, `
  ..MMMMM..
  .MnnMMMm.
  MnmmMMMmm
  MkkMMMMmm
  .MMMMMmm.
  ..mmmm.kk
  .......k.`)

// The robot, seated, facing the window (left). Lit from the glass and the bulb on his left:
// cracked visor with one eye left, mouth grille, rivets and dents, a snapped antenna, bare neck
// cables, a patched coat torn over a chest light, a missing button, a piston shin weeping oil.
sprite("_robot", { selout: "k" }, `
  ..........NNnnnMm...km........
  .........NnnnnnmMMm.k.........
  ........NnnnnnMnmkMmk.........
  ........NmmmmmnnMMMm..........
  ........mjJjkmnMnMMm..........
  ........mmmmmkmnMMkm..........
  .........nnnnmmnMMma..........
  .........mkmkmnnMMm...........
  ..........mmmmnMMm............
  ............mkrkm.............
  ..........dddktkmdd...........
  .........dddCkkCcd............
  ..........ddddCCCccccvUU......
  ...........dCCckmCcccUvU......
  ...........dCCckqCcccUvU......
  ..........dCCcdCCCcccUvU......
  .........dCCcndCCCCcccvU......
  .........dCCccdCCvvvccvU......
  nN.......dCCcdCCCkUUccvU......
  nnNmdddddddccnCCCUUUccvU......
  MnnmCCCCCCCdcdCCCkUUccvu......
  mM.McccccccdcdCCCCccccvu......
  ....c....cdcnCCCCCccccvU......
  ..........dcdCCCCCccccvU......
  .........cccccnccccccccU......
  ....ddddddddddddCCCccccU......
  ....CCCCCCCCCCCCCCCccccU......
  ....CCCCCCCCCCCCCCCccccU......
  ....ccccccccccccccvvvvvv......
  ....NM..ccUUUcUUUUUUUUUU......
  ...NnMm....U......cc..U.......
  ....Mm.k...u......ccc.u.......
  ....nMmk...u......c.c.u.......
  ....nMNk...u..........u.......
  ....nMN....u..........u.......
  ....nMN....u..........u.......
  ...mMMm....u..........u.......
  ..mMnnMm...u..........u.......
  .mmmmmmmo..u..........u.......
  ........o.....................`)

// The same robot without his right arm, so the arm can move.
sprite("_robot_body", `
  ..........NNnnnMm...km........
  .........NnnnnnmMMm.k.........
  ........NnnnnnMnmkMmk.........
  ........NmmmmmnnMMMm..........
  ........mjJjkmnMnMMm..........
  ........mmmmmkmnMMkm..........
  .........nnnnmmnMMma..........
  .........mkmkmnnMMm...........
  ..........mmmmnMMm............
  ............mkrkm.............
  ..........dddktkmdd...........
  .........dddCkkCcd............
  ..........ddddCCCccccvUU......
  ............ddckmCcccUvU......
  ............ddckqCcccUvU......
  ...........ddcdCCCcccUvU......
  ...........ddndCCCCcccvU......
  ...........ddcdCCvvvccvU......
  ...........dcdCCCkUUccvU......
  ...........dcnCCCUUUccvU......
  ..........ddcdCCCkUUccvu......
  ..........ddcdCCCCccccvu......
  ..........dcnCCCCCccccvU......
  ..........dcdCCCCCccccvU......
  .........cccccnccccccccU......
  ....ddddddddddddCCCccccU......
  ....CCCCCCCCCCCCCCCccccU......
  ....CCCCCCCCCCCCCCCccccU......
  ....ccccccccccccccvvvvvv......
  ....NM..ccUUUcUUUUUUUUUU......
  ...NnMm....U......cc..U.......
  ....Mm.k...u......ccc.u.......
  ....nMmk...u......c.c.u.......
  ....nMNk...u..........u.......
  ....nMN....u..........u.......
  ....nMN....u..........u.......
  ...mMMm....u..........u.......
  ..mMnnMm...u..........u.......
  .mmmmmmmo..u..........u.......
  ........o.....................`)
sprite("_cup_tilt", `
  ..WW..
  .WooW.
  WoowwW
  .wwwW.
  ..ww..`)

// The sip: 16 s (160 frames at 10 fps), twice per 32 s soundtrack. The cup rests for 6 s, rises
// over 1.2 s, tips at his grille for 2.8 s (the eye dims), comes down, and rests again.
const ease = (t) => t * t * (3 - 2 * t)
const pose = (f) => f < 60 ? 0 : f < 72 ? ease((f - 60) / 12) : f < 100 ? 1 : f < 112 ? 1 - ease((f - 100) / 12) : 0
const mix = (a, b, t) => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t)]
anim("_robot_drink", { w: 36, h: 40, frames: 160, fps: 10, selout: "k" },
  stamp("_robot_body", 6, 0),
  (c) => {
    const e = pose(c.frame), sip = c.frame >= 74 && c.frame < 98
    const shoulder = [18, 13], elbow = mix([14, 21], [13, 18], e), hand = mix([7, 19], [13, 8], e)
    const cup = mix([1, 16], [8, 4], e)
    c.stamp(sip ? "_cup_tilt" : "_cup", cup[0], cup[1])
    // a sleeve: lit edge, body, shaded edge, offset across the limb's direction
    const sleeve = (a, b) => {
      c.line(a[0], a[1], b[0], b[1], "c", 3)                     // shaded body of the sleeve
      c.line(a[0], a[1] - 1, b[0], b[1] - 1, "C", 2)              // lit toward the bulb and the glass
      c.line(a[0] - 1, a[1] - 1, b[0] - 1, b[1] - 1, "d")
    }
    sleeve(shoulder, elbow); sleeve(elbow, hand)
    c.px(elbow[0] + 1, elbow[1] + 1, "c")                       // the sleeve bunching at the elbow
    c.grid(hand[0] - 1, hand[1] - 1, "nN.\nnnN\nMnn\nmM.")       // steel fingers around the cup
    if (sip) { c.px(15, 4, "m"); c.px(16, 4, "t") }             // the eye dims while he drinks
  })

scene("last_cup_iso", { w: 240, h: 180, bg: "k" },
  layer("room", (c) => {
    c.poly(Q(P(N, 0), P(N, N), P(N, N, -5), P(N, 0, -5)), "1")              // slab edge
    c.poly(Q(P(0, N), P(N, N), P(N, N, -5), P(0, N, -5)), "k")
    c.poly(Q(P(0, 0), P(N, 0), P(N, N), P(0, N)), "2")                     // floor
    c.poly(Q(P(0, 0), P(0, N), P(0, N, H), P(0, 0, H)), "3")               // left wall (window wall)
    c.poly(Q(P(0, 0), P(N, 0), P(N, 0, H), P(0, 0, H)), "4")               // right wall
    for (const i of [13, 26, 39]) {                                        // floor slabs
      c.line(...P(i, 0), ...P(i, N), "1"); c.line(...P(0, i), ...P(N, i), "1")
    }
    for (const u of [13, 26, 39]) c.line(...P(u, 0, 0), ...P(u, 0, H), "3") // poured panel seams
    c.line(...P(0, 0, 28), ...P(N, 0, 28), "3")
    c.line(...P(0, 0), ...P(0, 0, H), "1")                                 // inner corner
    c.line(...P(0, 0, H), ...P(N, 0, H), "5"); c.line(...P(0, 0, H), ...P(0, N, H), "5")   // wall caps
    const r = rnd(3)
    for (let v = 2; v < N; v += 1 + Math.floor(r() * 4)) {                // water stains from the cap
      const len = 3 + Math.floor(r() * 14); c.line(...P(0, v, H - 1), ...P(0, v, H - 1 - len), "2")
    }
    for (let u = 3; u < N; u += 2 + Math.floor(r() * 5)) {                // rust runs under the tube brackets
      const len = 4 + Math.floor(r() * 16); c.line(...P(u, 0, 50), ...P(u, 0, 50 - len), r() < 0.5 ? "U" : "u")
    }
    for (const v of [9, 15, 22, 29, 36, 43]) c.line(...P(0, v, 11), ...P(0, v, 3 + (v % 5)), "u")  // under the sill
    c.line(...P(30, 18), ...P(33, 22), "1"); c.line(...P(33, 22), ...P(32, 27), "1"); c.line(...P(33, 22), ...P(38, 24), "1")  // cracks
    c.line(...P(6, 34), ...P(10, 37), "1"); c.line(...P(10, 37), ...P(10, 44), "1")
    c.line(...P(18, 46), ...P(22, 50), "1")
    // standing water: it holds the room's light
    const [px1, py1] = P(16, 40), [px2, py2] = P(40, 24)
    c.ellipse(px1, py1, 15, 5, "1"); c.ellipse(px1, py1, 13, 4, "3")
    for (const dx of [-9, -5, -1, 3]) { c.vline(px1 + dx, py1 - 3, 3, "6"); c.vline(px1 + dx + 1, py1 - 2, 2, "5") }   // the window, upside down
    c.px(px1 - 6, py1 + 1, "A"); c.px(px1 + 2, py1 + 2, "a"); c.hline(px1 - 10, py1 + 1, 4, "5")
    c.ellipse(px2, py2, 11, 4, "1"); c.ellipse(px2, py2, 9, 3, "3")
    for (const [dx, dy, n] of [[-4, -2, 2], [-3, 0, 3], [-4, 2, 1]]) c.hline(px2 + dx, py2 + dy, n, "r")   // the sign, broken by ripples
    for (const [dx, dy, n] of [[2, -2, 4], [4, 0, 3], [3, 2, 2]]) c.hline(px2 + dx, py2 + dy, n, "t")
  }),
  // The window: a parallelogram on the left wall, the city behind it.
  layer("window", { unlit: true },
    clip(Q(P(0, 8, 12), P(0, 44, 12), P(0, 44, 48), P(0, 8, 48)), stamp("_city", 30, 22), stamp("_rain_out", 30, 22), stamp("_rain_glass", 30, 22)),
    (c) => {
      for (const v of [20, 32]) { c.line(...P(0, v, 12), ...P(0, v, 48), "2"); c.line(...P(0, v + 0.5, 12), ...P(0, v + 0.5, 48), "k") }
      c.line(...P(0, 8, 30), ...P(0, 44, 30), "2"); c.line(...P(0, 8, 29), ...P(0, 44, 29), "k")
      c.line(...P(0, 8, 48), ...P(0, 44, 48), "1"); c.line(...P(0, 8, 49), ...P(0, 44, 49), "k")
      c.line(...P(0, 8, 12), ...P(0, 44, 12), "5"); c.line(...P(0, 8, 11), ...P(0, 44, 11), "1")   // sill
      c.line(...P(0, 8, 12), ...P(0, 8, 48), "1"); c.line(...P(0, 44, 12), ...P(0, 44, 48), "1")
    },
  ),
  layer("bar", (c) => {
    box(c, 16, 0, 48, 9, 15, "5", "3", "2")                                     // the counter
    for (const u of [24, 32, 40]) c.line(...P(u, 9, 1), ...P(u, 9, 14), "2")     // panel seams
    c.line(...P(16, 9, 15), ...P(48, 9, 15), "6")                               // worn steel lip
    c.line(...P(16, 9.5, 2), ...P(40, 9.5, 2), "r"); c.line(...P(43, 9.5, 2), ...P(48, 9.5, 2), "r")   // kick-plate neon, a dead gap
    box(c, 19, 1, 26, 7, 9, "4", "2", "1", 15)                                  // CRT terminal
    c.poly(Q(P(20, 7, 17), P(25, 7, 17), P(25, 7, 23), P(20, 7, 23)), "e")
    for (let h = 18; h < 23; h += 2) c.line(...P(20.5, 7, h), ...P(24.5, 7, h), "E")
    box(c, 34, 1, 40, 6, 14, "6", "4", "3", 15)                                  // espresso machine
    c.px(...P(37, 6, 25), "q")
    c.line(...P(36, 6, 18), ...P(36, 6, 15.5), "1")
  }),
  // Neon: a vertical CAFE on the right wall, a cyan tube along the top.
  layer("signs", stamp("_cafe", ...P(7, 0, 50).map((n, i) => n + [-3, -1][i])), (c) => {
    c.line(...P(14, 0, 51), ...P(50, 0, 51), "t"); c.line(...P(14, 0, 52), ...P(50, 0, 52), "T")
  }),
  layer("furniture",
    stamp("_stool", ...P(26, 13, 10)), stamp("_stool", ...P(38, 13, 10)),
    (c) => {
      // the robot's table by the window
      const [tx, ty] = P(12, 26, 14)
      c.vline(tx, ty, 14, "k"); c.ellipse(tx, ty + 14, 4, 1, "1")
      c.ellipse(tx, ty, 11, 5, "U"); c.ellipse(tx, ty - 1, 11, 5, "v"); c.ellipse(tx - 2, ty - 2, 6, 2, "V")
      // the abandoned table
      const [ax, ay] = P(34, 40, 14)
      c.vline(ax, ay, 14, "k"); c.ellipse(ax, ay + 14, 4, 1, "1")
      c.ellipse(ax, ay, 11, 5, "U"); c.ellipse(ax, ay - 1, 11, 5, "v")
    },
    stamp("_ashtray", ...P(34, 40, 14).map((n, i) => n + [-3, -3][i])),
    stamp("_cup_tipped", ...P(34, 40, 14).map((n, i) => n + [-7, -4][i])),
    stamp("_cup", ...P(34, 40, 14).map((n, i) => n + [2, -6][i])),
    stamp("_robot_drink", ...P(12, 26, 14).map((n, i) => n + [3 - 6, -26][i])),   // the last cup, in his hand
    stamp("_sleeper", ...P(44, 13, 10).map((n, i) => n + [-8, -18][i])),
    stamp("_smoke", ...P(34, 40, 14).map((n, i) => n + [-6, -29][i])),
    stamp("_smoke", ...P(44, 13, 10).map((n, i) => n + [-14, -35][i]), { delay: 700 }),
    stamp("_dead_head", ...P(4, 46, 0).map((n, i) => n + [-4, -6][i])),
    (c) => {
      c.wire(...P(22, 7, 15), ...P(22, 12, 0), 3, "k")                       // terminal cable, down to the floor
      c.line(...P(22, 12), ...P(22, 19), "k"); c.line(...P(22, 19), ...P(16, 22), "k")   // ...and over to his table
    },
  ),
  layer("bulb", (c) => {
    const [bx, by] = P(12, 26, 46)
    c.vline(bx, 0, by - 1, "k"); c.rect(bx - 2, by - 1, 5, 2, "1")
    c.px(bx - 1, by + 1, "L"); c.px(bx, by + 1, "L"); c.px(bx + 1, by + 1, "l"); c.px(bx, by + 2, "l")
  }),
  // Light: the bulb over his table, the red sign, the cyan tube, cold glass, the old terminal.
  lamp(...P(12, 26, 44), { r: 80, color: "#e0903a", power: 1.1 }),
  lamp(...P(7, 0, 38), { r: 120, color: "#f03a54", power: 0.85 }),
  lamp(...P(24, 0, 50), { r: 80, color: "#55dcee", power: 0.5 }),
  lamp(...P(44, 0, 50), { r: 80, color: "#55dcee", power: 0.5 }),
  lamp(...P(0, 16, 30), { r: 70, color: "#5c7cb8", power: 0.55 }),
  lamp(...P(0, 36, 30), { r: 70, color: "#5c7cb8", power: 0.55 }),
  lamp(...P(14, 34, 0), { r: 60, color: "#4a6494", power: 0.4 }),       // cold window light on the wet floor
  lamp(...P(22, 7, 20), { r: 30, color: "#3fae5e", power: 0.7 }),
  lamp(...P(30, 14, 3), { r: 70, color: "#c0283e", power: 0.6 }),       // the kick-plate strip
  lamp(...P(32, 34, 6), { r: 90, color: "#5a2a48", power: 0.45 }),      // red bounce off the wet floor
  lighting({ cell: 2, smooth: true, ambient: 0.09, ambientColor: "#8090c0", emit: "qQjJtELrT" }),
  glow("q", { r: 9, strength: 0.55 }),
  glow("jt", { r: 6, strength: 0.4 }),
  glow("L", { r: 10, strength: 0.6 }),
  glow("E", { r: 4, strength: 0.35 }),
  )
