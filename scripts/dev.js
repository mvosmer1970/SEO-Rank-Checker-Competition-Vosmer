// Development: builds the main process, starts the Vite dev server and opens Electron on it.
// Restart after changes to src/main or src/preload; the renderer reloads by itself.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { buildMain } from './build-main.js';

await buildMain();
const server = await createServer();
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error('Vite dev server has no local URL');

const require = createRequire(import.meta.url);
const electronPath = require('electron');
// VS Code sets ELECTRON_RUN_AS_NODE in its terminals, which would start Electron as plain Node.
const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...env, VITE_DEV_SERVER_URL: url },
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
