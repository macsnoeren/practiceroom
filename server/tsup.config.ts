import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/worker/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  sourcemap: true,
  // Bundle the workspace package (it ships TypeScript source, not built JS).
  noExternal: ['@practiceroom/shared'],
});
