// Bundled for QuickJS, never executed in the host Node runtime with model code.
import { Project, toHex, TRANSPARENT } from 'pxl-pixelart/core';
import { lint } from 'pxl-pixelart/dist/core/lint.js';

export function render(code, names) {
  const project = new Project();
  const env = project.env();
  // No include/image hooks, imports, console, timers, process, filesystem or network APIs.
  new Function(...Object.keys(env), code)(...Object.values(env));
  const out = {};
  for (const name of names) {
    if (!project.assets.has(name)) throw new Error(`The code defines no asset named '${name}'.`);
    const { img } = project.build(name);
    if (img.w > 384 || img.h > 384 || img.w < 1 || img.h < 1) throw new Error('Assets must be between 1 and 384 pixels per axis.');
    const findings = lint(img, name).map(f => ({ rule: f.rule, message: f.message, count: f.at.length, at: f.at.slice(0, 12) }));
    const counts = new Map();
    for (const color of img.data) counts.set(color, (counts.get(color) ?? 0) + 1);
    const transparent = counts.get(TRANSPARENT) ?? 0;
    counts.delete(TRANSPARENT);
    out[name] = {
      w: img.w, h: img.h, data: Array.from(img.data), lint: findings, transparent,
      colors: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 64).map(([c]) => toHex(c).slice(0, 7)),
    };
  }
  return JSON.stringify(out);
}
