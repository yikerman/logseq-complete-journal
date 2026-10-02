import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/index.js'],
  outfile: 'dist/index.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome100',
  sourcemap: true,
});
await writeFile('dist/index.html', '<!doctype html>\n<html><head><meta charset="utf-8"><title>Complete Journal</title></head><body><script src="./index.js"></script></body></html>\n');
