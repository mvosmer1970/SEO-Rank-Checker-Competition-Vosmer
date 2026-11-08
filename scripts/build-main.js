// Bundles the Electron main process and the preload script (Node side of the app).
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';

export async function buildMain() {
  const common = {
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    sourcemap: true,
    logLevel: 'warning',
  };
  await Promise.all([
    build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.cjs' }),
    build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/main/preload.cjs' }),
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildMain();
}
