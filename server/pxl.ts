import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Server-side pxl (https://github.com/uilianks/pxl): renders .px.js art written by the art agents
// (api/environment.ts, api/sprite.ts) into PNGs, with pxl's lint findings.
//
// The code comes from a model, so it never runs in this process. Each render is a fresh Node
// process with a QuickJS WASM runtime, a time limit and a memory cap (pxl-runner.mjs).

export type LintFinding = { rule: string; message: string; count: number; at: [number, number][] };
/** colors: hex, most used first (up to 64); transparent: count of empty pixels. */
export type RenderedAsset = { png: string; w: number; h: number; lint: LintFinding[]; colors: string[]; transparent: number };
export type RenderResult = { ok: true; assets: Record<string, RenderedAsset> } | { ok: false; error: string };

const RENDER_TIMEOUT_MS = 12_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

const here = dirname(fileURLToPath(import.meta.url));
const runner = join(here, "pxl-runner.mjs");
const pxlEntry = createRequire(import.meta.url).resolve("pxl-pixelart");
const pxlRoot = join(dirname(pxlEntry), "..");

export function renderPxl(code: string, assets: string[]): Promise<RenderResult> {
  return new Promise((resolve) => {
    if (code.length > 60_000 || assets.length > 5) return resolve({ ok: false, error: 'Art request is too large.' });
    const child = spawn(process.execPath, ['--max-old-space-size=256', runner, pxlEntry], { stdio: ["pipe", "pipe", "pipe"], env: {} });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, error: `Rendering took longer than ${RENDER_TIMEOUT_MS / 1000} s. Use fewer, larger operations (no per-pixel loops over the whole image).` });
    }, RENDER_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT_BYTES) child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk).slice(-2000); });
    child.on('error', () => { clearTimeout(timer); resolve({ ok: false, error: 'The art renderer could not start.' }); });
    child.stdin.on('error', () => {});
    child.on("close", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(stdout) as RenderResult);
      } catch {
        resolve({ ok: false, error: `The renderer stopped without a result. ${stderr.trim().slice(-500)}`.trim() });
      }
    });
    child.stdin.end(JSON.stringify({ code, assets }));
  });
}

/** pxl's own agent instructions (SKILL.md, reference.md, lighting.md), for the art agents' prompts. */
export function pxlDocs(): string {
  const read = (file: string) => readFileSync(join(pxlRoot, file), "utf8");
  // The CLI, live viewer and feedback sections describe tools the server agents don't have.
  const skill = read("SKILL.md").replace(/^---[\s\S]*?---\s*/, "").replace(/## Workflow[\s\S]*?(?=## Template)/, "");
  return [skill, read("reference.md"), read("lighting.md")].join("\n\n");
}

/** Short lint summary for an agent: the rule, how many pixels, and where the first few are. */
export function describeLint(name: string, lint: LintFinding[]): string {
  if (!lint.length) return `${name}: lint clean.`;
  return lint.map((f) => `${name}: ${f.rule} (${f.count} px, e.g. ${f.at.slice(0, 5).map(([x, y]) => `${x},${y}`).join(" ")}): ${f.message}`).join("\n");
}
