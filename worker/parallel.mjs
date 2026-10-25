import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export function branchPrompt(text, branch, outputs) {
  return `${text}

WORLD BRANCH: ${branch}
BRANCH OUTPUT DIRECTORY: ${outputs}
This is one of TWO concurrent independent jobs. Do not wait for, read, modify, or generate the other branch's files. Use the same prompt, fixed grid and the shared palette in the brief. The object branch does not need painted terrain: the canonical store lifts positions when terrain arrives.
${branch === 'environment'
    ? 'Generate ONLY the environment textures and terrain. Return response.kind=create with a complete room/listener and objects:[], plus environment. sprites and sounds must be empty. Do not generate source props or audio.'
    : 'Generate ONLY sound-source objects, transparent sprites and needed audio. Return response.kind=create with the complete scene, sprites and sounds. Omit environment and terrain. Do not generate floor or wall textures.'}
All compiled asset basenames MUST begin with ${text.match(/^Turn: (r_[a-f0-9]{16})/)[1]}_${branch}_.
Write your WorldOutput manifest LAST, atomically, as ${outputs}/${text.match(/^Turn: (r_[a-f0-9]{16})/)[1]}_${branch}.json instead of the full scene manifest. The server merges both branches. Build and publish immediately; no image review, lint, preview or aesthetic refinement.`;
}

export async function branchOutput(outputs, turn, branch, available) {
  const name = `${turn}_${branch}.json`;
  if (!available.some(file => file.filename === name && file.size_bytes <= 256 * 1024)) throw new Error('Missing branch manifest');
  const output = JSON.parse(await readFile(join(outputs, name), 'utf8'));
  if (output.turn !== turn || output.response?.kind !== 'create') throw new Error('Invalid branch manifest');
  if (branch === 'environment' && (!output.environment || output.response.scene.objects.length || output.sprites?.length || output.sounds?.length)) throw new Error('Invalid environment branch');
  if (branch === 'objects' && output.environment) throw new Error('Invalid objects branch');
  const names = [...(output.sprites ?? []).map(v => v.file), ...(output.sounds ?? []).map(v => v.file), ...Object.values(output.environment?.textures ?? {}).map(v => v.file)];
  if (names.some(file => typeof file !== 'string' || !file.startsWith(`${turn}_${branch}_`) || !available.some(v => v.filename === file))) throw new Error('Branch assets are not compiled');
  return { output, names: [name, ...names] };
}

export async function mergeBranches(outputs, turn, environment, objects) {
  const output = { ...objects, environment: environment.environment, response: { kind: 'create', scene: { ...objects.response.scene, room: { ...environment.response.scene.room, terrain: environment.environment.terrain } } } };
  const name = `${turn}_scene.json`;
  await writeFile(join(outputs, `${name}.tmp`), JSON.stringify(output));
  await rename(join(outputs, `${name}.tmp`), join(outputs, name));
  return name;
}
