import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wrapperDir = resolve(root, 'wasm', 'rton-editor-wasm');
const outDir = resolve(root, 'src', 'wasm', 'rton-editor');

const args = [
  'build',
  wrapperDir,
  '--target',
  'web',
  '--release',
  '--out-dir',
  outDir,
  '--out-name',
  'rton_editor_wasm',
];

const result = spawnSync('wasm-pack', args, {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
