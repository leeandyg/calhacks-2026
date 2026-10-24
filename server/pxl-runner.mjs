// Only trusted loader/encoder code runs in Node. All pxl and model code runs inside a fresh
// QuickJS WASM heap with no host functions or module loader. The parent also kills this process.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { getQuickJS } from 'quickjs-emscripten';

const [pxlEntry] = process.argv.slice(2);
const write = result => process.stdout.write(JSON.stringify(result), () => process.exit(0));
try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 100_000) throw new Error('Art source is too large.');
  }
  const { code, assets } = JSON.parse(input);
  const core = readFileSync(new URL('./pxl-core.generated.js', import.meta.url), 'utf8');
  const QuickJS = await getQuickJS();
  const data = QuickJS.evalCode(`${core}\nPxlCore.render(${JSON.stringify(code)}, ${JSON.stringify(assets)})`, {
    memoryLimitBytes: 96 * 1024 * 1024,
    maxStackSizeBytes: 512 * 1024,
    shouldInterrupt: (() => { const deadline = Date.now() + 8_000; return () => Date.now() > deadline; })(),
  });
  if (typeof data !== 'string' || data.length > 8 * 1024 * 1024) throw new Error('Invalid renderer output.');
  const images = JSON.parse(data);
  const { encodePng } = await import(new URL('node/png.js', pathToFileURL(pxlEntry)).href);
  const out = {};
  for (const name of assets) {
    const img = images[name];
    if (!img || !Number.isInteger(img.w) || !Number.isInteger(img.h) || img.w < 1 || img.h < 1 || img.w > 384 || img.h > 384 ||
        !Array.isArray(img.data) || img.data.length !== img.w * img.h || img.data.some(c => !Number.isInteger(c) || c < 0 || c > 0xffffffff) ||
        !Array.isArray(img.colors) || img.colors.length > 64 || img.colors.some(c => !/^#[a-f0-9]{6}$/i.test(c)) ||
        !Array.isArray(img.lint) || img.lint.length > 100 || !Number.isInteger(img.transparent) || img.transparent < 0 || img.transparent > img.w * img.h) {
      throw new Error('Invalid pixel data from renderer.');
    }
    out[name] = { png: encodePng({ w: img.w, h: img.h, data: new Uint32Array(img.data) }).toString('base64'),
      w: img.w, h: img.h, colors: img.colors, transparent: img.transparent, lint: img.lint };
  }
  write({ ok: true, assets: out });
} catch (error) {
  write({ ok: false, error: String(error?.message ?? error).slice(0, 3000) });
}
