import { build } from 'rolldown';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.resolve('pxl-pixelart')));
// npm installations that disable lifecycle scripts may omit the git package's dist directory.
if (!existsSync(join(root, 'core/index.js'))) execFileSync(process.execPath, [join(root, '../scripts/build.js')], { stdio: 'inherit' });
await build({
  input: 'server/pxl-core-entry.mjs',
  resolve: { alias: { 'pxl-pixelart/dist/core/lint.js': join(root, 'core/lint.js') } },
  output: { file: 'server/pxl-core.generated.js', format: 'iife', name: 'PxlCore' },
});
