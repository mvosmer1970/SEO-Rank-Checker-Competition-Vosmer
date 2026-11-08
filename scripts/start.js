// Starts the built app (run `npm run build` first).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
// VS Code sets ELECTRON_RUN_AS_NODE in its terminals, which would start Electron as plain Node.
const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
const child = spawn(electronPath, ['.'], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
